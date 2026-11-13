import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { AttendanceCorrection, AttendanceSegment, LeaveRequest, Prisma } from '@prisma/client';
import { PrismaService } from '../../common/prisma/prisma.service';
import { AuditService } from '../../common/audit/audit.service';
import { localCalendarToUtc } from '../../common/time/period-boundary';
import { MessagingService } from '../message/messaging.service';
import { PricingService } from '../pricing/pricing.service';
import { decryptCallRoutingPhone } from '../staff/call-routing-key';
import { ReportingScopeService } from '../staff/reporting-scope.service';
import { AttendanceClock } from './attendance-clock';
import { AttendanceService } from './attendance.service';
import { ATTENDANCE_ROLES, AttendanceDaysService } from './attendance-days.service';
import { AttendanceRequestHooks, AttendanceRequestKind } from './attendance-request-hooks';
import { monthRange } from './day-rules';
import { LEAVE_KINDS, LeaveKind, LeaveService, monthOf } from './leave.service';
import { isLeaveHalf } from './leave-units';
import {
  CORRECTION_TO_MANAGER_FROM,
  Placement,
  REASON_TEXT,
  TEAM_LEAD_CASUAL_DAYS_LIMIT,
  placementOf,
  whereLabel,
} from './request-routing';
import { assertPayrollCanCorrect, monthOfDay, monthsBetween } from '../finance/payroll-window';

/** Statuses a correction may claim: working time a person picks. */
const CORRECTION_STATUSES = ['available', 'team_meeting', 'training', 'one_to_one'];
const AGENT_ROLES = ['call_agent', 'field_agent'];
const DAY_MS = 24 * 3600 * 1000;

interface Actor {
  id: string;
  role: string;
}

interface Route {
  routedToRole: 'team_lead' | 'manager' | 'ceo';
  routedToStaffId: string | null;
  routeReason: string;
}

type AnyRequest = (LeaveRequest | AttendanceCorrection) & {
  staff?: { id: string; code: string; name: string; role: string };
};

@Injectable()
export class AttendanceRequestsService {
  private readonly logger = new Logger(AttendanceRequestsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly pricing: PricingService,
    private readonly scope: ReportingScopeService,
    private readonly audit: AuditService,
    private readonly messaging: MessagingService,
    private readonly attendance: AttendanceService,
    private readonly days: AttendanceDaysService,
    private readonly leave: LeaveService,
    private readonly hooks: AttendanceRequestHooks,
    private readonly clock: AttendanceClock,
  ) {}

  // ---------------------------------------------------------------- leave

  async balanceFor(actor: Actor, staffId: string) {
    if (!(await this.days.canSee(actor, staffId))) {
      throw new ForbiddenException('You cannot see this leave balance');
    }
    return this.leave.balance(staffId);
  }

  /**
   * Full days, or a half day (owner decision 12 Nov): `half` is "first" or
   * "second" for one date (toDate left out or the same as fromDate); "full" or
   * nothing means full days. A half day is ½ a day of the balance and counts ½
   * towards the Team Lead's 3 planned days a month.
   */
  async requestLeave(
    actor: Actor,
    body: { kind?: string; fromDate?: string; toDate?: string; reason?: string; half?: string | null },
  ) {
    const staff = await this.requireAttendanceStaff(actor.id);
    const kind = String(body?.kind ?? '') as LeaveKind;
    if (!(LEAVE_KINDS as readonly string[]).includes(kind)) {
      throw new BadRequestException('Leave is casual or emergency');
    }
    const reason = String(body?.reason ?? '').trim();
    if (!reason) throw new BadRequestException('A reason is required');
    const halfInput = body?.half === undefined || body?.half === null || body?.half === '' || body?.half === 'full' ? null : body.half;
    if (halfInput !== null && !isLeaveHalf(halfInput)) {
      throw new BadRequestException('half is "first" or "second" (or "full" for full days)');
    }
    const half = halfInput;
    const fromDate = this.parseDate(body?.fromDate, 'fromDate');
    const toDate = this.parseDate(body?.toDate || body?.fromDate, 'toDate');
    if (toDate.getTime() < fromDate.getTime()) {
      throw new BadRequestException('toDate is before fromDate');
    }
    if (half && toDate.getTime() !== fromDate.getTime()) {
      throw new BadRequestException('A half day of leave is for one date');
    }
    if ((toDate.getTime() - fromDate.getTime()) / DAY_MS > 92) {
      throw new BadRequestException('One request covers at most three months');
    }
    const { dates, days } = await this.leave.requestDays({ fromDate, toDate, half });
    if (dates.length === 0) {
      throw new BadRequestException(half ? 'This date is a weekly day off or a holiday' : 'These dates are all weekly days off');
    }
    // One leave per date (or per half of a date): a date already covered by a pending or approved
    // request is refused here, so an approval never has nothing to write.
    this.refuseOverlap(await this.leave.findOverlap(staff.id, dates, half, kind));

    let overLimit = false;
    if (kind === 'casual') {
      const perDate = half ? 0.5 : 1;
      const byMonth = new Map<string, number>();
      for (const date of dates) byMonth.set(monthOf(date), (byMonth.get(monthOf(date)) ?? 0) + perDate);
      for (const [month, count] of byMonth) {
        const already = await this.leave.casualDaysInMonth(staff.id, month);
        if (already.taken + already.pending + count > TEAM_LEAD_CASUAL_DAYS_LIMIT) {
          overLimit = true;
        }
      }
    }
    const route = await this.routeFor(staff, overLimit ? 'over_limit' : null);
    const now = this.clock.now();
    const created = await this.prisma.leaveRequest.create({
      data: {
        staffId: staff.id,
        kind,
        fromDate,
        toDate,
        half,
        days,
        reason,
        status: 'pending',
        ...route,
        createdAt: now,
      },
      include: { staff: { select: { id: true, code: true, name: true, role: true } } },
    });
    await this.audit.log({
      actorId: actor.id,
      action: 'attendance.leave_requested',
      entityType: 'leave_request',
      entityCode: staff.code,
      after: {
        kind,
        fromDate: this.label(fromDate),
        toDate: this.label(toDate),
        ...(half ? { half } : {}),
        days,
        routedToRole: route.routedToRole,
        routeReason: route.routeReason,
      },
    });
    await this.hooks.requestRouted('leave', created.id);
    return this.view('leave', created, actor, now);
  }

