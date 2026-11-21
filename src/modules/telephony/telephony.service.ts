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
import { queryText } from '../../common/http/plain-query';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../common/prisma/prisma.service';
import { JwtPayload } from '../../common/auth/jwt-payload.interface';
import { validateWebhookHmac } from '../../common/webhook/webhook-signature';
import { AttendanceService } from '../attendance/attendance.service';
import { InboundCallRouter, tenDigits } from './inbound-call-router.service';
import { AuditService } from '../../common/audit/audit.service';
import { PricingService } from '../pricing/pricing.service';
import { maskPhoneLast4 } from '../../common/rbac/pii-masking.interceptor';
import { onShiftCallAgents, openItemCounts } from './call-agent-load';
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
    @Optional() private readonly audit?: AuditService,
    @Optional() private readonly pricing?: PricingService,
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
      where.status = queryText(filters.status, 'status');
    }
    if (actor && actor.role !== 'ceo') {
      const mine = [actor.sub];
      if (actor.role === 'team_lead') {
        mine.push(...(await this.teamOf(actor.sub)));
      } else if (actor.role === 'manager' && this.scope) {
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

  /**
   * The missed-call list for a Team Lead (their team + nobody's), a Manager
   * (their tree + nobody's) or the CEO (all), 21 Nov fixes: open missed calls
   * grouped by number (repeat calls are one row), oldest first, with who holds
   * each, how long it has waited for its first call back and the agents the
   * caller may give it to (with their open items and whether they are on shift).
   */
  async missedCallList(actor: JwtPayload) {
    const now = new Date();
    let people: string[] | null = null;
    if (actor.role === 'team_lead') people = [actor.sub, ...(await this.teamOf(actor.sub))];
    else if (actor.role === 'manager') people = [actor.sub, ...(this.scope ? await this.scope.peopleUnder(actor.sub) : [])];
    const where: Prisma.CallbackTaskWhereInput = {
      status: { in: ['pending', 'assigned'] },
      ...(people ? { OR: [{ assignedToStaffId: null }, { assignedToStaffId: { in: people } }] } : {}),
    };
    const open = await this.prisma.callbackTask.findMany({
      where,
      orderBy: { createdAt: 'asc' },
      take: 500,
      include: { assignedToStaff: { select: CALLBACK_STAFF_SELECT } },
    });
    const groups = new Map<string, typeof open>();
    for (const task of open) {
      const key = `${tenDigits(task.phone)}|${task.assignedToStaffId ?? ''}`;
      const list = groups.get(key) ?? [];
      list.push(task);
      groups.set(key, list);
    }
    const rows = [];
    for (const tasks of groups.values()) {
      const first = tasks[0];
      const last = tasks[tasks.length - 1];
      const caller = this.router ? await this.router.identify(first.phone) : null;
      rows.push({
        id: first.id,
        ids: tasks.map((t) => t.id),
        count: tasks.length,
        firstCalledAt: first.createdAt.toISOString(),
        lastCalledAt: last.createdAt.toISOString(),
        maskedPhone: maskPhoneLast4(first.phone),
        caller: caller ? { type: caller.type, id: caller.id, code: caller.code, name: caller.name } : null,
        holder: first.assignedToStaff,
        assignedAt: first.assignedAt?.toISOString() ?? null,
        assignmentReason: first.assignmentReason,
        waitingMinutes: Math.max(0, Math.floor((now.getTime() - first.createdAt.getTime()) / 60_000)),
      });
    }
    const agentWhere: Prisma.StaffWhereInput = { status: 'active', role: { in: CALLBACK_AGENT_ROLES } };
    if (people) agentWhere.id = { in: people };
    const agents = await this.prisma.staff.findMany({ where: agentWhere, select: { id: true, code: true, name: true, role: true }, orderBy: { name: 'asc' } });
    const ids = agents.map((a) => a.id);
    const [counts, onShift] = await Promise.all([openItemCounts(this.prisma, ids, now), onShiftCallAgents(this.prisma, now, ids, this.pricing ? await this.pricing.current() : null)]);
    return {
      now: now.toISOString(),
      targetMinutes: 30,
      rows,
      agents: agents.map((a) => ({ ...a, openItems: counts.get(a.id) ?? 0, onShift: onShift.includes(a.id) })),
    };
  }

  /** A Team Lead's own team (the one shared definition, OwnTeam). */
  private teamOf(teamLeadId: string): Promise<string[]> {
    return new OwnTeam(this.prisma).memberIds(teamLeadId);
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
   * Give a missed call to someone (owner decision 14 Nov, changed by the 21 Nov fixes):
   * - a call or field agent takes a missed call only for himself: one that is
   *   unassigned or already his; never for a colleague, never one someone else holds;
   * - a Team Lead: one that is unassigned or held by their team, to someone
   *   on their team;
   * - Managers and the CEO: any.
   * The person it goes to must be an active call or field agent. It stays with
   * the person chosen even when they are not Available right now (it waits on
   * their list); it never silently goes to someone else. The change only
   * applies if nobody moved the missed call in between (checked in the update
   * itself), and repeat missed calls from the same number go along with it.
   */
  async assignCallback(id: string, staffId: string, actor?: JwtPayload) {
    const existing = await this.prisma.callbackTask.findUnique({
      where: { id },
    });
    if (!existing) {
      throw new NotFoundException(`Callback task '${id}' not found`);
    }
    if (existing.status === 'completed') {
      throw new ConflictException({ message: 'This missed call is already done.', reason: 'already_done' });
    }

    const agentActor = actor?.role === 'call_agent' || actor?.role === 'field_agent';
    if (agentActor && staffId && staffId !== actor.sub) {
      throw new ForbiddenException('An agent takes a missed call only for themselves; a Team Lead gives it to someone else');
    }
    const target = staffId
      ? await this.prisma.staff.findUnique({ where: { id: staffId }, select: { role: true, status: true } })
      : null;
    if (!target || target.status !== 'active' || !CALLBACK_AGENT_ROLES.includes(target.role)) {
      throw new BadRequestException('A missed call can only go to an active call or field agent');
    }

    if (actor?.role === 'team_lead') {
      const team = await this.teamOf(actor.sub);
      this.assertCallbackInTeam(existing, team);
      if (!team.includes(staffId)) {
        throw new ForbiddenException(
          `Access denied: staff '${staffId}' is not part of your team`,
        );
      }
    } else if (agentActor && existing.assignedToStaffId && existing.assignedToStaffId !== actor.sub) {
      throw new ForbiddenException('Access denied: this missed call is held by someone else');
    }

    const now = new Date();
    const moved = await this.prisma.callbackTask.updateMany({
      where: { id, assignedToStaffId: existing.assignedToStaffId, status: existing.status },
      data: { assignedToStaffId: staffId, status: 'assigned', assignedAt: now, assignmentReason: agentActor ? 'taken' : 'manual' },
    });
    if (moved.count !== 1) {
      throw new ConflictException({
        message: 'Someone else changed this missed call just now. Refresh and try again.',
        reason: 'changed_meanwhile',
      });
    }
    // Repeat missed calls from the same number held by the same person (or nobody) go along: one agent per caller.
    const digits = tenDigits(existing.phone);
    if (digits.length === 10) {
      await this.prisma.callbackTask.updateMany({
        where: {
          id: { not: id },
          status: { in: ['pending', 'assigned'] },
          phone: { endsWith: digits },
          OR: [{ assignedToStaffId: null }, ...(existing.assignedToStaffId ? [{ assignedToStaffId: existing.assignedToStaffId }] : [])],
        },
        data: { assignedToStaffId: staffId, status: 'assigned', assignedAt: now, assignmentReason: 'same_caller' },
      });
    }
    if (actor) {
      await this.audit?.log({
        actorId: actor.sub,
        action: 'missed_call.assigned',
        entityType: 'callback_task',
        entityCode: id,
        before: { assignedToStaffId: existing.assignedToStaffId },
        after: { assignedToStaffId: staffId },
        changedFields: ['assignedToStaffId'],
        reason: agentActor ? 'Taken by the agent' : 'Given out by hand',
      });
    }
    return this.prisma.callbackTask.findUniqueOrThrow({
      where: { id },
      include: {
        assignedToStaff: { select: CALLBACK_STAFF_SELECT },
      },
    });
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

    const now = new Date();
    const done = await this.prisma.callbackTask.update({
      where: { id },
      data: {
        status: 'completed',
        completedAt: now,
      },
    });
    // Repeat missed calls from the same number are one item: done together.
    const digits = tenDigits(existing.phone);
    if (digits.length === 10) {
      await this.prisma.callbackTask.updateMany({
        where: {
          id: { not: id },
          status: { in: ['pending', 'assigned'] },
          phone: { endsWith: digits },
          createdAt: { lte: now },
          OR: [{ assignedToStaffId: null }, ...(existing.assignedToStaffId ? [{ assignedToStaffId: existing.assignedToStaffId }] : [])],
        },
        data: { status: 'completed', completedAt: now },
      });
    }
    return done;
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
