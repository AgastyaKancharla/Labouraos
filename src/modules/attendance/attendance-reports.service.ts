import { maskCsvPhoneColumns } from '../../common/csv/csv-phone-mask';
import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.service';
import { AuditService } from '../../common/audit/audit.service';
import { PricingService } from '../pricing/pricing.service';
import { ReportingScopeService } from '../staff/reporting-scope.service';
import { AttendanceClock } from './attendance-clock';
import { AttendanceService } from './attendance.service';
import { ATTENDANCE_ROLES, AttendanceDaysService, DayRow } from './attendance-days.service';
import { BREAK_STATUSES } from './attendance.constants';
import { monthRange } from './day-rules';

interface Actor {
  id: string;
  role: string;
}

/** Guide, Attendance: two 15-minute breaks a day, plus a 30-minute lunch. */
export const SHORT_BREAKS_PER_DAY = 2;

export interface Person {
  id: string;
  code: string;
  name: string;
  role: string;
}

export interface LiveRow {
  staff: Person;
  status: string;
  since: string | null;
  loginAt: string | null;
  lateMinutes: number;
  productionSeconds: number;
  breakSeconds: number;
  breakOverSeconds: number;
  overBreak: boolean;
  idle: boolean;
  idleSeconds: number;
}

export interface MonthSheetRow {
  staffCode: string;
  name: string;
  role: string;
  /** Days in the month minus weekly days off and holidays. */
  workingDays: number;
  /** Public holidays in the month that fall on a working weekday (paid days off). */
  holidays: number;
  fullDays: number;
  halfDays: number;
  paidLeaveDays: number;
  absentDays: number;
  unpaidLeaveDays: number;
  paidDays: number;
  unpaidDays: number;
  deductibleShortfallMinutes: number;
}

const MAX_RANGE_DAYS = 92;
const DAY_MS = 24 * 3600 * 1000;

/**
 * Attendance reports (Phase 21 Task 5): the live board, a report for one
 * person, the team summary and the month sheet for salaries. Who sees whom
 * follows the reporting line: a Team Lead their team, a Manager their tree,
 * the CEO everyone. Days, hours and minutes only; no money anywhere.
 */