  // ---------------------------------------------------------- corrections

  async requestCorrection(
    actor: Actor,
    body: { date?: string; from?: string; to?: string; status?: string; reason?: string },
  ) {
    const staff = await this.requireAttendanceStaff(actor.id);
    const reason = String(body?.reason ?? '').trim();
    if (!reason) throw new BadRequestException('A reason is required');
    const date = this.parseDate(body?.date, 'date');
    const segmentStatus = String(body?.status ?? 'available');
    if (!CORRECTION_STATUSES.includes(segmentStatus)) {
      throw new BadRequestException(
        'A correction is for working time: available, team_meeting, training or one_to_one',
      );
    }
    const startAt = this.timeOn(date, body?.from, 'from');
    const endAt = this.timeOn(date, body?.to, 'to');
    if (endAt.getTime() <= startAt.getTime()) {
      throw new BadRequestException('"to" must be after "from"');
    }
    const now = this.clock.now();
    if (endAt.getTime() > now.getTime()) {
      throw new BadRequestException('A correction is for time that has already passed');
    }
    const day = await this.prisma.attendanceDay.findUnique({
      where: { staffId_date: { staffId: staff.id, date } },
    });
    // A full leave day takes no correction; a half day of leave has a working half that can.
    if (day?.dayType === 'leave' && !day.leaveHalf) {
      throw new BadRequestException('This is a leave day');
    }
    if (!day && date.getTime() === this.leave.todayIst().getTime()) {
      throw new BadRequestException('Log in first; a correction for today changes the open day');
    }
    const range = monthRange(monthOf(date));
    const earlier = await this.prisma.attendanceCorrection.count({
      where: { staffId: staff.id, date: { gte: range!.from, lte: range!.to } },
    });
    const monthNumber = earlier + 1;
    const route = await this.routeFor(
      staff,
      monthNumber >= CORRECTION_TO_MANAGER_FROM ? 'third_correction' : null,
    );
    const created = await this.prisma.attendanceCorrection.create({
      data: {
        staffId: staff.id,
        date,
        startAt,
        endAt,
        segmentStatus,
        reason,
        monthNumber,
        status: 'pending',
        ...route,
        createdAt: now,
      },
      include: { staff: { select: { id: true, code: true, name: true, role: true } } },
    });
    await this.audit.log({
      actorId: actor.id,
      action: 'attendance.correction_requested',
      entityType: 'attendance_correction',
      entityCode: staff.code,
      after: {
        date: this.label(date),
        startAt: startAt.toISOString(),
        endAt: endAt.toISOString(),
        segmentStatus,
        monthNumber,
        routedToRole: route.routedToRole,
        routeReason: route.routeReason,
      },
    });
    await this.hooks.requestRouted('correction', created.id);
    return this.view('correction', created, actor, now);
  }

  // ------------------------------------------------------------ decisions

