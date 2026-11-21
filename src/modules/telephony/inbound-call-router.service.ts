import { Injectable, Logger, Optional } from '@nestjs/common';
import { AttendanceClock } from '../attendance/attendance-clock';
import { onShiftAt } from '../attendance/staff-shift';
import { PrismaService } from '../../common/prisma/prisma.service';
import { LiveEventsService } from '../../common/live/live-events.service';
import { maskPhoneLast4 } from '../../common/rbac/pii-masking.interceptor';
import { AttendanceService } from '../attendance/attendance.service';
import { decryptCallRoutingPhone } from '../staff/call-routing-key';
import { isIndianMobile, nationalMobileDigits } from '../../common/phone/indian-mobile';
import { fewestOpen, openItemCounts } from './call-agent-load';

export type CallerType = 'job_seeker' | 'business' | 'referral';

export interface IdentifiedCaller {
  type: CallerType;
  id: string;
  code: string;
  name: string;
  /** Who looks after this person: the agent assigned to him (else who registered him), or the business's account agent. */
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
 * 3. his own agent (assigned, else the one who registered him), if Available;
 * 4. the free call agent with the fewest open items (round robin on a tie).
 * Nobody who is on a call already is rung.
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
    @Optional() private readonly clock?: AttendanceClock,
  ) {}

  /** Inside their own shift now (21 Nov: each agent has their own shift); Available alone is not enough after it ends. */
  private async inOwnShift(staffId: string): Promise<boolean> {
    if (!this.clock) return true;
    return onShiftAt(this.clock.now(), await this.attendance.shiftOf(staffId));
  }

  async identify(callerPhone: string): Promise<IdentifiedCaller | null> {
    const digits = tenDigits(callerPhone);
    if (digits.length < 10) return null;
    const seeker = await this.prisma.jobSeeker.findFirst({
      where: { phone: { endsWith: digits }, anonymisedAt: null },
      select: { id: true, code: true, name: true, registeredByStaffId: true, assignedStaffId: true },
    });
    if (seeker) {
      // A Team Lead's Assign wins over who registered him (21 Nov fixes).
      return { type: 'job_seeker', id: seeker.id, code: seeker.code, name: seeker.name, ownerStaffId: seeker.assignedStaffId ?? seeker.registeredByStaffId };
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
      select: { id: true, code: true, name: true, registeredByStaffId: true, assignedStaffId: true },
    });
    if (referral) {
      return { type: 'referral', id: referral.id, code: referral.code, name: referral.name, ownerStaffId: referral.assignedStaffId ?? referral.registeredByStaffId };
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

  /**
   * Already on a call, or one is ringing for them (21 Nov fixes):
   * - a call of theirs answered and not ended (started in the last hour);
   * - an outgoing call the phone system reports ringing (last 2 minutes);
   * - another inbound call that rang them in the last minute and is not
   *   handled yet — unless it is the same caller ringing again (that one goes
   *   to the same agent).
   */
  private async onACall(staffId: string, callerDigits = ''): Promise<boolean> {
    const now = Date.now();
    const [live, ringingOut, ringingIn] = await Promise.all([
      this.prisma.callRecord.findFirst({
        where: { staffId, providerStatus: 'answered', endedAt: null, createdAt: { gte: new Date(now - 60 * 60_000) } },
        select: { id: true },
      }),
      this.prisma.callRecord.findFirst({
        where: { staffId, providerStatus: 'ringing', createdAt: { gte: new Date(now - 2 * 60_000) } },
        select: { id: true },
      }),
      this.prisma.callbackTask.findFirst({
        where: {
          assignedToStaffId: staffId,
          status: 'assigned',
          assignmentReason: 'inbound_routed',
          assignedAt: { gte: new Date(now - 60_000) },
          ...(callerDigits.length === 10 ? { NOT: { phone: { endsWith: callerDigits } } } : {}),
        },
        select: { id: true },
      }),
    ]);
    return Boolean(live || ringingOut || ringingIn);
  }

  private async availableCallAgent(staffId: string | null | undefined, callerDigits = ''): Promise<string | null> {
    if (!staffId) return null;
    const staff = await this.prisma.staff.findUnique({ where: { id: staffId }, select: { role: true, status: true } });
    if (!staff || staff.status !== 'active' || staff.role !== 'call_agent') return null;
    if (!(await this.attendance.isAvailable(staffId))) return null;
    if (!(await this.inOwnShift(staffId))) return null;
    return (await this.onACall(staffId, callerDigits)) ? null : staffId;
  }

  /**
   * 21 Nov fixes: the free call agent with the fewest open items; a tie goes to
   * whoever was rung longest ago (round robin), not always the first by staff code.
   */
  private async freeCallAgentWithFewestItems(callerDigits = ''): Promise<string | null> {
    const agents = await this.prisma.staff.findMany({
      where: { role: 'call_agent', status: 'active' },
      select: { id: true },
      orderBy: { code: 'asc' },
    });
    const free: string[] = [];
    for (const agent of agents) {
      if ((await this.attendance.isAvailable(agent.id)) && (await this.inOwnShift(agent.id)) && !(await this.onACall(agent.id, callerDigits))) free.push(agent.id);
    }
    if (free.length <= 1) return free[0] ?? null;
    const counts = await openItemCounts(this.prisma, free, new Date());
    const rung = await this.prisma.callbackTask.groupBy({
      by: ['assignedToStaffId'],
      where: { assignedToStaffId: { in: free } },
      _max: { createdAt: true },
    });
    const lastRung = new Map(rung.map((r) => [r.assignedToStaffId!, r._max.createdAt]));
    return fewestOpen(free, counts, lastRung);
  }

  async pickAgent(payload: Record<string, unknown>, caller: IdentifiedCaller | null, callerPhone = ''): Promise<string | null> {
    const named = await this.staffFromPayload(payload);
    if (named) return named;
    const digits = callerPhone ? tenDigits(callerPhone) : '';
    if (caller) {
      const lastCall = await this.prisma.callRecord.findFirst({
        where: { subjectType: caller.type, subjectId: caller.id, staffId: { not: null } },
        orderBy: { createdAt: 'desc' },
        select: { staffId: true },
      });
      const last = await this.availableCallAgent(lastCall?.staffId, digits);
      if (last) return last;
      const owner = await this.availableCallAgent(caller.ownerStaffId, digits);
      if (owner) return owner;
    }
    return this.freeCallAgentWithFewestItems(digits);
  }

  /** Routes a new (never a repeated) inbound call and pops it up on the agent's screen. */
  async route(
    callbackTaskId: string,
    callId: string,
    callerPhone: string,
    payload: Record<string, unknown>,
  ): Promise<InboundRouting> {
    const caller = await this.identify(callerPhone);
    const staffId = await this.pickAgent(payload, caller, callerPhone);
    await this.prisma.callbackTask.updateMany({
      where: { id: callbackTaskId, assignedToStaffId: null },
      data: {
        ...(staffId ? { assignedToStaffId: staffId, status: 'assigned', assignedAt: new Date(), assignmentReason: 'inbound_routed' } : {}),
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
