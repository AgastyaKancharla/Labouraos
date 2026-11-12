import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { AttendanceSegment, PricingPolicy } from '@prisma/client';
import { PrismaService } from '../../common/prisma/prisma.service';
import { AuditService } from '../../common/audit/audit.service';
import { recordStatusChange } from '../../common/status-history/status-history.helper';
import { PricingService } from '../pricing/pricing.service';
import { ReportingScopeService } from '../staff/reporting-scope.service';
import { AttendanceClock } from './attendance-clock';
import { AttendanceService } from './attendance.service';
import { classifyDay, deductibleShortfall, monthRange } from './day-rules';
import { dayTally } from './leave-units';
import { WorkingDaysService } from './working-days.service';
import { assertPayrollCanCorrect, monthOfDay } from '../finance/payroll-window';

/** Roles that mark attendance. The CEO does not (Master Guide, Attendance). */
export const ATTENDANCE_ROLES = ['manager', 'team_lead', 'call_agent', 'field_agent', 'finance'];

/** Day types a Team Lead or Manager may set with Change day. */
const CHANGEABLE_TO = ['full', 'half'];
/** Day types Change day may start from. Leave goes through the leave flow. */
const CHANGEABLE_FROM = ['full', 'half', 'absent'];

export interface DayRow {
  id: string;
  date: string;
  dayType: string;
  loginAt: string | null;
  logoutAt: string | null;
  lateMinutes: number;
  productionSeconds: number;
  breakSeconds: number;
  breakOverSeconds: number;
  /** Short breaks taken that day (the guide allows two 15-minute breaks a day, plus lunch). */
  breakCount: number;
  idleSeconds: number;
  shortfallSeconds: number;
  makeUpSeconds: number;
  flagged: boolean;
  closedReason: string | null;
  leaveKind: string | null;
  leaveUnpaid: boolean;
  /** "first" or "second" on a day with a half day of leave (owner decision 12 Nov); null otherwise. */
  leaveHalf: string | null;
  /** A full leave day half paid, half unpaid (the balance ran out half way). */
  leavePartUnpaid: boolean;
  change: { byStaffId: string | null; at: string; reason: string | null } | null;
}

/** Day counts are whole or half days since half-day leave (owner decision 12 Nov). */
export interface MonthSummary {
  staff: { id: string; code: string; name: string; role: string };
  month: string;
  fullDays: number;
  halfDays: number;
  absentDays: number;
  offDaysWorked: number;
  paidLeaveDays: { casual: number; emergency: number; total: number };
  unpaidLeaveDays: number;
  lateLogins: { count: number; days: Array<{ date: string; minutes: number }> };
  productionSeconds: number;
  breakSeconds: number;
  breakOverSeconds: number;
  idleSeconds: number;
  shortfallSeconds: number;
  makeUpSeconds: number;
  deductibleShortfallSeconds: number;
  /** Working days in the month: weekly days off and holidays left out. */
  workingDays: number;
  /** Public holidays in the month (paid days off, never absent). */
  holidays: Array<{ date: string; name: string }>;
  days: DayRow[];
}

interface Actor {
  id: string;
  role: string;
}