  /**
   * Approve or reject, with a reason. A leave approval may name `fromDate` and
   * `toDate` inside the asked dates to approve only part of it (MG-Req-Vikram,
   * "approve 3 of 5 days"): those days become leave, the rest is rejected with
   * the same reason. A Team Lead never approves past 3 planned days in a month
   * for a person (guide, 9 Nov) — that is the Manager's decision.
   */
  async decide(
    actor: Actor,
    kind: string,
    id: string,
    decision: 'approved' | 'rejected',
    body: { reason?: string; fromDate?: string; toDate?: string },
  ) {
    const requestKind = this.kindOf(kind);
    const reason = String(body?.reason ?? '').trim();
    if (!reason) throw new BadRequestException('A reason is required');
    const request = await this.load(requestKind, id);
    const now = this.clock.now();
    await this.assertCanDecide(actor, request, now);
    const part =
      decision === 'approved' && requestKind === 'leave' && (body?.fromDate || body?.toDate)
        ? await this.partRange(request as LeaveRequest & AnyRequest, body)
        : null;
    if (decision === 'approved' && requestKind === 'leave') {
      await this.assertTeamLeadLimit(actor, request as LeaveRequest & AnyRequest, part);
    }
    if (decision === 'approved' && requestKind === 'correction') {
      const day = await this.prisma.attendanceDay.findUnique({
        where: { staffId_date: { staffId: request.staffId, date: (request as AttendanceCorrection).date } },
      });
      if (day?.dayType === 'leave' && !day.leaveHalf) throw new BadRequestException('This is a leave day');
    }
    // An approval changes attendance: refused in a month payroll no longer works out again.
    // A part approval writes only its own days, so only their months are checked (before anything is written).
    if (decision === 'approved') {
      await this.assertPayrollReaches(request, part ? { from: part.from, to: part.to, what: 'This part approval' } : undefined);
    }
    const data = {
      status: decision,
      decidedAt: now,
      decidedByStaffId: actor.id,
      decidedByRole: actor.role,
      decisionReason: reason,
    };
    const claimed =
      requestKind === 'leave'
        ? await this.prisma.leaveRequest.updateMany({ where: { id, status: 'pending' }, data })
        : await this.prisma.attendanceCorrection.updateMany({ where: { id, status: 'pending' }, data });
    if (claimed.count === 0) {
      throw await this.alreadyDecided(requestKind, id);
    }
    if (decision === 'approved') {
      if (requestKind === 'leave') {
        const fresh = await this.prisma.leaveRequest.findUniqueOrThrow({ where: { id } });
        const split = await this.leave.applyApproval(
          part ? { ...fresh, fromDate: part.from, toDate: part.to } : fresh,
        );
        await this.prisma.leaveRequest.update({
          where: { id },
          data: {
            ...split,
            ...(part ? { approvedFromDate: part.from, approvedToDate: part.to, approvedDays: part.days } : {}),
          },
        });
      } else {
        await this.applyCorrection(id);
      }
    }
    const staffCode = request.staff?.code ?? request.staffId;
    await this.audit.log({
      actorId: actor.id,
      action: `attendance.${requestKind}_${decision}`,
      entityType: requestKind === 'leave' ? 'leave_request' : 'attendance_correction',
      entityCode: staffCode,
      before: { status: 'pending' },
      after: part
        ? {
            status: decision,
            approvedFromDate: this.label(part.from),
            approvedToDate: this.label(part.to),
            approvedDays: part.days,
            rejectedDays: (request as LeaveRequest).days - part.days,
          }
        : { status: decision },
      reason,
    });
    await this.smsDecision(requestKind, id, part ? 'partly approved' : decision);
    await this.hooks.requestDecided(requestKind, id);
    return this.view(requestKind, await this.load(requestKind, id), actor, now);
  }

  async forward(actor: Actor, kind: string, id: string, body: { note?: string }) {
    const requestKind = this.kindOf(kind);
    const note = String(body?.note ?? '').trim();
    if (!note) throw new BadRequestException('A note is required to forward');
    const request = await this.load(requestKind, id);
    const now = this.clock.now();
    if (request.status !== 'pending') throw await this.alreadyDecided(requestKind, id);
    const placement = placementOf(request, now);
    if (
      actor.role !== 'team_lead' ||
      !placement.withTeamLead ||
      !(await this.scope.personIsUnder(actor.id, request.staffId))
    ) {
      throw new ForbiddenException("Only the person's Team Lead forwards a request with them");
    }
    const data = { forwardedAt: now, forwardedByStaffId: actor.id, forwardNote: note };
    const claimed =
      requestKind === 'leave'
        ? await this.prisma.leaveRequest.updateMany({
            where: { id, status: 'pending', forwardedAt: null },
            data,
          })
        : await this.prisma.attendanceCorrection.updateMany({
            where: { id, status: 'pending', forwardedAt: null },
            data,
          });
    if (claimed.count === 0) throw await this.alreadyDecided(requestKind, id);
    await this.audit.log({
      actorId: actor.id,
      action: `attendance.${requestKind}_forwarded`,
      entityType: requestKind === 'leave' ? 'leave_request' : 'attendance_correction',
      entityCode: request.staff?.code ?? request.staffId,
      after: { forwardedTo: 'manager' },
      reason: note,
    });
    await this.hooks.requestForwarded(requestKind, id);
    return this.view(requestKind, await this.load(requestKind, id), actor, now);
  }

  /**
   * "Send back to the Team Lead" (MG-Req-Sneha, MG-Req-Vikram): a Manager over
   * the person hands a request that is with them back to the person's Team
   * Lead, with a note. It stays pending, with the Team Lead again (their 24
   * hours start again); the Team Lead can decide it within their limits (never
   * past 3 planned days in a month), reject it, or forward it again. Audited;
   * the Team Lead's bell rings and the Manager's clears.
   */
  async sendBack(actor: Actor, kind: string, id: string, body: { note?: string }) {
    const requestKind = this.kindOf(kind);
    const note = String(body?.note ?? '').trim();
    if (!note) throw new BadRequestException('A note is required to send it back to the Team Lead');
    const request = await this.load(requestKind, id);
    const now = this.clock.now();
    if (request.status !== 'pending') throw await this.alreadyDecided(requestKind, id);
    const placement = placementOf(request, now);
    if (
      actor.role !== 'manager' ||
      !placement.withManager ||
      !(await this.scope.personIsUnder(actor.id, request.staffId))
    ) {
      throw new ForbiddenException("Only the person's Manager sends a request that is with them back to the Team Lead");
    }
    const role = request.staff?.role ?? '';
    const chain = await this.scope.chainOf(request.staffId);
    if (!AGENT_ROLES.includes(role) || !chain.teamLead) {
      throw new BadRequestException(
        role === 'team_lead'
          ? "A Team Lead's own request has no Team Lead to go back to"
          : 'This person has no Team Lead to send it back to',
      );
    }
    // The Team Lead could only approve it by changing attendance in those months, which payroll may no
    // longer work out again: refused here too (the Manager can still reject it; pay goes by manual correction).
    await this.assertPayrollReaches(request, { what: 'Sending this request back to the Team Lead' });
    const data = {
      routedToRole: 'team_lead',
      routedToStaffId: chain.teamLead.id,
      routeReason: 'sent_back',
      forwardedAt: null,
      forwardedByStaffId: null,
      forwardNote: null,
      sentBackAt: now,
      sentBackByStaffId: actor.id,
      sentBackNote: note,
    };
    const claimed =
      requestKind === 'leave'
        ? await this.prisma.leaveRequest.updateMany({ where: { id, status: 'pending' }, data })
        : await this.prisma.attendanceCorrection.updateMany({ where: { id, status: 'pending' }, data });
    if (claimed.count === 0) throw await this.alreadyDecided(requestKind, id);
    await this.audit.log({
      actorId: actor.id,
      action: `attendance.${requestKind}_sent_back`,
      entityType: requestKind === 'leave' ? 'leave_request' : 'attendance_correction',
      entityCode: request.staff?.code ?? request.staffId,
      before: { routedToRole: request.routedToRole, routeReason: request.routeReason, forwarded: Boolean(request.forwardedAt) },
      after: { routedToRole: 'team_lead', routeReason: 'sent_back', teamLead: chain.teamLead.code },
      reason: note,
    });
    await this.hooks.requestSentBack(requestKind, id);
    return this.view(requestKind, await this.load(requestKind, id), actor, now);
  }

