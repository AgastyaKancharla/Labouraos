import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.service';
import { LiveEventsService } from '../../common/live/live-events.service';
import { maskPhoneLast4 } from '../../common/rbac/pii-masking.interceptor';
import { AttendanceService } from '../attendance/attendance.service';
import { decryptCallRoutingPhone } from '../staff/call-routing-key';
import { isIndianMobile, nationalMobileDigits } from '../../common/phone/indian-mobile';

export type CallerType = 'job_seeker' | 'business' | 'referral';

export interface IdentifiedCaller {
  type: CallerType;
  id: string;
  code: string;
  name: string;
  /** Who looks after this person: the agent who registered him or the business's account agent. */
  ownerStaffId: string | null;
}

export interface InboundRouting {
  staffId: string | null;
  caller: IdentifiedCaller | null;
}

/**
 * The 10 national digits, so +91 98765 43210, 919876543210, 09876543210 and
 * 9876543210 match the number saved as +919876543210 (src/common/phone).
 * A number that is not an Indian mobile keeps its last 10 digits.
 */
export function tenDigits(phone: string): string {
  return isIndianMobile(phone) ? nationalMobileDigits(phone) : String(phone ?? '').replace(/\D/g, '').slice(-10);
}

/**
 * Decides which agent an inbound call rings, and tells that agent's screen
 * (Master Guide: "When anyone calls in, their profile opens by itself; an
 * unknown number opens a choice to register them").
 *
 * Who it rings, in order:
 * 1. the agent the calling company says it rang (agent code or the agent's
 *    routing phone in the webhook), when it sends one;
 * 2. the agent who last called this person, if Available;
 * 3. the call agent who registered him, if Available;
 * 4. the first Available call agent.
 * Nobody who is not Available gets a call (Attendance, decided 9 Nov).
 *
 * The event carries the caller's name, ID and last 4 digits only.
 */
@Injectable()
export class InboundCallRouter {
  private readonly logger = new Logger(InboundCallRouter.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly attendance: AttendanceService,
    private readonly live: LiveEventsService,
  ) {}

  async identify(callerPhone: string): Promise<IdentifiedCaller | null> {
    const digits = tenDigits(callerPhone);
    if (digits.length < 10) return null;
    const seeker = await this.prisma.jobSeeker.findFirst({
      where: { phone: { endsWith: digits }, anonymisedAt: null },
      select: { id: true, code: true, name: true, registeredByStaffId: true },
    });
    if (seeker) {
      return { type: 'job_seeker', id: seeker.id, code: seeker.code, name: seeker.name, ownerStaffId: seeker.registeredByStaffId };
    }
    const business = await this.prisma.business.findFirst({
      where: { phone: { endsWith: digits }, anonymisedAt: null },
      select: { id: true, code: true, name: true, accountAgentId: true, leadCreatedByStaffId: true },
    });
    if (business) {
      return {
        type: 'business',
        id: business.id,
        code: business.code,
        name: business.name,
        ownerStaffId: business.accountAgentId ?? business.leadCreatedByStaffId,
      };
    }
    const referral = await this.prisma.referral.findFirst({
      where: { phone: { endsWith: digits }, anonymisedAt: null },
      select: { id: true, code: true, name: true },
    });
    if (referral) {
      return { type: 'referral', id: referral.id, code: referral.code, name: referral.name, ownerStaffId: null };
    }
    return null;
  }

  private async staffFromPayload(payload: Record<string, unknown>): Promise<string | null> {
    const code = [payload.agentCode, payload.agent_code, payload.staffCode].find((v) => typeof v === 'string' && v.trim());
    if (typeof code === 'string') {
      const staff = await this.prisma.staff.findFirst({
        where: { code: code.trim(), status: 'active', role: { in: ['call_agent', 'field_agent'] } },
        select: { id: true },
      });
      if (staff) return staff.id;
    }
    const phone = [payload.agentPhone, payload.agent_phone, payload.DialWhomNumber, payload.dial_whom_number].find(
      (v) => typeof v === 'string' && v.trim(),
    );
    if (typeof phone === 'string' && tenDigits(phone).length === 10) {
      const wanted = tenDigits(phone);
      const agents = await this.prisma.staff.findMany({
        where: { status: 'active', role: { in: ['call_agent', 'field_agent'] }, callRoutingPhone: { not: null } },
        select: { id: true, callRoutingPhone: true },
      });
      for (const agent of agents) {
        try {
          if (tenDigits(decryptCallRoutingPhone(agent.callRoutingPhone!)) === wanted) return agent.id;
        } catch {
          continue;
        }
      }
    }
    return null;
  }

  private async availableCallAgent(staffId: string | null | undefined): Promise<string | null> {
    if (!staffId) return null;
    const staff = await this.prisma.staff.findUnique({ where: { id: staffId }, select: { role: true, status: true } });
    if (!staff || staff.status !== 'active' || staff.role !== 'call_agent') return null;
    return (await this.attendance.isAvailable(staffId)) ? staffId : null;
  }

  private async firstAvailableCallAgent(): Promise<string | null> {
    const agents = await this.prisma.staff.findMany({
      where: { role: 'call_agent', status: 'active' },
      select: { id: true },
      orderBy: { code: 'asc' },
    });
    for (const agent of agents) {
      if (await this.attendance.isAvailable(agent.id)) return agent.id;
    }
    return null;
  }

  async pickAgent(payload: Record<string, unknown>, caller: IdentifiedCaller | null): Promise<string | null> {
    const named = await this.staffFromPayload(payload);
    if (named) return named;
    if (caller) {
      const lastCall = await this.prisma.callRecord.findFirst({
        where: { subjectType: caller.type, subjectId: caller.id, staffId: { not: null } },
        orderBy: { createdAt: 'desc' },
        select: { staffId: true },
      });
      const last = await this.availableCallAgent(lastCall?.staffId);
      if (last) return last;
      const owner = await this.availableCallAgent(caller.ownerStaffId);
      if (owner) return owner;
    }
    return this.firstAvailableCallAgent();
  }

  /** Routes a new (never a repeated) inbound call and pops it up on the agent's screen. */
  async route(
    callbackTaskId: string,
    callId: string,
    callerPhone: string,
    payload: Record<string, unknown>,
  ): Promise<InboundRouting> {
    const caller = await this.identify(callerPhone);
    const staffId = await this.pickAgent(payload, caller);
    await this.prisma.callbackTask.updateMany({
      where: { id: callbackTaskId, assignedToStaffId: null },
      data: {
        ...(staffId ? { assignedToStaffId: staffId, status: 'assigned' } : {}),
        ...(caller?.type === 'job_seeker' ? { jobSeekerId: caller.id, callerName: caller.name } : {}),
      },
    });
    if (!staffId) {
      this.logger.warn(`Inbound call ${callId}: no Available call agent; left on the callback list`);
      return { staffId: null, caller };
    }
    this.live.publish(staffId, 'incoming_call', {
      callbackTaskId,
      known: Boolean(caller),
      subjectType: caller?.type ?? null,
      subjectId: caller?.id ?? null,
      code: caller?.code ?? null,
      name: caller?.name ?? null,
      maskedPhone: maskPhoneLast4(callerPhone),
    });
    return { staffId, caller };
  }
}