@Injectable()
export class AttendanceDaysService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly pricing: PricingService,
    private readonly scope: ReportingScopeService,
    private readonly audit: AuditService,
    private readonly attendance: AttendanceService,
    private readonly clock: AttendanceClock,
    private readonly workingDays: WorkingDaysService,
  ) {}

  /**
   * Who may see a person's attendance: the person; their Team Lead; a
   * Manager over them; Finance and the CEO for everyone.
   */
  async canSee(actor: Actor, staffId: string): Promise<boolean> {
    if (actor.id === staffId) return true;
    if (actor.role === 'ceo' || actor.role === 'finance') return true;
    if (actor.role === 'team_lead' || actor.role === 'manager') {
      return this.scope.personIsUnder(actor.id, staffId);
    }
    return false;
  }

  /**
   * Who may act on a person's attendance (Change day, corrections): their
   * Team Lead, a Manager over them, or the CEO. Never the person themselves.
   */
  async canManage(actor: Actor, staffId: string): Promise<boolean> {
    if (actor.id === staffId) return false;
    if (actor.role === 'ceo') return true;
    if (actor.role === 'team_lead' || actor.role === 'manager') {
      return this.scope.personIsUnder(actor.id, staffId);
    }
    return false;
  }

  async changeDayType(
    actor: Actor,
    dayId: string,
    body: { dayType?: string; reason?: string },
  ): Promise<DayRow> {
    const dayType = String(body?.dayType ?? '');
    const reason = String(body?.reason ?? '').trim();
    if (!CHANGEABLE_TO.includes(dayType)) {
      throw new BadRequestException('A day can be changed to a full day or a half day');
    }
    if (!reason) {
      throw new BadRequestException('A reason is required to change a day');
    }
    const day = await this.prisma.attendanceDay.findUnique({
      where: { id: dayId },
      include: { staff: { select: { id: true, code: true } } },
    });
    if (!day) throw new NotFoundException('Attendance day not found');
    if (day.staffId === actor.id) {
      throw new ForbiddenException('You cannot change your own day');
    }
    if (!(await this.canManage(actor, day.staffId))) {
      throw new ForbiddenException(
        "Only the person's Team Lead, a Manager over them or the CEO can change a day",
      );
    }
    if (day.dayType === 'open') {
      throw new BadRequestException('The day is still open');
    }
    if (!CHANGEABLE_FROM.includes(day.dayType)) {
      throw new BadRequestException('Only a full, half or absent day can be changed');
    }
    await assertPayrollCanCorrect(this.prisma, [monthOfDay(day.date)], 'This day change');
    const now = this.clock.now();
    const policy = await this.pricing.current();
    const makeUp =
      dayType === 'full'
        ? classifyDay(day.productionSeconds, policy, false, Boolean(day.leaveHalf && day.leaveKind)).makeUpSeconds
        : 0;
    const updated = await this.prisma.$transaction(async (tx) => {
      const row = await tx.attendanceDay.update({
        where: { id: day.id },
        data: {
          dayType,
          shortfallSeconds: 0,
          makeUpSeconds: makeUp,
          dayTypeChangedById: actor.id,
          dayTypeChangedAt: now,
          dayTypeChangeReason: reason,
        },
        include: { segments: true },
      });
      await recordStatusChange(tx, {
        subjectType: 'attendance_day',
        subjectId: day.id,
        fromStatus: day.dayType,
        toStatus: dayType,
        changedByStaffId: actor.id,
        reason,
        changedAt: now,
      });
      return row;
    });
    await this.audit.log({
      actorId: actor.id,
      action: 'attendance.day_changed',
      entityType: 'attendance_day',
      entityCode: day.staff.code,
      before: {
        date: this.label(day.date),
        dayType: day.dayType,
        shortfallSeconds: day.shortfallSeconds,
      },
      after: { date: this.label(day.date), dayType, shortfallSeconds: 0 },
      reason,
    });
    return this.dayRow(updated, policy);
  }

  /** History of Change day for one day, newest first. */
  async dayHistory(actor: Actor, dayId: string) {
    const day = await this.prisma.attendanceDay.findUnique({ where: { id: dayId } });
    if (!day) throw new NotFoundException('Attendance day not found');
    if (!(await this.canSee(actor, day.staffId))) {
      throw new ForbiddenException('You cannot see this attendance');
    }
    const rows = await this.prisma.statusHistory.findMany({
      where: { subjectType: 'attendance_day', subjectId: dayId },
      orderBy: { changedAt: 'desc' },
    });
    return rows.map((row) => ({
      from: row.fromStatus,
      to: row.toStatus,
      reason: row.reason,
      changedByStaffId: row.changedByStaffId,
      changedAt: row.changedAt.toISOString(),
    }));
  }

  async monthSummary(actor: Actor, staffId: string, month: string): Promise<MonthSummary> {
    if (!(await this.canSee(actor, staffId))) {
      throw new ForbiddenException('You cannot see this attendance');
    }
    return this.summaryFor(staffId, month);
  }

  /** The month summary without an access check. Callers check access first. */
  async summaryFor(staffId: string, month: string): Promise<MonthSummary> {
    const range = monthRange(month);
    if (!range) throw new BadRequestException('month must look like 2026-11');
    const staff = await this.prisma.staff.findUnique({
      where: { id: staffId },
      select: { id: true, code: true, name: true, role: true },
    });
    if (!staff) throw new NotFoundException('Staff account not found');
    const rows = await this.rowsBetween(staffId, range.from, range.to);
    const summary: MonthSummary = {
      staff,
      month,
      fullDays: 0,
      halfDays: 0,
      absentDays: 0,
      offDaysWorked: 0,
      paidLeaveDays: { casual: 0, emergency: 0, total: 0 },
      unpaidLeaveDays: 0,
      lateLogins: { count: 0, days: [] },
      productionSeconds: 0,
      breakSeconds: 0,
      breakOverSeconds: 0,
      idleSeconds: 0,
      shortfallSeconds: 0,
      makeUpSeconds: 0,
      deductibleShortfallSeconds: 0,
      workingDays: 0,
      holidays: [],
      days: rows,
    };
    for (const row of rows) {
      if (row.dayType === 'off') summary.offDaysWorked += 1;
      if (row.dayType !== 'open') {
        // Whole and half days: a half day of leave is half leave and a working half.
        const tally = dayTally(row);
        summary.fullDays += tally.fullHalves / 2;
        summary.halfDays += tally.halfDays;
        summary.absentDays += tally.absentHalves / 2;
        summary.unpaidLeaveDays += tally.unpaidLeaveHalves / 2;
        summary.paidLeaveDays.emergency += tally.emergencyPaidHalves / 2;
        summary.paidLeaveDays.casual += (tally.paidLeaveHalves - tally.emergencyPaidHalves) / 2;
      }
      if (row.lateMinutes > 0) {
        summary.lateLogins.days.push({ date: row.date, minutes: row.lateMinutes });
      }
      summary.productionSeconds += row.productionSeconds;
      summary.breakSeconds += row.breakSeconds;
      summary.breakOverSeconds += row.breakOverSeconds;
      summary.idleSeconds += row.idleSeconds;
      if (row.dayType !== 'open') {
        summary.shortfallSeconds += row.shortfallSeconds;
        summary.makeUpSeconds += row.makeUpSeconds;
      }
    }
    summary.paidLeaveDays.total =
      summary.paidLeaveDays.casual + summary.paidLeaveDays.emergency;
    summary.lateLogins.count = summary.lateLogins.days.length;
    summary.deductibleShortfallSeconds = deductibleShortfall(
      summary.shortfallSeconds,
      summary.makeUpSeconds,
    );
    const calendar = await this.workingDays.calendar(range.from, range.to);
    summary.workingDays = calendar.workingDates.length;
    summary.holidays = calendar.holidays.map((holiday) => ({
      date: this.label(holiday.date),
      name: holiday.name,
    }));
    return summary;
  }

  /** Day rows for one person between two IST dates (inclusive), oldest first. */
  async rowsBetween(staffId: string, from: Date, to: Date): Promise<DayRow[]> {
    const policy = await this.pricing.current();
    const days = await this.prisma.attendanceDay.findMany({
      where: { staffId, date: { gte: from, lte: to } },
      include: { segments: true },
      orderBy: { date: 'asc' },
    });
    return days.map((day) => this.dayRow(day, policy));
  }

  /**
   * Marks `absent` for everyone who marks attendance and has no day on that
   * date: no login and no approved leave. Weekly days off and holidays are skipped, and so
   * are dates before the account was created or before the joining date the CEO
   * entered. Dates before the go-live date in Settings are never marked: those days
   * are handled outside the app (owner decision 12 Nov). Runs nightly for yesterday.
   */
  async markAbsentDays(
    date?: Date,
    staffIds?: string[],
  ): Promise<{ date: string; marked: number }> {
    const target = date ?? this.yesterday();
    const label = this.label(target);
    if (await this.workingDays.isNonWorking(target)) {
      return { date: label, marked: 0 };
    }
    const goLive = (await this.pricing.current()).goLiveDate;
    if (goLive && target.getTime() < goLive.getTime()) {
      return { date: label, marked: 0 };
    }
    const endOfDate = new Date(target.getTime() + 24 * 3600 * 1000 - 5.5 * 3600 * 1000);
    const people = await this.prisma.staff.findMany({
      where: {
        role: { in: ATTENDANCE_ROLES },
        status: 'active',
        createdAt: { lt: endOfDate },
        OR: [{ joinedOn: null }, { joinedOn: { lte: target } }],
        ...(staffIds ? { id: { in: staffIds } } : {}),
      },
      select: { id: true },
    });
    let marked = 0;
    for (const person of people) {
      const existing = await this.prisma.attendanceDay.findUnique({
        where: { staffId_date: { staffId: person.id, date: target } },
        select: { id: true },
      });
      if (existing) continue;
      await this.prisma.attendanceDay.create({
        data: {
          staffId: person.id,
          date: target,
          dayType: 'absent',
          closedReason: 'no_login',
        },
      });
      marked += 1;
    }
    return { date: label, marked };
  }

  private yesterday(): Date {
    const today = this.attendance.istDate(this.clock.now());
    return new Date(today.getTime() - 24 * 3600 * 1000);
  }

  private dayRow(
    day: {
      id: string;
      date: Date;
      dayType: string;
      loginAt: Date | null;
      logoutAt: Date | null;
      lateMinutes: number;
      productionSeconds: number;
      breakSeconds: number;
      idleSeconds: number;
      shortfallSeconds: number;
      makeUpSeconds: number;
      flagged: boolean;
      closedReason: string | null;
      leaveKind: string | null;
      leaveUnpaid: boolean;
      leaveHalf: string | null;
      leavePartUnpaid: boolean;
      dayTypeChangedById: string | null;
      dayTypeChangedAt: Date | null;
      dayTypeChangeReason: string | null;
      segments: AttendanceSegment[];
    },
    policy: PricingPolicy,
  ): DayRow {
    return {
      id: day.id,
      date: this.label(day.date),
      dayType: day.dayType,
      loginAt: day.loginAt?.toISOString() ?? null,
      logoutAt: day.logoutAt?.toISOString() ?? null,
      lateMinutes: day.lateMinutes,
      productionSeconds: day.productionSeconds,
      breakSeconds: day.breakSeconds,
      breakOverSeconds: this.breakOverSeconds(day.segments, policy, day.logoutAt),
      breakCount: day.segments.filter((segment) => segment.status === 'short_break').length,
      idleSeconds: day.idleSeconds,
      shortfallSeconds: day.dayType === 'open' ? 0 : day.shortfallSeconds,
      makeUpSeconds: day.dayType === 'open' ? 0 : day.makeUpSeconds,
      flagged: day.flagged,
      closedReason: day.closedReason,
      leaveKind: day.leaveKind,
      leaveUnpaid: day.leaveUnpaid,
      leaveHalf: day.leaveKind ? day.leaveHalf : null,
      leavePartUnpaid: day.leavePartUnpaid,
      change: day.dayTypeChangedAt
        ? {
            byStaffId: day.dayTypeChangedById,
            at: day.dayTypeChangedAt.toISOString(),
            reason: day.dayTypeChangeReason,
          }
        : null,
    };
  }

  /** Break time past the allowance, break by break (15 min short, 30 min lunch). */
  breakOverSeconds(
    segments: AttendanceSegment[],
    policy: PricingPolicy,
    dayEnd: Date | null,
  ): number {
    const now = dayEnd ?? this.clock.now();
    let over = 0;
    for (const segment of segments) {
      if (segment.status !== 'short_break' && segment.status !== 'lunch') continue;
      const end = segment.endedAt ?? now;
      const seconds = Math.max(0, Math.floor((end.getTime() - segment.startedAt.getTime()) / 1000));
      const allowance =
        (segment.status === 'lunch' ? policy.lunchMinutes : policy.shortBreakMinutes) * 60;
      over += Math.max(0, seconds - allowance);
    }
    return over;
  }

  private label(date: Date): string {
    return date.toISOString().slice(0, 10);
  }
}