  /**
   * A Manager over the person overturns a Team Lead's leave decision, with a
   * reason. The CEO can overturn any leave decision but their own.
   */
  async overturn(actor: Actor, kind: string, id: string, body: { reason?: string }) {
    const requestKind = this.kindOf(kind);
    if (requestKind !== 'leave') {
      throw new BadRequestException('Only a leave decision can be overturned');
    }
    const reason = String(body?.reason ?? '').trim();
    if (!reason) throw new BadRequestException('A reason is required to overturn a decision');
    const request = (await this.load('leave', id)) as LeaveRequest & AnyRequest;
    if (request.status === 'pending') {
      throw new BadRequestException('This request has not been decided yet');
    }
    if (request.overturnedAt) {
      throw new BadRequestException('This decision has already been overturned');
    }
    if (request.staffId === actor.id || request.decidedByStaffId === actor.id) {
      throw new ForbiddenException('You cannot overturn your own request or decision');
    }
    const allowed =
      actor.role === 'ceo' ||
      (actor.role === 'manager' &&
        request.decidedByRole === 'team_lead' &&
        (await this.scope.personIsUnder(actor.id, request.staffId)));
    if (!allowed) {
      throw new ForbiddenException(
        "A Manager over the person overturns a Team Lead's decision",
      );
    }
    // Either way an overturn changes attendance: refused in a month payroll no longer works out again.
    await this.assertPayrollReaches(request);
    const now = this.clock.now();
    const next = request.status === 'approved' ? 'rejected' : 'approved';
    if (next === 'approved') {
      // Another request may have taken the date since this one was rejected.
      const { dates } = await this.leave.requestDays(request);
      this.refuseOverlap(await this.leave.findOverlap(request.staffId, dates, isLeaveHalf(request.half) ? request.half : null, request.kind, request.id));
    }
    const claimed = await this.prisma.leaveRequest.updateMany({
      where: { id, status: request.status, overturnedAt: null },
      data: {
        status: next,
        overturnedAt: now,
        overturnedByStaffId: actor.id,
        overturnReason: reason,
        // An overturn decides the whole request again: no part approval stays.
        approvedFromDate: null,
        approvedToDate: null,
        approvedDays: null,
      },
    });
    if (claimed.count === 0) throw new ConflictException('This decision has just changed');
    if (next === 'rejected') {
      await this.leave.undoApproval(request);
      await this.prisma.leaveRequest.update({
        where: { id },
        data: { paidDays: 0, unpaidDays: 0 },
      });
    } else {
      const fresh = await this.prisma.leaveRequest.findUniqueOrThrow({ where: { id } });
      const split = await this.leave.applyApproval(fresh);
      await this.prisma.leaveRequest.update({ where: { id }, data: split });
    }
    await this.audit.log({
      actorId: actor.id,
      action: 'attendance.leave_overturned',
      entityType: 'leave_request',
      entityCode: request.staff?.code ?? request.staffId,
      before: { status: request.status },
      after: { status: next },
      reason,
    });
    await this.smsDecision('leave', id, next);
    await this.hooks.requestOverturned('leave', id);
    return this.view('leave', await this.load('leave', id), actor, now);
  }

  // ---------------------------------------------------------------- lists

  async mine(actor: Actor) {
    const now = this.clock.now();
    const [leave, corrections] = await Promise.all([
      this.prisma.leaveRequest.findMany({
        where: { staffId: actor.id },
        include: { staff: { select: { id: true, code: true, name: true, role: true } } },
        orderBy: { createdAt: 'desc' },
        take: 100,
      }),
      this.prisma.attendanceCorrection.findMany({
        where: { staffId: actor.id },
        include: { staff: { select: { id: true, code: true, name: true, role: true } } },
        orderBy: { createdAt: 'desc' },
        take: 100,
      }),
    ]);
    return this.sorted([
      ...(await Promise.all(leave.map((row) => this.view('leave', row, actor, now)))),
      ...(await Promise.all(corrections.map((row) => this.view('correction', row, actor, now)))),
    ]);
  }

