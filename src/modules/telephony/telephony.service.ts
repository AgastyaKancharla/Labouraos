import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
  Optional,
  UnauthorizedException,
} from '@nestjs/common';
import {
  InboundCallEvent,
  InboundCallResult,
  OutboundCallResult,
  TELEPHONY_PROVIDER,
  TelephonyCapacity,
  TelephonyProvider,
} from './telephony.interface';
import { OwnTeam } from '../../common/rbac/own-team';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../common/prisma/prisma.service';
import { JwtPayload } from '../../common/auth/jwt-payload.interface';
import { validateWebhookHmac } from '../../common/webhook/webhook-signature';
import { AttendanceService } from '../attendance/attendance.service';
import { InboundCallRouter } from './inbound-call-router.service';
import { ReportingScopeService } from '../staff/reporting-scope.service';

/** Only who a callback is with: never the whole staff row (password hash, TOTP secret, invite token hash). */
const CALLBACK_STAFF_SELECT = { id: true, code: true, name: true } as const;
/** Who a missed call can be given to. */
const CALLBACK_AGENT_ROLES = ['call_agent', 'field_agent'];
/** The job seeker fields a callback row shows (the phone is masked for everyone but the CEO). */
const CALLBACK_SEEKER_SELECT = { id: true, code: true, name: true, phone: true, status: true } as const;

@Injectable()
export class TelephonyService {
  constructor(
    @Inject(TELEPHONY_PROVIDER)
    private readonly provider: TelephonyProvider,
    private readonly prisma: PrismaService,
    private readonly attendance: AttendanceService,
    // Always provided by TelephonyModule; optional only for specs that build the service by hand.
    @Optional() private readonly router?: InboundCallRouter,
    @Optional() private readonly scope?: ReportingScopeService,
  ) {}

