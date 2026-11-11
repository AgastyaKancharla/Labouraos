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
import {
  CORRECTION_TO_MANAGER_FROM,
  Placement,
  REASON_TEXT,
  TEAM_LEAD_CASUAL_DAYS_LIMIT,
  placementOf,
  whereLabel,
} from './request-routing';

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

  async requestLeave(
    actor: Actor,
    body: { kind?: string; fromDate?: string; toDate?: string; reason?: string },
  ) {
    const staff = await this.requireAttendanceStaff(actor.id);
    const kind = String(body?.kind ?? '') as LeaveKind;
    if (!(LEAVE_KINDS as readonly string[]).includes(kind)) {
      throw new BadRequestException('Leave is casual or emergency');
    }
    const reason = String(body?.reason ?? '').trim();
    if (!reason) throw new BadRequestException('A reason is required');
    const fromDate = this.parseDate(body?.fromDate, 'fromDate');
    const toDate = this.parseDate(body?.toDate ?? body?.fromDate, 'toDate');
    if (toDate.getTime() < fromDate.getTime()) {
      throw new BadRequestException('toDate is before fromDate');
    }
    if ((toDate.getTime() - fromDate.getTime()) / DAY_MS > 92) {
      throw new BadRequestException('One request covers at most three months');
    }
    const dates = await this.leave.leaveDates(fromDate, toDate);
    if (dates.length === 0) {
      throw new BadRequestException('These dates are all weekly days off');
    }

    let overLimit = false;
    if (kind === 'casual') {
      const byMonth = new Map<string, number>();
      for (const date of dates) byMonth.set(monthOf(date), (byMonth.get(monthOf(date)) ?? 0) + 1);
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
        days: dates.length,
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
        days: dates.length,
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
    if (day?.dayType === 'leave') {
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

  async decide(
    actor: Actor,
    kind: string,
    id: string,
    decision: 'approved' | 'rejected',
    body: { reason?: string },
  ) {
    const requestKind = this.kindOf(kind);
    const reason = String(body?.reason ?? '').trim();
    if (!reason) throw new BadRequestException('A reason is required');
    const request = await this.load(requestKind, id);
    const now = this.clock.now();
    await this.assertCanDecide(actor, request, now);
    if (decision === 'approved' && requestKind === 'correction') {
      const day = await this.prisma.attendanceDay.findUnique({
        where: { staffId_date: { staffId: request.staffId, date: (request as AttendanceCorrection).date } },
      });
      if (day?.dayType === 'leave') throw new BadRequestException('This is a leave day');
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
        const split = await this.leave.applyApproval(fresh);
        await this.prisma.leaveRequest.update({ where: { id }, data: split });
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
      after: { status: decision },
      reason,
    });
    await this.smsDecision(requestKind, id, decision);
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
    const now = this.clock.now();
    const next = request.status === 'approved' ? 'rejected' : 'approved';
    const claimed = await this.prisma.leaveRequest.updateMany({
      where: { id, status: request.status, overturnedAt: null },
      data: {
        status: next,
        overturnedAt: now,
        overturnedByStaffId: actor.id,
        overturnReason: reason,
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
          lateMinutes: this.attendance.lateMinutes(loginAt, policy),
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
    const deciderIds = [row.decidedByStaffId, row.forwardedByStaffId].filter(
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
        days: leave.days,
        paidDays: leave.paidDays,
        unpaidDays: leave.unpaidDays,
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