  /** Team Lead: every request from their team, pending or decided in the last 30 days. */
  async team(actor: Actor) {
    const now = this.clock.now();
    const people = await this.peopleFor(actor);
    const since = new Date(now.getTime() - 30 * DAY_MS);
    const rows = await this.loadFor(people, {
      OR: [{ status: 'pending' }, { decidedAt: { gte: since } }],
    });
    return this.sorted(
      await Promise.all(rows.map(([kind, row]) => this.view(kind, row, actor, now))),
    );
  }

  /**
   * What is waiting for the caller, each with the plain reason it is with them.
   * Team Lead: their team's requests with them. Manager: requests in their
   * tree that are with the Manager. CEO: requests sent or escalated to the CEO.
   */
  async waiting(actor: Actor) {
    const now = this.clock.now();
    const people = actor.role === 'ceo' ? null : await this.peopleFor(actor);
    const rows = await this.loadFor(people, { status: 'pending' });
    const out = [];
    for (const [kind, row] of rows) {
      const placement = placementOf(row, now);
      let why: string | null = null;
      if (actor.role === 'team_lead' && placement.withTeamLead) {
        why = row.routeReason;
      } else if (actor.role === 'manager' && placement.withManager) {
        why = placement.managerReason;
      } else if (actor.role === 'ceo') {
        if (placement.withCeo) {
          why = placement.ceoReason;
        } else if (placement.withManager) {
          const chain = await this.scope.chainOf(row.staffId);
          if (!chain.manager) why = placement.managerReason;
        }
      }
      if (!why) continue;
      out.push({
        ...(await this.view(kind, row, actor, now)),
        whyWithYou: why,
        whyWithYouText: REASON_TEXT[why] ?? why,
      });
    }
    return this.sorted(out);
  }

  /** Decided since Monday (IST) in the caller's scope, by anyone. */
  async decidedThisWeek(actor: Actor) {
    const now = this.clock.now();
    const people = actor.role === 'ceo' ? null : await this.peopleFor(actor);
    const today = this.leave.todayIst();
    const weekday = (today.getUTCDay() + 6) % 7; // Monday = 0
    const mondayIst = new Date(today.getTime() - weekday * DAY_MS);
    const since = new Date(mondayIst.getTime() - 5.5 * 3600 * 1000);
    const rows = await this.loadFor(people, { decidedAt: { gte: since } });
    return this.sorted(
      await Promise.all(rows.map(([kind, row]) => this.view(kind, row, actor, now))),
    );
  }

  // ------------------------------------------------------------- internals

  /** A date (or half) already covered by another pending or approved leave request: refused with a code the screens translate. */
  private refuseOverlap(overlap: { date: string; reason: 'covered' | 'other_kind' } | null): void {
    if (!overlap) return;
    throw new BadRequestException({
      statusCode: 400,
      error: 'Bad Request',
      code: overlap.reason === 'covered' ? 'leave_overlap' : 'leave_other_kind',
      date: overlap.date,
      message:
        overlap.reason === 'covered'
          ? `You already have leave asked for or approved on ${overlap.date}. Pick other dates, or cancel that request first.`
          : `The other half of ${overlap.date} is a different kind of leave. Ask for the same kind, or a full day.`,
    });
  }

  /** The part of a leave request to approve: inside the asked dates, at least one leave day, fewer than all. */
  private async partRange(
    request: LeaveRequest & AnyRequest,
    body: { fromDate?: string; toDate?: string },
  ): Promise<{ from: Date; to: Date; days: number } | null> {
    const from = this.parseDate(body.fromDate ?? this.label(request.fromDate), 'fromDate');
    const to = this.parseDate(body.toDate ?? this.label(request.toDate), 'toDate');
    if (to.getTime() < from.getTime()) throw new BadRequestException('toDate is before fromDate');
    if (from.getTime() < request.fromDate.getTime() || to.getTime() > request.toDate.getTime()) {
      throw new BadRequestException('Approve days inside the dates asked for');
    }
    const { dates, days } = await this.leave.requestDays({ fromDate: from, toDate: to, half: request.half });
    if (dates.length === 0) throw new BadRequestException('These dates are all weekly days off');
    // The whole request (or every leave day in it, or its one half day) is a plain approval.
    if (days >= request.days) return null;
    return { from, to, days };
  }

  /**
   * A Team Lead approves up to 3 planned (casual) days in a month for a
   * person (guide, 9 Nov). Approved planned days already on the record plus
   * the days being approved must stay within it; past that only a Manager
   * (or the CEO) approves. Emergency leave is not counted.
   */
  private async assertTeamLeadLimit(
    actor: Actor,
    request: LeaveRequest & AnyRequest,
    part: { from: Date; to: Date } | null,
  ): Promise<void> {
    if (actor.role !== 'team_lead' || request.kind !== 'casual') return;
    const dates = await this.leave.leaveDates(part?.from ?? request.fromDate, part?.to ?? request.toDate);
    // Counted in days with halves: a half day is ½ of the 3 planned days.
    const perDate = isLeaveHalf(request.half) ? 0.5 : 1;
    const byMonth = new Map<string, number>();
    for (const date of dates) byMonth.set(monthOf(date), (byMonth.get(monthOf(date)) ?? 0) + perDate);
    for (const [month, count] of byMonth) {
      const { taken } = await this.leave.casualDaysInMonth(request.staffId, month, request.id);
      if (taken + count > TEAM_LEAD_CASUAL_DAYS_LIMIT) {
        throw new ForbiddenException(
          `More than ${TEAM_LEAD_CASUAL_DAYS_LIMIT} planned days in ${month} (${taken} already taken): only the Manager approves this. Reject it or send it to the Manager.`,
        );
      }
    }
  }