  async handleInboundWebhook(
    payload: Record<string, unknown>,
    signature?: string,
    rawBody?: Buffer | string,
  ): Promise<InboundCallResult> {
    const secret = process.env.TELEPHONY_WEBHOOK_SECRET;
    const bodyToVerify = rawBody ?? Buffer.from(JSON.stringify(payload), 'utf8');
    const validation = validateWebhookHmac(bodyToVerify, signature, secret);
    if (!validation.isValid) {
      throw new UnauthorizedException('Invalid or missing telephony webhook signature');
    }

    const callId = String(
      payload.CallSid ||
        payload.call_id ||
        payload.callId ||
        payload.sid ||
        `call_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
    );

    const callerPhone = String(
      payload.From ||
        payload.caller_number ||
        payload.caller ||
        payload.phone ||
        payload.mobile ||
        '',
    );

    const virtualNumber = String(
      payload.To ||
        payload.virtual_number ||
        payload.called_number ||
        payload.virtualNumber ||
        '18001234567',
    );

    const recordingUrl = payload.RecordingUrl
      ? String(payload.RecordingUrl)
      : payload.recordingUrl
        ? String(payload.recordingUrl)
        : undefined;

    const recordingEnabled =
      payload.recordingEnabled === true ||
      payload.record === 'true' ||
      Boolean(recordingUrl);

    const recordingConsent =
      payload.recordingConsent === true ||
      payload.consent_confirmed === true ||
      payload.consent === 'true';

    const event: InboundCallEvent = {
      callId,
      callerPhone,
      virtualNumber,
      timestamp: new Date(),
      recordingUrl,
      recordingEnabled,
      recordingConsent,
    };

    const result = await this.provider.handleInboundCall(event);
    if (!result.isDuplicate && this.router) {
      // A repeated webhook never rings anyone twice.
      const routing = await this.router.route(result.callbackTaskId, callId, callerPhone, payload);
      return { ...result, routedToStaffId: routing.staffId };
    }
    return result;
  }

  /**
   * The missed-call queue, scoped by the reporting line: the CEO sees every
   * callback; a Manager or Team Lead sees the ones with themselves or anyone
   * under them, plus the unassigned ones they can give out; an agent sees their
   * own and the unassigned ones. Staff and job seeker are narrow selects.
   */
  async getCallbackQueue(filters?: { status?: string }, actor?: JwtPayload) {
    const where: Prisma.CallbackTaskWhereInput = {};
    if (filters?.status) {
      where.status = filters.status;
    }
    if (actor && actor.role !== 'ceo') {
      const mine = [actor.sub];
      if ((actor.role === 'manager' || actor.role === 'team_lead') && this.scope) {
        mine.push(...(await this.scope.peopleUnder(actor.sub)));
      }
      where.OR = [{ assignedToStaffId: null }, { assignedToStaffId: { in: mine } }];
    }

    return this.prisma.callbackTask.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      include: {
        jobSeeker: { select: CALLBACK_SEEKER_SELECT },
        assignedToStaff: { select: CALLBACK_STAFF_SELECT },
      },
    });
  }

  /** A Team Lead's own team (the one shared definition, OwnTeam). */
  private teamOf(teamLeadId: string): Promise<string[]> {
    return new OwnTeam(this.prisma, this.scope).memberIds(teamLeadId);
  }

  /**
   * Owner rule (Master Guide, 14 Nov): a Team Lead works only on their own
   * team. They act on a missed call that is unassigned or held by their team,
   * never one another team holds.
   */
  private assertCallbackInTeam(callback: { assignedToStaffId: string | null }, team: string[]): void {
    if (callback.assignedToStaffId && !team.includes(callback.assignedToStaffId)) {
      throw new ForbiddenException('Access denied: this missed call is with another team');
    }
  }

  /**
   * Give a missed call to someone (owner decision, 14 Nov):
   * - a call agent: only one that is unassigned (take it, or give it to a
   *   colleague) or assigned to himself (hand it over); never one someone
   *   else holds;
   * - a Team Lead: one that is unassigned or held by their team, to someone
   *   on their team;
   * - Managers and the CEO: any.
   * The person it goes to must be an active call or field agent. When they
   * are not Available it goes to the next Available agent (a Team Lead's:
   * on the same team); when nobody is, the answer says so (409) and the
   * missed call stays where it was. The change only applies if nobody moved
   * the missed call in between (checked in the update itself).
   */
  async assignCallback(id: string, staffId: string, actor?: JwtPayload) {
    const existing = await this.prisma.callbackTask.findUnique({
      where: { id },
    });
    if (!existing) {
      throw new NotFoundException(`Callback task '${id}' not found`);
    }

    const target = staffId
      ? await this.prisma.staff.findUnique({ where: { id: staffId }, select: { role: true, status: true } })
      : null;
    if (!target || target.status !== 'active' || !CALLBACK_AGENT_ROLES.includes(target.role)) {
      throw new BadRequestException('A missed call can only go to an active call or field agent');
    }

    let team: string[] | null = null;
    if (actor?.role === 'team_lead') {
      team = await this.teamOf(actor.sub);
      this.assertCallbackInTeam(existing, team);
      if (!team.includes(staffId)) {
        throw new ForbiddenException(
          `Access denied: staff '${staffId}' is not part of your team`,
        );
      }
    } else if (
      (actor?.role === 'call_agent' || actor?.role === 'field_agent') &&
      existing.assignedToStaffId &&
      existing.assignedToStaffId !== actor.sub
    ) {
      throw new ForbiddenException('Access denied: this missed call is held by someone else');
    }

    let assignTo = staffId;
    if (!(await this.attendance.isAvailable(staffId))) {
      // A Team Lead's missed call goes only to someone on their own team.
      const next = team
        ? await this.nextAvailableIn(team.filter((member) => member !== staffId && member !== actor?.sub))
        : await this.attendance.nextAvailableAgent(staffId);
      if (!next) {
        throw new ConflictException({
          message: team
            ? 'Nobody on your team is Available right now. The missed call stays in the queue.'
            : 'No agent is Available right now. The missed call stays in the queue.',
          reason: 'nobody_available',
        });
      }
      assignTo = next;
    }

    const moved = await this.prisma.callbackTask.updateMany({
      where: { id, assignedToStaffId: existing.assignedToStaffId, status: existing.status },
      data: { assignedToStaffId: assignTo, status: 'assigned' },
    });
    if (moved.count !== 1) {
      throw new ConflictException({
        message: 'Someone else changed this missed call just now. Refresh and try again.',
        reason: 'changed_meanwhile',
      });
    }
    return this.prisma.callbackTask.findUniqueOrThrow({
      where: { id },
      include: {
        assignedToStaff: { select: CALLBACK_STAFF_SELECT },
      },
    });
  }

  private async nextAvailableIn(staffIds: string[]): Promise<string | null> {
    for (const id of staffIds) {
      if (await this.attendance.isAvailable(id)) return id;
    }
    return null;
  }

  /**
   * Mark a missed call done. A Team Lead: one that is unassigned or with their
   * team. An agent: one that is unassigned or theirs (the queue they see).
   * Managers and the CEO: any.
   */
  async completeCallback(id: string, actor?: JwtPayload) {
    const existing = await this.prisma.callbackTask.findUnique({
      where: { id },
    });
    if (!existing) {
      throw new NotFoundException(`Callback task '${id}' not found`);
    }
    if (actor?.role === 'team_lead') {
      this.assertCallbackInTeam(existing, await this.teamOf(actor.sub));
    } else if (
      (actor?.role === 'call_agent' || actor?.role === 'field_agent') &&
      existing.assignedToStaffId &&
      existing.assignedToStaffId !== actor.sub
    ) {
      throw new ForbiddenException('Access denied: this missed call is assigned to someone else');
    }

    return this.prisma.callbackTask.update({
      where: { id },
      data: {
        status: 'completed',
      },
    });
  }

  async initiateOutboundCall(
    agentPhone: string,
    customerPhone: string,
    recordCall = true,
  ): Promise<OutboundCallResult> {
    return this.provider.initiateOutboundCall({
      agentPhone,
      customerPhone,
      recordCall,
    });
  }

  getCapacity(): TelephonyCapacity {
    return this.provider.getCapacity();
  }
}