@Injectable()
export class AttendanceReportsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly pricing: PricingService,
    private readonly scope: ReportingScopeService,
    private readonly audit: AuditService,
    private readonly attendance: AttendanceService,
    private readonly days: AttendanceDaysService,
    private readonly clock: AttendanceClock,
  ) {}

  /** Everyone the caller may see, among people who mark attendance. */
  async peopleInScope(actor: Actor, financeSeesAll: boolean): Promise<Person[]> {
    const select = { id: true, code: true, name: true, role: true };
    const base = { role: { in: ATTENDANCE_ROLES }, status: 'active' };
    if (actor.role === 'ceo' || (financeSeesAll && actor.role === 'finance')) {
      return this.prisma.staff.findMany({ where: base, select, orderBy: { code: 'asc' } });
    }
    if (actor.role === 'team_lead' || actor.role === 'manager') {
      const ids = await this.scope.peopleUnder(actor.id);
      return this.prisma.staff.findMany({
        where: { ...base, id: { in: ids } },
        select,
        orderBy: { code: 'asc' },
      });
    }
    return [];
  }

  /**
   * Live board: current status, since when, today's production, breaks used,
   * over a break (red) and idle. Team Lead: their team. Manager: their tree.
   * CEO: everyone.
   */
  async liveBoard(actor: Actor) {
    const people = await this.peopleInScope(actor, false);
    const policy = await this.pricing.current();
    const now = this.clock.now();
    const date = this.attendance.istDate(now);
    const rows: LiveRow[] = [];
    for (const person of people) {
      const today = await this.attendance.today(person.id);
      const day = await this.prisma.attendanceDay.findUnique({
        where: { staffId_date: { staffId: person.id, date } },
        include: { segments: { orderBy: { startedAt: 'asc' } } },
      });
      const open = day?.segments.filter((segment) => !segment.endedAt).pop() ?? null;
      let status = today.status ?? 'not_logged_in';
      if (!today.status && day) {
        if (day.dayType === 'leave') status = 'on_leave';
        else if (day.loginAt && day.logoutAt) status = 'logged_out';
      }
      let overBreak = false;
      if (open && (BREAK_STATUSES as readonly string[]).includes(open.status)) {
        const allowance = (open.status === 'lunch' ? policy.lunchMinutes : policy.shortBreakMinutes) * 60;
        overBreak = (now.getTime() - open.startedAt.getTime()) / 1000 > allowance;
      }
      rows.push({
        staff: person,
        status,
        since: open?.startedAt.toISOString() ?? null,
        loginAt: today.loginAt,
        lateMinutes: today.lateMinutes,
        productionSeconds: today.productionSeconds,
        breakSeconds: today.breakSeconds,
        breakOverSeconds: day ? this.days.breakOverSeconds(day.segments, policy, day.logoutAt) : 0,
        overBreak,
        idle: status === 'idle',
        idleSeconds: today.idleSeconds,
      });
    }
    const counts: Record<string, number> = {};
    for (const row of rows) counts[row.status] = (counts[row.status] ?? 0) + 1;
    return {
      asOf: now.toISOString(),
      counts: {
        ...counts,
        overBreak: rows.filter((row) => row.overBreak).length,
        idle: rows.filter((row) => row.idle).length,
      },
      people: rows,
    };
  }

  /**
   * Report for one person over any date range: every late login with the
   * minutes, production by day, breaks over time, idle time and hours lost
   * (shortfall plus idle).
   */
  async personReport(actor: Actor, staffId: string, fromText?: string, toText?: string) {
    if (!(await this.days.canSee(actor, staffId))) {
      throw new ForbiddenException('You cannot see this attendance');
    }
    const staff = await this.prisma.staff.findUnique({
      where: { id: staffId },
      select: { id: true, code: true, name: true, role: true },
    });
    if (!staff) throw new NotFoundException('Staff account not found');
    const { from, to } = this.range(fromText, toText);
    const rows = await this.days.rowsBetween(staffId, from, to);
    const totals = this.totals(rows);
    return {
      staff,
      from: this.label(from),
      to: this.label(to),
      lateLogins: {
        count: totals.lateLogins,
        days: rows
          .filter((row) => row.lateMinutes > 0)
          .map((row) => ({ date: row.date, minutes: row.lateMinutes })),
      },
      days: rows.map((row) => ({
        /** The day's id, for "Change day" (POST /attendance/days/:dayId/day-type). */
        id: row.id,
        date: row.date,
        dayType: row.dayType,
        loginAt: row.loginAt,
        logoutAt: row.logoutAt,
        lateMinutes: row.lateMinutes,
        productionSeconds: row.productionSeconds,
        breakSeconds: row.breakSeconds,
        breakOverSeconds: row.breakOverSeconds,
        breakCount: row.breakCount,
        /** Short breaks past the two a day the shift allows (guide, Attendance). */
        extraBreaks: Math.max(0, row.breakCount - SHORT_BREAKS_PER_DAY),
        idleSeconds: row.idleSeconds,
        shortfallSeconds: row.shortfallSeconds,
        makeUpSeconds: row.makeUpSeconds,
        hoursLostSeconds: row.shortfallSeconds + row.idleSeconds,
        leaveKind: row.leaveKind,
        change: row.change,
      })),
      totals,
    };
  }

  /** Team summary: production, hours lost, late logins and absent days per person and in total. */
  async teamSummary(actor: Actor, fromText?: string, toText?: string) {
    const { from, to } = this.range(fromText, toText);
    const people = await this.peopleInScope(actor, true);
    const rows = [];
    for (const person of people) {
      const days = await this.days.rowsBetween(person.id, from, to);
      const totals = this.totals(days);
      rows.push({
        staff: person,
        productionSeconds: totals.productionSeconds,
        hoursLostSeconds: totals.hoursLostSeconds,
        lateLogins: totals.lateLogins,
        absentDays: totals.absentDays,
      });
    }
    return {
      from: this.label(from),
      to: this.label(to),
      people: rows,
      total: {
        people: rows.length,
        productionSeconds: rows.reduce((sum, row) => sum + row.productionSeconds, 0),
        hoursLostSeconds: rows.reduce((sum, row) => sum + row.hoursLostSeconds, 0),
        lateLogins: rows.reduce((sum, row) => sum + row.lateLogins, 0),
        absentDays: rows.reduce((sum, row) => sum + row.absentDays, 0),
      },
    };
  }

  /**
   * Month sheet for salaries, one row per person who marks attendance:
   * paid days = full + half × 0.5 + paid leave; unpaid days = absent +
   * unpaid leave + half × 0.5; deductible shortfall in whole minutes; and
   * the month's working days and holidays (holidays are paid days off and
   * not working days, like weekly days off).
   * Built from the month summaries, so the two always agree. Finance and
   * the CEO only (enforced on the route). No rupee amounts (Phase 22).
   */
  async monthSheet(actor: Actor, month: string): Promise<{ month: string; rows: MonthSheetRow[] }> {
    const range = monthRange(month);
    if (!range) throw new BadRequestException('month must look like 2026-11');
    const people = await this.prisma.staff.findMany({
      where: {
        role: { in: ATTENDANCE_ROLES },
        OR: [
          { status: 'active' },
          { attendanceDays: { some: { date: { gte: range.from, lte: range.to } } } },
        ],
      },
      select: { id: true },
      orderBy: { code: 'asc' },
    });
    const rows: MonthSheetRow[] = [];
    for (const person of people) {
      const summary = await this.days.summaryFor(person.id, month);
      rows.push({
        staffCode: summary.staff.code,
        name: summary.staff.name,
        role: summary.staff.role,
        workingDays: summary.workingDays,
        holidays: summary.holidays.length,
        fullDays: summary.fullDays,
        halfDays: summary.halfDays,
        paidLeaveDays: summary.paidLeaveDays.total,
        absentDays: summary.absentDays,
        unpaidLeaveDays: summary.unpaidLeaveDays,
        paidDays: summary.fullDays + summary.halfDays * 0.5 + summary.paidLeaveDays.total,
        unpaidDays: summary.absentDays + summary.unpaidLeaveDays + summary.halfDays * 0.5,
        deductibleShortfallMinutes: Math.floor(summary.deductibleShortfallSeconds / 60),
      });
    }
    await this.audit.log({
      actorId: actor.id,
      action: 'attendance.month_sheet_read',
      entityType: 'attendance_month_sheet',
      entityCode: month,
      after: { month, rows: rows.length },
    });
    return { month, rows };
  }

  monthSheetCsv(rows: MonthSheetRow[], viewerRole?: string | null): string {
    const header = [
      'Staff code',
      'Name',
      'Role',
      'Working days',
      'Holidays',
      'Full days',
      'Half days',
      'Paid leave days',
      'Absent days',
      'Unpaid leave days',
      'Paid days',
      'Unpaid days',
      'Deductible shortfall (minutes)',
    ];
    const lines = [header.map((cell) => this.csvCell(cell)).join(',')];
    const body = rows.map((row) => [
          row.staffCode,
          row.name,
          row.role,
          row.workingDays,
          row.holidays,
          row.fullDays,
          row.halfDays,
          row.paidLeaveDays,
          row.absentDays,
          row.unpaidLeaveDays,
          row.paidDays,
          row.unpaidDays,
          row.deductibleShortfallMinutes,
        ]);
    for (const cells of maskCsvPhoneColumns(header, body, viewerRole)) {
      lines.push(cells.map((cell) => this.csvCell(cell)).join(','));
    }
    return `${lines.join('\n')}\n`;
  }

  private csvCell(value: string | number): string {
    let text = String(value);
    // A cell that starts like a formula is opened as text by spreadsheets.
    if (typeof value === 'string' && /^[=+\-@\t\r]/.test(text)) text = `'${text}`;
    if (/[",\n\r]/.test(text)) return `"${text.replace(/"/g, '""')}"`;
    return text;
  }

  private totals(rows: DayRow[]) {
    let productionSeconds = 0;
    let breakOverSeconds = 0;
    let idleSeconds = 0;
    let shortfallSeconds = 0;
    let makeUpSeconds = 0;
    let lateLogins = 0;
    let absentDays = 0;
    for (const row of rows) {
      productionSeconds += row.productionSeconds;
      breakOverSeconds += row.breakOverSeconds;
      idleSeconds += row.idleSeconds;
      shortfallSeconds += row.shortfallSeconds;
      makeUpSeconds += row.makeUpSeconds;
      if (row.lateMinutes > 0) lateLogins += 1;
      if (row.dayType === 'absent') absentDays += 1;
    }
    return {
      productionSeconds,
      breakOverSeconds,
      idleSeconds,
      shortfallSeconds,
      makeUpSeconds,
      hoursLostSeconds: shortfallSeconds + idleSeconds,
      lateLogins,
      absentDays,
    };
  }

  private range(fromText?: string, toText?: string): { from: Date; to: Date } {
    const from = this.parseDate(fromText, 'from');
    const to = this.parseDate(toText, 'to');
    if (to.getTime() < from.getTime()) throw new BadRequestException('"to" is before "from"');
    if ((to.getTime() - from.getTime()) / DAY_MS >= MAX_RANGE_DAYS) {
      throw new BadRequestException(`A report covers at most ${MAX_RANGE_DAYS} days`);
    }
    return { from, to };
  }

  private parseDate(value: string | undefined, field: string): Date {
    const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(value ?? ''));
    if (!match) throw new BadRequestException(`"${field}" must look like 2026-11-20`);
    const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
    if (this.label(date) !== match[0]) throw new BadRequestException(`"${field}" is not a real date`);
    return date;
  }

  private label(date: Date): string {
    return date.toISOString().slice(0, 10);
  }
}