  private async routeFor(
    staff: { id: string; role: string },
    limitReason: 'over_limit' | 'third_correction' | null,
  ): Promise<Route> {
    const chain = await this.scope.chainOf(staff.id);
    const ceoId = chain.ceo?.id ?? (await this.anyCeoId());
    const toCeo = (routeReason: string): Route => ({
      routedToRole: 'ceo',
      routedToStaffId: ceoId,
      routeReason,
    });
    if (AGENT_ROLES.includes(staff.role)) {
      if (limitReason) {
        return chain.manager
          ? { routedToRole: 'manager', routedToStaffId: chain.manager.id, routeReason: limitReason }
          : toCeo(limitReason);
      }
      return chain.teamLead
        ? { routedToRole: 'team_lead', routedToStaffId: chain.teamLead.id, routeReason: 'team_lead' }
        : toCeo('no_line');
    }
    if (staff.role === 'team_lead') {
      return chain.manager
        ? { routedToRole: 'manager', routedToStaffId: chain.manager.id, routeReason: 'team_lead_own' }
        : toCeo('no_line');
    }
    if (staff.role === 'manager') return toCeo('manager_own');
    return toCeo('finance_own');
  }

  private async assertCanDecide(actor: Actor, request: AnyRequest, now: Date): Promise<void> {
    if (request.staffId === actor.id) {
      throw new ForbiddenException('You cannot decide your own request');
    }
    if (request.status !== 'pending') {
      throw await this.alreadyDecided(
        'kind' in request ? 'leave' : 'correction',
        request.id,
      );
    }
    if (actor.role === 'ceo') return;
    const placement = placementOf(request, now);
    const under = await this.scope.personIsUnder(actor.id, request.staffId);
    if (actor.role === 'team_lead' && placement.withTeamLead && under) return;
    if (actor.role === 'manager' && placement.withManager && under) return;
    if (actor.role === 'team_lead' && under) {
      throw new ForbiddenException('This request is with the Manager');
    }
    if (actor.role === 'manager' && under) {
      throw new ForbiddenException('This request is still with the Team Lead');
    }
    throw new ForbiddenException('This request is not in your team');
  }

  /**
   * The request's dates (a leave's range — or only the approved part of it —
   * or a correction's day) must be in months payroll still works out again.
   */
  private async assertPayrollReaches(
    request: AnyRequest,
    options?: { from?: Date; to?: Date; what?: string },
  ): Promise<void> {
    const months =
      'fromDate' in request
        ? monthsBetween(
            monthOfDay(options?.from ?? (request as LeaveRequest).fromDate),
            monthOfDay(options?.to ?? (request as LeaveRequest).toDate),
          )
        : [monthOfDay((request as AttendanceCorrection).date)];
    await assertPayrollCanCorrect(
      this.prisma,
      months,
      options?.what ?? ('kind' in request ? 'This leave decision' : 'This attendance correction'),
    );
  }

  private async alreadyDecided(kind: AttendanceRequestKind, id: string) {
    const row = await this.load(kind, id);
    const decider = row.decidedByStaffId
      ? await this.prisma.staff.findUnique({
          where: { id: row.decidedByStaffId },
          select: { code: true, name: true, role: true },
        })
      : null;
    return new ConflictException({
      statusCode: 409,
      message: decider
        ? `Already ${row.status} by ${decider.name} (${decider.code})`
        : 'This request has already been handled',
      decidedBy: decider,
      status: row.status,
    });
  }

  /**
   * Applies an approved correction: the time range becomes one segment with
   * source `correction`, overlapping segments are trimmed or split, the old
   * segments are kept on the correction, and the day is recalculated.
   */
  private async applyCorrection(id: string): Promise<void> {
    const correction = await this.prisma.attendanceCorrection.findUniqueOrThrow({ where: { id } });
    const policy = await this.pricing.current();
    let day = await this.prisma.attendanceDay.findUnique({
      where: { staffId_date: { staffId: correction.staffId, date: correction.date } },
      include: { segments: true },
    });
    if (!day) {
      day = await this.prisma.attendanceDay.create({
        data: {
          staffId: correction.staffId,
          date: correction.date,
          loginAt: correction.startAt,
          logoutAt: correction.endAt,
          closedReason: 'correction',
          dayType: 'open',
          lateMinutes: this.attendance.lateMinutes(correction.startAt, policy),
        },
        include: { segments: true },
      });
    } else {
      const loginAt =
        !day.loginAt || correction.startAt.getTime() < day.loginAt.getTime()
          ? correction.startAt
          : day.loginAt;
      const wasPlaceholder = !day.loginAt;
      const logoutAt = wasPlaceholder
        ? correction.endAt
        : day.logoutAt && correction.endAt.getTime() > day.logoutAt.getTime()
          ? correction.endAt
          : day.logoutAt;
      day = await this.prisma.attendanceDay.update({
        where: { id: day.id },
        data: {
          loginAt,
          logoutAt,
          lateMinutes: this.attendance.lateMinutes(loginAt, policy, day.leaveKind ? day.leaveHalf : null),
          ...(wasPlaceholder ? { dayType: 'open', closedReason: 'correction' } : {}),
        },
        include: { segments: true },
      });
    }
    const replaced = await this.spliceSegments(day.id, correction);
    await this.prisma.attendanceCorrection.update({
      where: { id },
      data: { replacedSegments: replaced as unknown as Prisma.InputJsonValue },
    });
    await this.attendance.recalculateDay(day.id);
  }

  private async spliceSegments(
    dayId: string,
    correction: AttendanceCorrection,
  ): Promise<Array<Record<string, unknown>>> {
    const a = correction.startAt.getTime();
    const b = correction.endAt.getTime();
    const segments = await this.prisma.attendanceSegment.findMany({
      where: { dayId },
      orderBy: { startedAt: 'asc' },
    });
    const replaced: Array<Record<string, unknown>> = [];
    for (const segment of segments) {
      const start = segment.startedAt.getTime();
      const end = segment.endedAt ? segment.endedAt.getTime() : Number.POSITIVE_INFINITY;
      if (end <= a || start >= b) continue;
      replaced.push(this.snapshot(segment));
      if (start < a && end > b) {
        await this.prisma.attendanceSegment.update({
          where: { id: segment.id },
          data: { endedAt: new Date(a) },
        });
        await this.prisma.attendanceSegment.create({
          data: {
            staffId: segment.staffId,
            dayId,
            status: segment.status,
            startedAt: new Date(b),
            endedAt: segment.endedAt,
            source: segment.source,
            approvedAt: segment.approvedAt,
            approvedByStaffId: segment.approvedByStaffId,
          },
        });
      } else if (start < a) {
        await this.prisma.attendanceSegment.update({
          where: { id: segment.id },
          data: { endedAt: new Date(a) },
        });
      } else if (end > b) {
        await this.prisma.attendanceSegment.update({
          where: { id: segment.id },
          data: { startedAt: new Date(b) },
        });
      } else {
        await this.prisma.attendanceSegment.delete({ where: { id: segment.id } });
      }
    }
    await this.prisma.attendanceSegment.create({
      data: {
        staffId: correction.staffId,
        dayId,
        status: correction.segmentStatus,
        startedAt: correction.startAt,
        endedAt: correction.endAt,
        source: 'correction',
      },
    });
    return replaced;
  }

  private snapshot(segment: AttendanceSegment): Record<string, unknown> {
    return {
      id: segment.id,
      status: segment.status,
      startedAt: segment.startedAt.toISOString(),
      endedAt: segment.endedAt?.toISOString() ?? null,
      source: segment.source,
    };
  }

  private async smsDecision(kind: AttendanceRequestKind, id: string, decision: string) {
    try {
      const row = await this.load(kind, id);
      const staff = await this.prisma.staff.findUnique({
        where: { id: row.staffId },
        select: { callRoutingPhone: true },
      });
      let phone: string | undefined;
      if (staff?.callRoutingPhone) {
        try {
          phone = decryptCallRoutingPhone(staff.callRoutingPhone);
        } catch {
          phone = undefined;
        }
      }
      const dates =
        kind === 'leave'
          ? `${this.label((row as LeaveRequest).fromDate)} to ${this.label((row as LeaveRequest).toDate)}`
          : this.label((row as AttendanceCorrection).date);
      await this.messaging.send({
        channel: 'sms',
        template: kind === 'leave' ? 'attendance_leave_decision' : 'attendance_correction_decision',
        subjectType: 'staff',
        subjectId: row.staffId,
        relatedType: kind === 'leave' ? 'leave_request' : 'attendance_correction',
        relatedId: id,
        variables: { decision, dates },
        ...(phone ? { recipientPhone: phone } : {}),
      });
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.warn(`Decision SMS not sent: ${message}`);
    }
  }

  private async view(kind: AttendanceRequestKind, row: AnyRequest, actor: Actor, now: Date) {
    const placement: Placement = placementOf(row, now);
    const deciderIds = [row.decidedByStaffId, row.forwardedByStaffId, row.sentBackByStaffId].filter(
      (value): value is string => Boolean(value),
    );
    if (kind === 'leave' && (row as LeaveRequest).overturnedByStaffId) {
      deciderIds.push((row as LeaveRequest).overturnedByStaffId as string);
    }
    const people = deciderIds.length
      ? await this.prisma.staff.findMany({
          where: { id: { in: deciderIds } },
          select: { id: true, code: true, name: true, role: true },
        })
      : [];
    const who = (staffId: string | null) => people.find((person) => person.id === staffId) ?? null;
    const base = {
      kind,
      id: row.id,
      staff: row.staff ?? null,
      status: row.status,
      reason: row.reason,
      where: whereLabel(placement, row.status),
      withTeamLead: placement.withTeamLead,
      withManager: placement.withManager,
      withCeo: placement.withCeo,
      routedToRole: row.routedToRole,
      routeReason: row.routeReason,
      routeReasonText: REASON_TEXT[row.routeReason] ?? row.routeReason,
      createdAt: row.createdAt.toISOString(),
      forwarded: row.forwardedAt
        ? { at: row.forwardedAt.toISOString(), by: who(row.forwardedByStaffId), note: row.forwardNote }
        : null,
      decided: row.decidedAt
        ? {
            at: row.decidedAt.toISOString(),
            by: who(row.decidedByStaffId),
            role: row.decidedByRole,
            reason: row.decisionReason,
          }
        : null,
      canDecide: await this.canDecideQuietly(actor, row, now),
      sentBack: row.sentBackAt
        ? { at: row.sentBackAt.toISOString(), by: who(row.sentBackByStaffId), note: row.sentBackNote }
        : null,
    };
    if (kind === 'leave') {
      const leave = row as LeaveRequest;
      const month = monthOf(leave.fromDate);
      const casual = await this.leave.casualDaysInMonth(leave.staffId, month, leave.id);
      return {
        ...base,
        leaveKind: leave.kind,
        fromDate: this.label(leave.fromDate),
        toDate: this.label(leave.toDate),
        /** "first" or "second" for a half day of leave; null for full days. */
        half: isLeaveHalf(leave.half) ? leave.half : null,
        days: leave.days,
        paidDays: leave.paidDays,
        unpaidDays: leave.unpaidDays,
        approvedFromDate: leave.approvedFromDate ? this.label(leave.approvedFromDate) : null,
        approvedToDate: leave.approvedToDate ? this.label(leave.approvedToDate) : null,
        approvedDays: leave.approvedDays ?? null,
        casualDaysTakenThisMonth: casual.taken,
        casualDaysPendingThisMonth: casual.pending,
        overturned: leave.overturnedAt
          ? {
              at: leave.overturnedAt.toISOString(),
              by: who(leave.overturnedByStaffId),
              reason: leave.overturnReason,
            }
          : null,
      };
    }
    const correction = row as AttendanceCorrection;
    return {
      ...base,
      date: this.label(correction.date),
      startAt: correction.startAt.toISOString(),
      endAt: correction.endAt.toISOString(),
      segmentStatus: correction.segmentStatus,
      monthNumber: correction.monthNumber,
    };
  }

  private async canDecideQuietly(actor: Actor, row: AnyRequest, now: Date): Promise<boolean> {
    if (row.status !== 'pending' || row.staffId === actor.id) return false;
    try {
      await this.assertCanDecide(actor, row, now);
      return true;
    } catch {
      return false;
    }
  }

  private sorted<T extends { createdAt: string }>(rows: T[]): T[] {
    return rows.sort((x, y) => y.createdAt.localeCompare(x.createdAt));
  }

  private async peopleFor(actor: Actor): Promise<string[]> {
    if (actor.role === 'team_lead' || actor.role === 'manager') {
      return this.scope.peopleUnder(actor.id);
    }
    if (actor.role === 'ceo') {
      return (await this.prisma.staff.findMany({ select: { id: true } })).map((row) => row.id);
    }
    return [];
  }

  private async loadFor(
    people: string[] | null,
    where: Prisma.LeaveRequestWhereInput & Prisma.AttendanceCorrectionWhereInput,
  ): Promise<Array<[AttendanceRequestKind, AnyRequest]>> {
    const scoped = people ? { staffId: { in: people } } : {};
    const include = { staff: { select: { id: true, code: true, name: true, role: true } } };
    const [leave, corrections] = await Promise.all([
      this.prisma.leaveRequest.findMany({
        where: { ...where, ...scoped } as Prisma.LeaveRequestWhereInput,
        include,
        orderBy: { createdAt: 'desc' },
        take: 300,
      }),
      this.prisma.attendanceCorrection.findMany({
        where: { ...where, ...scoped } as Prisma.AttendanceCorrectionWhereInput,
        include,
        orderBy: { createdAt: 'desc' },
        take: 300,
      }),
    ]);
    return [
      ...leave.map((row) => ['leave', row] as [AttendanceRequestKind, AnyRequest]),
      ...corrections.map((row) => ['correction', row] as [AttendanceRequestKind, AnyRequest]),
    ];
  }

  private async load(kind: AttendanceRequestKind, id: string): Promise<AnyRequest> {
    const include = { staff: { select: { id: true, code: true, name: true, role: true } } };
    const row =
      kind === 'leave'
        ? await this.prisma.leaveRequest.findUnique({ where: { id }, include })
        : await this.prisma.attendanceCorrection.findUnique({ where: { id }, include });
    if (!row) throw new NotFoundException('Request not found');
    return row;
  }

  private kindOf(kind: string): AttendanceRequestKind {
    if (kind === 'leave' || kind === 'correction') return kind;
    throw new BadRequestException('Request kind is leave or correction');
  }

  private async requireAttendanceStaff(id: string) {
    const staff = await this.prisma.staff.findUnique({
      where: { id },
      select: { id: true, code: true, role: true, status: true },
    });
    if (!staff) throw new NotFoundException('Staff account not found');
    if (!ATTENDANCE_ROLES.includes(staff.role)) {
      throw new BadRequestException('The CEO does not mark attendance');
    }
    return staff;
  }

  private async anyCeoId(): Promise<string | null> {
    const ceo = await this.prisma.staff.findFirst({
      where: { role: 'ceo', status: 'active' },
      orderBy: { createdAt: 'asc' },
      select: { id: true },
    });
    return ceo?.id ?? null;
  }

  private parseDate(value: string | undefined, field: string): Date {
    const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(value ?? ''));
    if (!match) throw new BadRequestException(`${field} must look like 2026-11-20`);
    const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
    if (Number.isNaN(date.getTime()) || this.label(date) !== match[0]) {
      throw new BadRequestException(`${field} is not a real date`);
    }
    return date;
  }

  private timeOn(date: Date, value: string | undefined, field: string): Date {
    const match = /^(\d{2}):(\d{2})$/.exec(String(value ?? ''));
    if (!match || Number(match[1]) > 23 || Number(match[2]) > 59) {
      throw new BadRequestException(`"${field}" must look like 09:30`);
    }
    return localCalendarToUtc(
      date.getUTCFullYear(),
      date.getUTCMonth() + 1,
      date.getUTCDate(),
      Number(match[1]),
      Number(match[2]),
    );
  }

  private label(date: Date): string {
    return date.toISOString().slice(0, 10);
  }
}
