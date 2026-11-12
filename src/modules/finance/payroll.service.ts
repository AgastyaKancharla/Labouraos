import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { PayrollLine, PayrollRun, PricingPolicy, Prisma } from '@prisma/client';
import { PrismaService } from '../../common/prisma/prisma.service';
import { AuditService } from '../../common/audit/audit.service';
import { PricingService } from '../pricing/pricing.service';
import { AttendanceDaysService, ATTENDANCE_ROLES } from '../attendance/attendance-days.service';
import { WorkingDaysService } from '../attendance/working-days.service';
import { deductibleShortfall, isWeeklyOff } from '../attendance/day-rules';
import { NotificationService } from '../notification/notification.service';
import { NotificationSourcesService } from '../notification/notification-sources.service';
import { notificationLink } from '../notification/notification.constants';
import { sumPaise } from '../ceo-portal/ceo-common';
import { MonthLockService } from '../month-lock/month-lock.service';
import { assertUtrUnused, isUniqueViolation, utrUsed } from '../../common/money/utr-registry';
import { PAID_FROM, istDay, parsePaise } from './finance-rules';
import { CsvValue, rupees, toCsv } from './finance-csv';
import {
  AwayPeriod,
  STATUTORY_DEDUCTIONS,
  STATUTORY_NOTE,
  calendarDaysIn,
  canPrepareOn,
  computePay,
  isMonthKey,
  lossOfPayHalfDays,
  monthBounds,
  monthDays,
  monthLabel,
  nextMonth,
  previousMonth,
  rupeesInWords,
  salaryDaysFor,
  staffWorkingDays,
} from './payroll-rules';

export type PayrollStatus = 'draft' | 'with_ceo' | 'returned' | 'approved' | 'paid';

/** One person's line on the salary sheet, live (draft) or frozen (prepared). */
export interface SheetRow {
  staffId: string;
  staffCode: string;
  name: string;
  role: string;
  joinedOn: string | null;
  monthlyPaise: number | null;
  salaryDays: number;
  calendarDays: number;
  workingDays: number;
  holidays: number;
  fullDays: number;
  halfDays: number;
  paidLeaveDays: number;
  unpaidLeaveDays: number;
  absentDays: number;
  /** Working days not on the staff (before joining, away, after leaving). */
  notEmployedDays: number;
  /** Working days on the staff with no attendance at all (not paid). */
  unmarkedDays: number;
  /** Days paid out of the 26 (halves allowed: 23.5). */
  paidDays: number;
  /** Loss of pay days from attendance (absent, unpaid leave, half days, unmarked). */
  lossOfPayDays: number;
  shortfallMinutes: number;
  basicPaise: number;
  hraPaise: number;
  specialPaise: number;
  grossPaise: number;
  notEmployedPaise: number;
  lossOfPayPaise: number;
  shortfallPaise: number;
  pfPaise: number;
  esiPaise: number;
  professionalTaxPaise: number;
  deductionsPaise: number;
  correctionPaise: number;
  correctionNote: string | null;
  /** A take-back larger than this month's pay (≤ 0): carried to the next sheet once approved. */
  carryForwardPaise: number;
  /** True for a line that only pays corrections to someone no longer on the staff. */
  correctionOnly: boolean;
  netPaise: number;
  line: { id: string; status: string; paidAt: string | null; utrLast4: string | null; paidFrom: string | null } | null;
}

const SALARY_ROLES = ATTENDANCE_ROLES;
const ROLE_LABEL: Record<string, string> = {
  call_agent: 'Call agent',
  field_agent: 'Field agent',
  team_lead: 'Team Lead',
  manager: 'Manager',
  finance: 'Finance',
  ceo: 'CEO',
};

interface Actor {
  id: string;
  role: string;
}

interface Person {
  id: string;
  code: string;
  name: string;
  role: string;
  status: string;
  createdAt: Date;
  deactivatedAt: Date | null;
  joinedOn: Date | null;
}

/** The attendance fields pay is worked out from (one row per IST day). */
interface DayLite {
  date: string;
  dayType: string;
  leaveUnpaid: boolean;
  shortfallSeconds: number;
  makeUpSeconds: number;
}

/** A correction waiting for a sheet: stored (id) or just found by working a frozen month out again (id null). */
interface OpenCorrection {
  id: string | null;
  staffId: string;
  relatesToMonth: string;
  amountPaise: number;
  reason: string;
  source: 'recompute' | 'carry_forward';
}

/** How far back frozen months are worked out again to find corrections. */
const CORRECTION_LOOKBACK_MONTHS = 12;

/** ₹1,000 or ₹1,000.50 for notes. */
const inr = (paise: number) => `₹${Math.floor(paise / 100).toLocaleString('en-IN')}${paise % 100 ? `.${String(paise % 100).padStart(2, '0')}` : ''}`;

const PERSON_SELECT = { id: true, code: true, name: true, role: true, status: true, createdAt: true, deactivatedAt: true, joinedOn: true } as const;

/** Everything about one person's month that pay is worked out from. */
interface PersonMonth {
  joinedDay: string;
  employed: string[];
  notEmployed: number;
  unmarked: string[];
  open: string[];
  absent: number;
  unpaidLeave: number;
  half: number;
  full: number;
  paidLeave: number;
  shortfallMinutes: number;
}

/**
 * Payroll from attendance (Phase 22 Part B, specs/phase-22.md). CEO and
 * Finance only — Managers never see anyone else's salary. Only the CEO sets
 * salaries. Finance prepares the month's sheet once the month is over and its
 * attendance is final; the CEO approves exactly the total he saw (or sends it
 * back); Finance pays each person and records the UTR; each person then
 * downloads their own payslip. Every write is audit-logged.
 */
@Injectable()
export class PayrollService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly pricing: PricingService,
    private readonly days: AttendanceDaysService,
    private readonly workingDays: WorkingDaysService,
    private readonly locks: MonthLockService,
    private readonly notifications: NotificationService,
    private readonly sources: NotificationSourcesService,
  ) {}

  private month(value: unknown): string {
    if (!isMonthKey(value)) throw new BadRequestException('month must look like 2026-10');
    return value;
  }

  // ---------------------------------------------------------------- salaries

  /** The salary in force for each person in a month: the latest row on or before it. */
  private async salariesFor(staffIds: string[], month: string): Promise<Map<string, number>> {
    if (!staffIds.length) return new Map();
    const rows = await this.prisma.staffSalary.findMany({
      where: { staffId: { in: staffIds }, effectiveFromMonth: { lte: month } },
      orderBy: [{ effectiveFromMonth: 'asc' }, { createdAt: 'asc' }],
    });
    const out = new Map<string, number>();
    for (const row of rows) out.set(row.staffId, row.monthlyPaise);
    return out;
  }

  /** Everyone who is paid a salary, with their current salary and its history (CEO and Finance read it). */
  async staffSalaries(now = new Date()) {
    const month = istDay(now).slice(0, 7);
    const people = await this.prisma.staff.findMany({
      where: { role: { in: SALARY_ROLES }, status: { in: ['active', 'pending_invite'] } },
      select: { id: true, code: true, name: true, role: true, createdAt: true, joinedOn: true },
      orderBy: { code: 'asc' },
    });
    const history = await this.prisma.staffSalary.findMany({
      where: { staffId: { in: people.map((p) => p.id) } },
      orderBy: [{ effectiveFromMonth: 'desc' }, { createdAt: 'desc' }],
    });
    const setters = await this.names(history.map((h) => h.setByStaffId));
    return {
      month,
      rows: people.map((p) => {
        const mine = history.filter((h) => h.staffId === p.id);
        const current = mine.find((h) => h.effectiveFromMonth <= month) ?? null;
        const upcoming = mine.find((h) => h.effectiveFromMonth > month) ?? null;
        return {
          staffId: p.id,
          staffCode: p.code,
          name: p.name,
          role: p.role,
          joinedAt: p.createdAt.toISOString(),
          joinedOn: p.joinedOn ? p.joinedOn.toISOString().slice(0, 10) : null,
          monthlyPaise: current?.monthlyPaise ?? null,
          effectiveFromMonth: current?.effectiveFromMonth ?? null,
          upcoming: upcoming ? { monthlyPaise: upcoming.monthlyPaise, effectiveFromMonth: upcoming.effectiveFromMonth } : null,
          history: mine.map((h) => ({ monthlyPaise: h.monthlyPaise, effectiveFromMonth: h.effectiveFromMonth, note: h.note, setBy: setters.get(h.setByStaffId) ?? null, setAt: h.createdAt.toISOString() })),
        };
      }),
    };
  }

  /** Only the CEO sets or changes a salary (owner decision 11 Nov), from a month onwards. */
  async setSalary(staffId: string, input: { monthlyPaise?: unknown; effectiveFromMonth?: unknown; note?: unknown }, actor: Actor) {
    if (actor.role !== 'ceo') throw new ForbiddenException('Only the CEO sets or changes salaries');
    const effectiveFromMonth = this.month(input.effectiveFromMonth);
    let monthlyPaise: number;
    try {
      monthlyPaise = parsePaise(input.monthlyPaise, 'monthlyPaise');
    } catch (e) {
      throw new BadRequestException((e as Error).message);
    }
    if (monthlyPaise % 100 !== 0) throw new BadRequestException('A monthly salary is a whole number of rupees');
    const note = typeof input.note === 'string' && input.note.trim() ? input.note.trim().slice(0, 200) : null;
    const staff = await this.prisma.staff.findUnique({ where: { id: staffId }, select: { id: true, code: true, role: true } });
    if (!staff || !SALARY_ROLES.includes(staff.role)) throw new NotFoundException('No staff member on the salary sheet with that id');
    await this.locks.assertOpen(effectiveFromMonth, 'salaries from that month');
    const frozen = await this.prisma.payrollRun.findFirst({
      where: { month: { gte: effectiveFromMonth }, status: { in: ['approved', 'paid'] }, lines: { some: { staffId } } },
      select: { month: true },
    });
    if (frozen) {
      throw new BadRequestException(`${monthLabel(frozen.month)} pay is already approved by the CEO. Set the new salary from ${monthLabel(nextMonth(frozen.month))}.`);
    }
    const before = (await this.salariesFor([staffId], effectiveFromMonth)).get(staffId) ?? null;
    const row = await this.prisma.staffSalary.create({ data: { staffId, monthlyPaise, effectiveFromMonth, note, setByStaffId: actor.id } });
    await this.audit.log({
      actorId: actor.id,
      action: 'staff_salary.set',
      entityType: 'StaffSalary',
      entityCode: staff.code,
      before: { monthlyPaise: before },
      after: { monthlyPaise, effectiveFromMonth },
      changedFields: ['monthlyPaise', 'effectiveFromMonth'],
      reason: note ?? undefined,
    });
    return row;
  }

  // ------------------------------------------------------------- the sheet

  /** Joining day: the date the CEO entered, else the first login. Null = never started. */
  private async joinedDays(people: Person[]): Promise<Map<string, string>> {
    const ids = people.filter((p) => !p.joinedOn).map((p) => p.id);
    const [firstDays, firstSessions] = ids.length
      ? await Promise.all([
          this.prisma.attendanceDay.groupBy({ by: ['staffId'], where: { staffId: { in: ids }, loginAt: { not: null } }, _min: { loginAt: true } }),
          this.prisma.staffSession.groupBy({ by: ['staffId'], where: { staffId: { in: ids } }, _min: { createdAt: true } }),
        ])
      : [[], []];
    const out = new Map<string, string>();
    for (const p of people) {
      if (p.joinedOn) {
        out.set(p.id, p.joinedOn.toISOString().slice(0, 10));
        continue;
      }
      const candidates = [firstDays.find((g) => g.staffId === p.id)?._min.loginAt, firstSessions.find((g) => g.staffId === p.id)?._min.createdAt].filter((d): d is Date => Boolean(d));
      if (candidates.length) out.set(p.id, istDay(new Date(Math.min(...candidates.map((d) => d.getTime())))));
    }
    return out;
  }

  /** Periods away (deactivated), as IST days. A deactivated account with no recorded period is away from its leaving day. */
  private async awayPeriods(people: Person[]): Promise<Map<string, AwayPeriod[]>> {
    const rows = people.length ? await this.prisma.staffAwayPeriod.findMany({ where: { staffId: { in: people.map((p) => p.id) } } }) : [];
    const out = new Map<string, AwayPeriod[]>();
    for (const p of people) {
      const mine = rows.filter((r) => r.staffId === p.id).map((r) => ({ leftDay: istDay(r.leftAt), returnedDay: r.returnedAt ? istDay(r.returnedAt) : null }));
      if (p.status === 'deactivated' && p.deactivatedAt && !mine.some((m) => m.returnedDay === null)) mine.push({ leftDay: istDay(p.deactivatedAt), returnedDay: null });
      out.set(p.id, mine);
    }
    return out;
  }

  /** Everyone who could be on a month's sheet (attendance roles, invite accepted). */
  private async candidates(month: string): Promise<Person[]> {
    const { to } = monthBounds(month);
    return this.prisma.staff.findMany({
      where: { role: { in: SALARY_ROLES }, status: { not: 'pending_invite' }, OR: [{ joinedOn: { lte: new Date(`${monthDays(month).last}T00:00:00.000Z`) } }, { joinedOn: null, createdAt: { lte: to } }] },
      select: PERSON_SELECT,
      orderBy: { code: 'asc' },
    });
  }

  /**
   * The month's working days. Today's Settings by default; a frozen month is
   * worked out again with the weekly offs in force when it was prepared, so
   * a later Settings change never looks like a correction. Holidays are
   * today's list (a holiday added or removed later is a real correction).
   */
  private async workingDayKeys(month: string, weeklyOffDays?: number[]): Promise<{ working: string[]; holidays: number }> {
    if (!weeklyOffDays) {
      const calendar = await this.workingDays.calendar(new Date(`${monthDays(month).first}T00:00:00.000Z`), new Date(`${monthDays(month).last}T00:00:00.000Z`));
      return { working: calendar.workingDates.map((d) => d.toISOString().slice(0, 10)), holidays: calendar.holidays.length };
    }
    const from = new Date(`${monthDays(month).first}T00:00:00.000Z`);
    const to = new Date(`${monthDays(month).last}T00:00:00.000Z`);
    const holidays = new Set((await this.prisma.holiday.findMany({ where: { date: { gte: from, lte: to } }, select: { date: true } })).map((h) => h.date.getTime()));
    const working: string[] = [];
    let holidayCount = 0;
    for (let at = from.getTime(); at <= to.getTime(); at += 24 * 3600_000) {
      const date = new Date(at);
      if (isWeeklyOff(date, weeklyOffDays)) continue;
      if (holidays.has(at)) holidayCount += 1;
      else working.push(date.toISOString().slice(0, 10));
    }
    return { working, holidays: holidayCount };
  }

  /** The Settings a sheet was worked out with: the version in force when it was prepared. */
  private async policyAt(at: Date): Promise<PricingPolicy> {
    return (await this.prisma.pricingPolicy.findFirst({ where: { effectiveFrom: { lte: at } }, orderBy: [{ effectiveFrom: 'desc' }, { createdAt: 'desc' }] })) ?? this.pricing.current();
  }

  /** Attendance of several people for a month, in one query. */
  private async attendanceFor(staffIds: string[], month: string): Promise<Map<string, DayLite[]>> {
    const out = new Map<string, DayLite[]>(staffIds.map((id) => [id, []]));
    if (!staffIds.length) return out;
    const rows = await this.prisma.attendanceDay.findMany({
      where: { staffId: { in: staffIds }, date: { gte: new Date(`${monthDays(month).first}T00:00:00.000Z`), lte: new Date(`${monthDays(month).last}T00:00:00.000Z`) } },
      select: { staffId: true, date: true, dayType: true, leaveUnpaid: true, shortfallSeconds: true, makeUpSeconds: true },
    });
    for (const r of rows) out.get(r.staffId)?.push({ date: r.date.toISOString().slice(0, 10), dayType: r.dayType, leaveUnpaid: r.leaveUnpaid, shortfallSeconds: r.shortfallSeconds, makeUpSeconds: r.makeUpSeconds });
    return out;
  }

  /**
   * One person's month from attendance: working days on the staff, and on
   * those days absent, unpaid leave, half days and days with no attendance at
   * all (not paid). Days on weekly offs and holidays never cost pay. `upTo`
   * leaves out days not yet over (a live draft of the running month).
   */
  private personMonth(days: DayLite[], joinedDay: string, away: AwayPeriod[], working: string[], upTo: string): PersonMonth {
    const byDay = new Map(days.map((d) => [d.date, d]));
    const closed = days.filter((d) => d.dayType !== 'open');
    const shortfallSeconds = deductibleShortfall(sumPaise(closed.map((d) => d.shortfallSeconds)), sumPaise(closed.map((d) => d.makeUpSeconds)));
    const { employed, notEmployed } = staffWorkingDays(working, joinedDay, away);
    const m: PersonMonth = { joinedDay, employed, notEmployed, unmarked: [], open: [], absent: 0, unpaidLeave: 0, half: 0, full: 0, paidLeave: 0, shortfallMinutes: Math.floor(shortfallSeconds / 60) };
    for (const day of employed) {
      if (day > upTo) continue;
      const row = byDay.get(day);
      if (!row) m.unmarked.push(day);
      else if (row.dayType === 'open') m.open.push(day);
      else if (row.dayType === 'absent') m.absent += 1;
      else if (row.dayType === 'half') m.half += 1;
      else if (row.dayType === 'full') m.full += 1;
      else if (row.dayType === 'leave') {
        if (row.leaveUnpaid) m.unpaidLeave += 1;
        else m.paidLeave += 1;
      }
    }
    return m;
  }

  private rowFor(person: Person, month: string, monthly: number | null, pm: PersonMonth, salaryDays: number, fullDayMinutes: number, working: string[], holidays: number, correction: { paise: number; note: string | null }): SheetRow {
    const lopHalf = lossOfPayHalfDays({ absentDays: pm.absent, unpaidLeaveDays: pm.unpaidLeave, halfDays: pm.half, unmarkedDays: pm.unmarked.length });
    const pay = computePay({
      monthlyPaise: monthly ?? 0,
      salaryDays,
      employedWorkingDays: pm.employed.length,
      notEmployedWorkingDays: pm.notEmployed,
      lossOfPayHalfDays: lopHalf,
      shortfallMinutes: pm.shortfallMinutes,
      fullDayMinutes,
      correctionPaise: correction.paise,
    });
    return {
      staffId: person.id,
      staffCode: person.code,
      name: person.name,
      role: person.role,
      joinedOn: pm.joinedDay,
      monthlyPaise: monthly,
      salaryDays,
      calendarDays: calendarDaysIn(month),
      workingDays: working.length,
      holidays,
      fullDays: pm.full,
      halfDays: pm.half,
      paidLeaveDays: pm.paidLeave,
      unpaidLeaveDays: pm.unpaidLeave,
      absentDays: pm.absent,
      notEmployedDays: pm.notEmployed,
      unmarkedDays: pm.unmarked.length,
      paidDays: pay.paidHalfDays / 2,
      lossOfPayDays: pay.lossOfPayHalfDays / 2,
      shortfallMinutes: pm.shortfallMinutes,
      basicPaise: pay.basicPaise,
      hraPaise: pay.hraPaise,
      specialPaise: pay.specialPaise,
      grossPaise: pay.grossPaise,
      notEmployedPaise: pay.notEmployedPaise,
      lossOfPayPaise: pay.lossOfPayPaise,
      shortfallPaise: pay.shortfallPaise,
      pfPaise: pay.pfPaise,
      esiPaise: pay.esiPaise,
      professionalTaxPaise: pay.professionalTaxPaise,
      deductionsPaise: pay.deductionsPaise,
      correctionPaise: pay.correctionPaise,
      correctionNote: correction.note,
      carryForwardPaise: pay.carryForwardPaise,
      correctionOnly: false,
      netPaise: pay.netPaise,
      line: null,
    };
  }

  /**
   * Corrections waiting for a sheet of `month` (owner decisions 11 Nov,
   * re-check 12 Nov): every stored correction not yet applied, whatever month
   * it relates to — also those on a sheet the CEO sent back, or on this
   * month's own sheet while it is worked out again.
   */
  private async storedCorrections(month: string, ownRunId: string | null): Promise<OpenCorrection[]> {
    const returned = (await this.prisma.payrollRun.findMany({ where: { status: 'returned' }, select: { id: true } })).map((r) => r.id);
    const runIds = [...new Set([...returned, ...(ownRunId ? [ownRunId] : [])])];
    const rows = await this.prisma.payrollCorrection.findMany({
      where: { relatesToMonth: { lt: month }, OR: [{ appliedRunId: null }, ...(runIds.length ? [{ appliedRunId: { in: runIds } }] : [])] },
      orderBy: [{ relatesToMonth: 'asc' }, { createdAt: 'asc' }],
    });
    return rows.map((r) => ({ id: r.id, staffId: r.staffId, relatesToMonth: r.relatesToMonth, amountPaise: r.amountPaise, reason: r.reason, source: r.source === 'carry_forward' ? 'carry_forward' : 'recompute' }));
  }

  /**
   * Works out again every approved month of the last year from today's
   * holidays and attendance, with that sheet's own frozen salary days and the
   * Settings in force when it was prepared (so a Settings change never looks
   * like a correction), and returns what is owed either way that is not
   * already recorded. The approved sheet itself never changes.
   */
  private async foundCorrections(month: string): Promise<OpenCorrection[]> {
    let earliest = month;
    for (let i = 0; i < CORRECTION_LOOKBACK_MONTHS; i += 1) earliest = previousMonth(earliest);
    const runs = await this.prisma.payrollRun.findMany({ where: { month: { lt: month, gte: earliest }, status: { in: ['approved', 'paid'] } }, include: { lines: true }, orderBy: { month: 'asc' } });
    const lines = runs.flatMap((r) => r.lines.filter((l) => l.monthlyPaise > 0));
    if (!lines.length) return [];
    const staffIds = [...new Set(lines.map((l) => l.staffId))];
    const people = await this.prisma.staff.findMany({ where: { id: { in: staffIds } }, select: PERSON_SELECT });
    const [joined, away] = await Promise.all([this.joinedDays(people), this.awayPeriods(people)]);
    const recorded = await this.prisma.payrollCorrection.groupBy({
      by: ['staffId', 'relatesToMonth'],
      where: { source: 'recompute', staffId: { in: staffIds }, relatesToMonth: { in: runs.map((r) => r.month) } },
      _sum: { amountPaise: true },
    });
    const already = (staffId: string, m: string) => recorded.find((g) => g.staffId === staffId && g.relatesToMonth === m)?._sum.amountPaise ?? 0;
    const out: OpenCorrection[] = [];
    for (const run of runs) {
      const policy = await this.policyAt(run.preparedAt);
      const fullDayMinutes = Math.max(1, Math.round(policy.productionHoursFullDay * 60));
      const { working } = await this.workingDayKeys(run.month, policy.weeklyOffDays);
      const mine = run.lines.filter((l) => l.monthlyPaise > 0);
      const attendance = await this.attendanceFor(mine.map((l) => l.staffId), run.month);
      for (const line of mine) {
        const joinedDay = joined.get(line.staffId);
        if (!joinedDay) continue;
        const pm = this.personMonth(attendance.get(line.staffId) ?? [], joinedDay, away.get(line.staffId) ?? [], working, monthDays(run.month).last);
        const again = computePay({
          monthlyPaise: line.monthlyPaise,
          salaryDays: line.salaryDays,
          employedWorkingDays: pm.employed.length,
          notEmployedWorkingDays: pm.notEmployed,
          lossOfPayHalfDays: lossOfPayHalfDays({ absentDays: pm.absent, unpaidLeaveDays: pm.unpaidLeave, halfDays: pm.half, unmarkedDays: pm.unmarked.length }),
          shortfallMinutes: pm.shortfallMinutes,
          fullDayMinutes,
        });
        const frozen = line.notEmployedPaise + line.lossOfPayPaise + line.shortfallPaise;
        const now = again.notEmployedPaise + again.lossOfPayPaise + again.shortfallPaise;
        const amountPaise = frozen - now - already(line.staffId, run.month);
        if (amountPaise === 0) continue;
        out.push({
          id: null,
          staffId: line.staffId,
          relatesToMonth: run.month,
          amountPaise,
          source: 'recompute',
          reason: `${monthLabel(run.month)}: a holiday or attendance changed after that month's pay was approved`,
        });
      }
    }
    return out;
  }

  private correctionNote(list: OpenCorrection[]): string | null {
    if (!list.length) return null;
    return list
      .map((c) => `${c.amountPaise > 0 ? 'Paid back' : 'Taken back'} ${inr(Math.abs(c.amountPaise))} for ${monthLabel(c.relatesToMonth)}${c.source === 'carry_forward' ? ' (carried forward: larger than that month\'s pay)' : ' (a holiday or attendance changed after it was approved)'}`)
      .join('; ')
      .slice(0, 1000);
  }

  /** A line that only pays what is owed to someone no longer on the staff, so it goes through Finance like any salary. */
  private correctionOnlyRow(person: Person, month: string, working: string[], holidays: number, salaryDays: number, paise: number, note: string | null): SheetRow {
    return {
      staffId: person.id,
      staffCode: person.code,
      name: person.name,
      role: person.role,
      joinedOn: person.joinedOn ? person.joinedOn.toISOString().slice(0, 10) : null,
      monthlyPaise: 0,
      salaryDays,
      calendarDays: calendarDaysIn(month),
      workingDays: working.length,
      holidays,
      fullDays: 0,
      halfDays: 0,
      paidLeaveDays: 0,
      unpaidLeaveDays: 0,
      absentDays: 0,
      notEmployedDays: working.length,
      unmarkedDays: 0,
      paidDays: 0,
      lossOfPayDays: 0,
      shortfallMinutes: 0,
      basicPaise: 0,
      hraPaise: 0,
      specialPaise: 0,
      grossPaise: 0,
      notEmployedPaise: 0,
      lossOfPayPaise: 0,
      shortfallPaise: 0,
      pfPaise: 0,
      esiPaise: 0,
      professionalTaxPaise: 0,
      deductionsPaise: 0,
      correctionPaise: paise,
      correctionNote: note ? `No longer on the staff. ${note}` : 'No longer on the staff',
      carryForwardPaise: 0,
      correctionOnly: true,
      netPaise: paise,
      line: null,
    };
  }

  /** Works out the month's sheet from attendance, the salaries in force and the corrections waiting. */
  async draft(month: string, now = new Date(), ownRunId: string | null = null): Promise<{ rows: SheetRow[]; missingSalary: { staffId: string; staffCode: string; name: string }[]; openDays: { name: string; days: string[] }[]; salaryDays: number; corrections: OpenCorrection[] }> {
    const policy = await this.pricing.current();
    const salaryDays = salaryDaysFor(policy.payrollSalaryDays);
    const fullDayMinutes = Math.max(1, Math.round(policy.productionHoursFullDay * 60));
    const { working, holidays } = await this.workingDayKeys(month);
    const yesterday = istDay(new Date(now.getTime() - 24 * 3600_000));
    const upTo = monthDays(month).last < yesterday ? monthDays(month).last : yesterday;
    const people = await this.candidates(month);
    const [joined, away] = await Promise.all([this.joinedDays(people), this.awayPeriods(people)]);
    const salaries = await this.salariesFor(people.map((p) => p.id), month);
    const attendance = await this.attendanceFor(people.map((p) => p.id), month);
    const corrections = [...(await this.storedCorrections(month, ownRunId)), ...(await this.foundCorrections(month))];
    const correctionsOf = (staffId: string) => corrections.filter((c) => c.staffId === staffId);
    const rows: SheetRow[] = [];
    const missingSalary: { staffId: string; staffCode: string; name: string }[] = [];
    const openDays: { name: string; days: string[] }[] = [];
    for (const person of people) {
      const joinedDay = joined.get(person.id);
      if (!joinedDay) continue;
      const pm = this.personMonth(attendance.get(person.id) ?? [], joinedDay, away.get(person.id) ?? [], working, upTo);
      if (pm.employed.length === 0) continue;
      const monthly = salaries.get(person.id) ?? null;
      if (monthly === null) missingSalary.push({ staffId: person.id, staffCode: person.code, name: person.name });
      if (pm.open.length) openDays.push({ name: `${person.name} (${person.code})`, days: pm.open });
      const mine = correctionsOf(person.id);
      rows.push(this.rowFor(person, month, monthly, pm, salaryDays, fullDayMinutes, working, holidays, { paise: sumPaise(mine.map((c) => c.amountPaise)), note: this.correctionNote(mine) }));
    }
    // People no longer on the staff who are owed money: a line of its own.
    const onSheet = new Set(rows.map((r) => r.staffId));
    const owedIds = [...new Set(corrections.filter((c) => !onSheet.has(c.staffId)).map((c) => c.staffId))].filter((id) => sumPaise(correctionsOf(id).map((c) => c.amountPaise)) > 0);
    if (owedIds.length) {
      const leavers = await this.prisma.staff.findMany({ where: { id: { in: owedIds } }, select: PERSON_SELECT, orderBy: { code: 'asc' } });
      for (const person of leavers) {
        const mine = correctionsOf(person.id);
        rows.push(this.correctionOnlyRow(person, month, working, holidays, salaryDays, sumPaise(mine.map((c) => c.amountPaise)), this.correctionNote(mine)));
      }
    }
    rows.sort((a, b) => a.staffCode.localeCompare(b.staffCode));
    return { rows, missingSalary, openDays, salaryDays, corrections };
  }

  private rowFromLine(line: PayrollLine): SheetRow {
    return {
      staffId: line.staffId,
      staffCode: line.staffCode,
      name: line.name,
      role: line.role,
      joinedOn: null,
      monthlyPaise: line.monthlyPaise,
      salaryDays: line.salaryDays,
      calendarDays: line.calendarDays,
      workingDays: line.workingDays,
      holidays: line.holidays,
      fullDays: line.fullDays,
      halfDays: line.halfDays,
      paidLeaveDays: line.paidLeaveDays,
      unpaidLeaveDays: line.unpaidLeaveDays,
      absentDays: line.absentDays,
      notEmployedDays: line.notEmployedDays,
      unmarkedDays: line.unmarkedDays,
      paidDays: line.paidHalfDays / 2,
      lossOfPayDays: line.lossOfPayHalfDays / 2,
      shortfallMinutes: line.shortfallMinutes,
      basicPaise: line.basicPaise,
      hraPaise: line.hraPaise,
      specialPaise: line.specialPaise,
      grossPaise: line.grossPaise,
      notEmployedPaise: line.notEmployedPaise,
      lossOfPayPaise: line.lossOfPayPaise,
      shortfallPaise: line.shortfallPaise,
      pfPaise: line.pfPaise,
      esiPaise: line.esiPaise,
      professionalTaxPaise: line.professionalTaxPaise,
      deductionsPaise: line.deductionsPaise,
      correctionPaise: line.correctionPaise,
      correctionNote: line.correctionNote,
      carryForwardPaise: line.carryForwardPaise,
      correctionOnly: line.monthlyPaise === 0 && line.correctionPaise !== 0,
      netPaise: line.netPaise,
      line: { id: line.id, status: line.status, paidAt: line.paidAt?.toISOString() ?? null, utrLast4: line.utr ? line.utr.slice(-4) : null, paidFrom: line.paidFrom },
    };
  }

  private async names(ids: Array<string | null | undefined>): Promise<Map<string, string>> {
    const clean = [...new Set(ids.filter((id): id is string => Boolean(id)))];
    if (!clean.length) return new Map();
    const rows = await this.prisma.staff.findMany({ where: { id: { in: clean } }, select: { id: true, name: true } });
    return new Map(rows.map((r) => [r.id, r.name]));
  }

  private async loadRun(month: string): Promise<(PayrollRun & { lines: PayrollLine[] }) | null> {
    return this.prisma.payrollRun.findUnique({ where: { month }, include: { lines: { orderBy: { staffCode: 'asc' } } } });
  }

  /** The month's salary sheet (FN-Salaries): the prepared sheet, or the live draft from attendance. */
  async sheet(monthValue: unknown, now = new Date()) {
    const month = this.month(monthValue);
    const run = await this.loadRun(month);
    const frozen = run && run.status !== 'returned';
    const live = frozen ? null : await this.draft(month, now, run?.id ?? null);
    const rows = frozen ? run.lines.map((l) => this.rowFromLine(l)) : live!.rows;
    const status: PayrollStatus = run ? (run.status as PayrollStatus) : 'draft';
    const who = await this.names([run?.preparedByStaffId, run?.approvedByStaffId, run?.returnedByStaffId]);
    const paid = rows.filter((r) => r.line?.status === 'paid');
    const closed = await this.locks.isClosed(month);
    return {
      month,
      label: monthLabel(month),
      status,
      closed,
      salaryDays: rows[0]?.salaryDays ?? live?.salaryDays ?? salaryDaysFor((await this.pricing.current()).payrollSalaryDays),
      calendarDays: calendarDaysIn(month),
      prepareFrom: `${nextMonth(month)}-01`,
      canPrepare: canPrepareOn(month, now) && !closed && (status === 'draft' || status === 'returned' || status === 'with_ceo'),
      payDay: `${nextMonth(month)}-01`,
      run: run
        ? {
            preparedBy: who.get(run.preparedByStaffId) ?? null,
            preparedAt: run.preparedAt.toISOString(),
            approvedBy: run.approvedByStaffId ? (who.get(run.approvedByStaffId) ?? null) : null,
            approvedAt: run.approvedAt?.toISOString() ?? null,
            returnedBy: run.returnedByStaffId ? (who.get(run.returnedByStaffId) ?? null) : null,
            returnedAt: run.returnedAt?.toISOString() ?? null,
            returnedReason: run.returnedReason,
            paidAt: run.paidAt?.toISOString() ?? null,
            netPaise: run.netPaise,
          }
        : null,
      totals: {
        people: rows.length,
        grossPaise: sumPaise(rows.map((r) => r.grossPaise)),
        deductionsPaise: sumPaise(rows.map((r) => r.deductionsPaise)),
        lossOfPayAndShortfallPaise: sumPaise(rows.map((r) => r.notEmployedPaise + r.lossOfPayPaise + r.shortfallPaise)),
        correctionsPaise: sumPaise(rows.map((r) => r.correctionPaise)),
        carryForwardPaise: sumPaise(rows.map((r) => r.carryForwardPaise)),
        netPaise: sumPaise(rows.map((r) => r.netPaise)),
        paidCount: paid.length,
        paidPaise: sumPaise(paid.map((r) => r.netPaise)),
        unpaidCount: frozen ? rows.length - paid.length : rows.length,
      },
      missingSalary: live?.missingSalary ?? [],
      openDays: live?.openDays ?? [],
      statutory: { lines: STATUTORY_DEDUCTIONS.map((d) => ({ ...d, paise: 0 })), note: STATUTORY_NOTE },
      rows,
    };
  }

  /**
   * Marks every working day of the month with no attendance as absent, for
   * everyone on the staff that day, so the sheet works from final attendance.
   */
  private async markMonthAbsences(month: string): Promise<void> {
    const { working } = await this.workingDayKeys(month);
    const people = (await this.candidates(month)).filter((p) => p.status === 'active');
    const [joined, away] = await Promise.all([this.joinedDays(people), this.awayPeriods(people)]);
    for (const day of working) {
      const ids = people.filter((p) => {
        const j = joined.get(p.id);
        return j && staffWorkingDays([day], j, away.get(p.id) ?? []).employed.length === 1;
      }).map((p) => p.id);
      if (ids.length) await this.days.markAbsentDays(new Date(`${day}T00:00:00.000Z`), ids);
    }
  }

  /** Finance (or the CEO) freezes the month's sheet, once the month is over, and sends the total to the CEO. */
  async prepare(monthValue: unknown, actor: Actor, now = new Date()) {
    const month = this.month(monthValue);
    if (!canPrepareOn(month, now)) throw new BadRequestException(`${monthLabel(month)} pay can be worked out from ${nextMonth(month)}-01, once every day of the month is over.`);
    await this.locks.assertOpen(month, 'its salary sheet');
    const existing = await this.prisma.payrollRun.findUnique({ where: { month } });
    if (existing && (existing.status === 'approved' || existing.status === 'paid')) {
      throw new ConflictException(`${monthLabel(month)} pay is already approved by the CEO.`);
    }
    await this.markMonthAbsences(month);
    const { rows, missingSalary, openDays, corrections } = await this.draft(month, now, existing?.id ?? null);
    if (openDays.length) {
      throw new BadRequestException(`Some days are still open, so attendance is not final: ${openDays.map((o) => `${o.name} on ${o.days.join(', ')}`).join('; ')}. Close those days first.`);
    }
    if (missingSalary.length) {
      throw new BadRequestException(`The CEO sets a monthly salary first for ${missingSalary.map((m) => `${m.name} (${m.staffCode})`).join(', ')}.`);
    }
    if (!rows.length) throw new BadRequestException(`Nobody was on the staff in ${monthLabel(month)}.`);
    const totals = { people: rows.length, grossPaise: sumPaise(rows.map((r) => r.grossPaise)), deductionsPaise: sumPaise(rows.map((r) => r.deductionsPaise)), netPaise: sumPaise(rows.map((r) => r.netPaise)) };
    const lineData = (runId: string): Prisma.PayrollLineCreateManyInput[] =>
      rows.map((r) => ({
        runId,
        staffId: r.staffId,
        staffCode: r.staffCode,
        name: r.name,
        role: r.role,
        monthlyPaise: r.monthlyPaise ?? 0,
        salaryDays: r.salaryDays,
        calendarDays: r.calendarDays,
        workingDays: r.workingDays,
        holidays: r.holidays,
        fullDays: r.fullDays,
        halfDays: r.halfDays,
        paidLeaveDays: r.paidLeaveDays,
        unpaidLeaveDays: r.unpaidLeaveDays,
        absentDays: r.absentDays,
        notEmployedDays: r.notEmployedDays,
        unmarkedDays: r.unmarkedDays,
        lossOfPayHalfDays: Math.round(r.lossOfPayDays * 2),
        paidHalfDays: Math.round(r.paidDays * 2),
        shortfallMinutes: r.shortfallMinutes,
        basicPaise: r.basicPaise,
        hraPaise: r.hraPaise,
        specialPaise: r.specialPaise,
        grossPaise: r.grossPaise,
        notEmployedPaise: r.notEmployedPaise,
        lossOfPayPaise: r.lossOfPayPaise,
        shortfallPaise: r.shortfallPaise,
        pfPaise: r.pfPaise,
        esiPaise: r.esiPaise,
        professionalTaxPaise: r.professionalTaxPaise,
        deductionsPaise: r.deductionsPaise,
        correctionPaise: r.correctionPaise,
        correctionNote: r.correctionNote,
        carryForwardPaise: r.carryForwardPaise,
        netPaise: r.netPaise,
      }));
    // Corrections go on the sheet of the person they belong to; a leaver who
    // owes money (net take-back) keeps theirs waiting, never forgotten.
    const onSheet = new Set(rows.map((r) => r.staffId));
    const used = corrections.filter((c) => onSheet.has(c.staffId));
    const waiting = corrections.filter((c) => !onSheet.has(c.staffId));
    try {
      await this.prisma.$transaction(async (tx) => {
        let runId: string;
        if (existing) {
          const claimed = await tx.payrollRun.updateMany({
            where: { id: existing.id, status: { in: ['with_ceo', 'returned'] }, preparedAt: existing.preparedAt },
            data: { status: 'with_ceo', ...totals, preparedByStaffId: actor.id, preparedAt: now, returnedAt: null, returnedByStaffId: null, returnedReason: null },
          });
          if (claimed.count !== 1) throw new ConflictException('The sheet changed meanwhile; reload');
          runId = existing.id;
          await tx.payrollLine.deleteMany({ where: { runId } });
          await tx.payrollLine.createMany({ data: lineData(runId) });
        } else {
          runId = (await tx.payrollRun.create({ data: { month, status: 'with_ceo', ...totals, preparedByStaffId: actor.id, preparedAt: now } })).id;
          await tx.payrollLine.createMany({ data: lineData(runId) });
        }
        // Worked out again: release what this sheet held, then apply what it holds now.
        await tx.payrollCorrection.updateMany({ where: { appliedRunId: runId }, data: { appliedRunId: null, appliedMonth: null } });
        const usedIds = used.map((c) => c.id).filter((id): id is string => Boolean(id));
        if (usedIds.length) await tx.payrollCorrection.updateMany({ where: { id: { in: usedIds } }, data: { appliedRunId: runId, appliedMonth: month } });
        const found = [...used.filter((c) => !c.id).map((c) => ({ c, applied: true })), ...waiting.filter((c) => !c.id).map((c) => ({ c, applied: false }))];
        if (found.length) {
          await tx.payrollCorrection.createMany({
            data: found.map(({ c, applied }) => ({
              staffId: c.staffId,
              relatesToMonth: c.relatesToMonth,
              amountPaise: c.amountPaise,
              reason: c.reason,
              source: c.source,
              appliedRunId: applied ? runId : null,
              appliedMonth: applied ? month : null,
            })),
          });
        }
      });
    } catch (error) {
      if (isUniqueViolation(error)) throw new ConflictException('The sheet changed meanwhile; reload');
      throw error;
    }
    await this.audit.log({
      actorId: actor.id,
      action: 'payroll.prepared',
      entityType: 'PayrollRun',
      entityCode: month,
      before: existing ? { status: existing.status, netPaise: existing.netPaise } : undefined,
      after: { status: 'with_ceo', ...totals },
      changedFields: ['status', 'netPaise'],
    });
    await this.syncBells(now);
    return this.sheet(month, now);
  }

  /**
   * The CEO approves exactly the total he saw: the request carries the net
   * total and the time the sheet was prepared, and a sheet prepared again
   * since is refused.
   */
  async approve(monthValue: unknown, expected: { netPaise?: unknown; preparedAt?: unknown }, actor: Actor, now = new Date()) {
    const month = this.month(monthValue);
    if (actor.role !== 'ceo') throw new ForbiddenException('Only the CEO approves the salary total');
    const netPaise = typeof expected.netPaise === 'number' && Number.isSafeInteger(expected.netPaise) ? expected.netPaise : null;
    const preparedAt = typeof expected.preparedAt === 'string' ? new Date(expected.preparedAt) : null;
    if (netPaise === null || !preparedAt || Number.isNaN(preparedAt.getTime())) {
      throw new BadRequestException('Approve the total you saw: send netPaise and preparedAt from the sheet');
    }
    await this.locks.assertOpen(month, 'its salary sheet');
    const run = await this.prisma.payrollRun.findUnique({ where: { month } });
    if (!run) throw new NotFoundException(`${monthLabel(month)} pay has not been prepared yet`);
    if (run.status !== 'with_ceo') throw new BadRequestException(`${monthLabel(month)} pay is ${run.status.replace('_', ' ')}, so there is nothing to approve`);
    await this.prisma.$transaction(async (tx) => {
      const claimed = await tx.payrollRun.updateMany({
        where: { id: run.id, status: 'with_ceo', netPaise, preparedAt },
        data: { status: 'approved', approvedByStaffId: actor.id, approvedAt: now },
      });
      if (claimed.count !== 1) {
        throw new ConflictException(`${monthLabel(month)} pay changed after you opened it (Finance prepared it again). Reload and check the new total.`);
      }
      // A take-back larger than someone's pay this month goes on the next sheet.
      const carried = await tx.payrollLine.findMany({ where: { runId: run.id, carryForwardPaise: { lt: 0 } }, select: { staffId: true, carryForwardPaise: true } });
      if (carried.length) {
        await tx.payrollCorrection.createMany({
          data: carried.map((l) => ({
            staffId: l.staffId,
            relatesToMonth: month,
            amountPaise: l.carryForwardPaise,
            reason: `Taken back on the next sheet: larger than ${monthLabel(month)} pay`,
            source: 'carry_forward',
            createdByRunId: run.id,
          })),
        });
      }
    });
    const approved = await this.prisma.payrollRun.findUniqueOrThrow({ where: { id: run.id } });
    await this.audit.log({
      actorId: actor.id,
      action: 'payroll.approved',
      entityType: 'PayrollRun',
      entityCode: month,
      before: { status: 'with_ceo' },
      after: { status: approved.status, netPaise: approved.netPaise, people: approved.people, preparedAt: approved.preparedAt.toISOString() },
      changedFields: ['status'],
    });
    await this.syncBells(now);
    return this.sheet(month, now);
  }

  /** The CEO sends the sheet back to Finance with a reason. */
  async sendBack(monthValue: unknown, reasonValue: unknown, actor: Actor, now = new Date()) {
    const month = this.month(monthValue);
    if (actor.role !== 'ceo') throw new ForbiddenException('Only the CEO sends the salary sheet back');
    const reason = typeof reasonValue === 'string' ? reasonValue.trim().slice(0, 300) : '';
    if (!reason) throw new BadRequestException('Write what Finance should check');
    await this.locks.assertOpen(month, 'its salary sheet');
    const run = await this.prisma.payrollRun.findUnique({ where: { month } });
    if (!run) throw new NotFoundException(`${monthLabel(month)} pay has not been prepared yet`);
    const claimed = await this.prisma.payrollRun.updateMany({ where: { id: run.id, status: 'with_ceo' }, data: { status: 'returned', returnedByStaffId: actor.id, returnedAt: now, returnedReason: reason } });
    if (claimed.count !== 1) throw new BadRequestException(`${monthLabel(month)} pay is ${run.status.replace('_', ' ')}, so it can't be sent back`);
    await this.audit.log({ actorId: actor.id, action: 'payroll.sent_back', entityType: 'PayrollRun', entityCode: month, before: { status: run.status }, after: { status: 'returned' }, changedFields: ['status'], reason });
    await this.syncBells(now);
    return this.sheet(month, now);
  }

  /**
   * Finance pays one person and records the UTR. The payment is dated today:
   * if today's bank day is already closed it is refused (the closed day would
   * no longer agree with the bank), like a closed month. The run is marked
   * paid in the same transaction as the last line.
   */
  async payLine(monthValue: unknown, lineId: string, input: { utr?: unknown; paidFrom?: unknown }, actor: Actor, now = new Date()) {
    const month = this.month(monthValue);
    await this.locks.assertOpen(month, 'its salary payments');
    await this.locks.assertOpenOn(now, 'its salary payments');
    const run = await this.prisma.payrollRun.findUnique({ where: { month } });
    if (!run) throw new NotFoundException(`${monthLabel(month)} pay has not been prepared yet`);
    if (run.status !== 'approved') {
      throw new BadRequestException(run.status === 'paid' ? `${monthLabel(month)} pay is already paid` : `The CEO approves ${monthLabel(month)}'s total before anyone is paid`);
    }
    const line = await this.prisma.payrollLine.findFirst({ where: { id: lineId, runId: run.id } });
    if (!line) throw new NotFoundException('That person is not on this salary sheet');
    if (line.status === 'paid') throw new ConflictException(`${line.name} is already paid`);
    const paidFrom = typeof input.paidFrom === 'string' && (PAID_FROM as readonly string[]).includes(input.paidFrom) ? input.paidFrom : 'bank_transfer';
    const utr = typeof input.utr === 'string' ? input.utr.trim() : '';
    if (line.netPaise > 0 && !utr) throw new BadRequestException('Type the UTR from the bank for this salary');
    if (utr && !/^[A-Za-z0-9]{6,30}$/.test(utr)) throw new BadRequestException('A UTR is 6 to 30 letters and numbers');
    if (paidFrom !== 'cash' && line.netPaise > 0) {
      const closedDay = await this.prisma.bankDayClose.findFirst({ where: { day: { gte: istDay(now) } }, select: { day: true } });
      if (closedDay) throw new BadRequestException(`The bank day ${closedDay.day} is already closed, so a payment dated ${istDay(now)} would no longer agree with the bank. Pay it on the next open bank day.`);
    }
    if (utr) await assertUtrUnused(this.prisma, utr);
    let monthPaid = false;
    try {
      monthPaid = await this.prisma.$transaction(async (tx) => {
        const claimed = await tx.payrollLine.updateMany({
          where: { id: line.id, status: 'unpaid' },
          data: { status: 'paid', paidAt: now, paidByStaffId: actor.id, paidFrom, utr: utr || null },
        });
        if (claimed.count !== 1) throw new ConflictException(`${line.name} is already paid`);
        const left = await tx.payrollLine.count({ where: { runId: run.id, status: 'unpaid' } });
        if (left === 0) await tx.payrollRun.updateMany({ where: { id: run.id, status: 'approved' }, data: { status: 'paid', paidAt: now } });
        return left === 0;
      });
    } catch (error) {
      if (isUniqueViolation(error)) throw utrUsed(utr);
      throw error;
    }
    await this.audit.log({
      actorId: actor.id,
      action: 'payroll.line_paid',
      entityType: 'PayrollLine',
      entityCode: `${month}:${line.staffCode}`,
      before: { status: 'unpaid' },
      after: { status: 'paid', netPaise: line.netPaise, paidFrom },
      changedFields: ['status', 'paidAt', 'utr', 'paidFrom'],
    });
    await this.payslipBell(line, month, now);
    await this.syncBells(now);
    return { paid: true, monthPaid, line: this.rowFromLine(await this.prisma.payrollLine.findUniqueOrThrow({ where: { id: line.id } })) };
  }

  /** "Send payslips again": every paid person's bell says their payslip is ready. */
  async resendPayslips(monthValue: unknown, actor: Actor, now = new Date()) {
    const month = this.month(monthValue);
    const run = await this.loadRun(month);
    if (!run) throw new NotFoundException(`${monthLabel(month)} pay has not been prepared yet`);
    const paid = run.lines.filter((l) => l.status === 'paid');
    if (!paid.length) throw new BadRequestException('Nobody has been paid for this month yet, so there are no payslips to send');
    for (const line of paid) {
      await this.notifications.clear({ kind: 'payslip_ready', subjectType: 'payroll_line', subjectId: line.id }, { byStaffId: actor.id, reason: 'sent_again' }, now);
      await this.payslipBell(line, month, now);
    }
    await this.audit.log({ actorId: actor.id, action: 'payroll.payslips_sent', entityType: 'PayrollRun', entityCode: month, after: { people: paid.length } });
    return { sent: paid.length };
  }

  private async payslipBell(line: PayrollLine, month: string, now: Date) {
    await this.sources.safely('payslip', async () => {
      const staff = await this.prisma.staff.findUnique({ where: { id: line.staffId }, select: { id: true, role: true, status: true } });
      if (!staff || staff.status !== 'active') return;
      await this.notifications.open(
        {
          recipientStaffId: staff.id,
          kind: 'payslip_ready',
          title: `Your ${monthLabel(month)} payslip is ready`,
          body: 'Open it to see or download it',
          link: notificationLink(staff.role, 'payslip_ready'),
          subjectType: 'payroll_line',
          subjectId: line.id,
        },
        now,
      );
    });
  }

  private async syncBells(now: Date) {
    await this.sources.safely('payroll', () => this.sources.syncPayroll(now));
  }

  // -------------------------------------------------------------- payslips

  private async payslipFromLine(line: PayrollLine & { run: PayrollRun }) {
    const policy = await this.pricing.current();
    const staff = await this.prisma.staff.findUnique({
      where: { id: line.staffId },
      select: { createdAt: true, joinedOn: true, teamLead: { select: { name: true } }, reportsTo: { select: { name: true } } },
    });
    const statutory = [
      { key: 'pf', label: 'Provident fund (PF)', paise: line.pfPaise },
      { key: 'esi', label: 'ESI', paise: line.esiPaise },
      { key: 'professional_tax', label: 'Professional tax', paise: line.professionalTaxPaise },
    ];
    return {
      month: line.run.month,
      label: monthLabel(line.run.month),
      status: line.status,
      paidOn: line.paidAt?.toISOString() ?? null,
      company: { name: policy.companyLegalName, address: policy.companyAddress, city: 'Bengaluru' },
      employee: {
        name: line.name,
        code: line.staffCode,
        designation: ROLE_LABEL[line.role] ?? line.role,
        reportsTo: staff?.teamLead?.name ?? staff?.reportsTo?.name ?? null,
        joinedOn: staff?.joinedOn ? staff.joinedOn.toISOString().slice(0, 10) : (staff?.createdAt.toISOString() ?? null),
        paymentRefLast4: line.utr ? line.utr.slice(-4) : null,
        paidFrom: line.paidFrom,
      },
      days: {
        salaryDays: line.salaryDays,
        calendarDays: line.calendarDays,
        paidDays: line.paidHalfDays / 2,
        lossOfPayDays: line.lossOfPayHalfDays / 2,
        notEmployedDays: line.notEmployedDays,
        unmarkedDays: line.unmarkedDays,
        fullDays: line.fullDays,
        halfDays: line.halfDays,
        paidLeaveDays: line.paidLeaveDays,
        unpaidLeaveDays: line.unpaidLeaveDays,
        absentDays: line.absentDays,
        holidays: line.holidays,
        shortfallMinutes: line.shortfallMinutes,
      },
      earnings: [
        { key: 'basic', label: 'Basic', paise: line.basicPaise },
        { key: 'hra', label: 'House rent allowance', paise: line.hraPaise },
        { key: 'special', label: 'Special allowance', paise: line.specialPaise },
      ],
      grossPaise: line.grossPaise,
      deductions: [
        ...statutory.map((s) => ({ ...s, note: s.paise === 0 ? STATUTORY_NOTE : null })),
        ...(line.notEmployedPaise ? [{ key: 'not_on_staff', label: 'Working days not on the staff', paise: line.notEmployedPaise, note: null }] : []),
        { key: 'loss_of_pay', label: 'Loss of pay', paise: line.lossOfPayPaise, note: null },
        { key: 'shortfall', label: 'Shortfall not made up', paise: line.shortfallPaise, note: null },
      ],
      deductionsPaise: line.deductionsPaise,
      correction: line.correctionPaise ? { paise: line.correctionPaise, note: line.correctionNote } : null,
      carryForwardPaise: line.carryForwardPaise,
      netPaise: line.netPaise,
      netInWords: rupeesInWords(line.netPaise),
      note: 'Prepared from attendance and approved leave, checked and released by Finance. PF, ESI and professional tax start once the company registration is complete.',
    };
  }

  /** Finance or the CEO opens anyone's payslip for a prepared month. */
  async payslipFor(monthValue: unknown, staffId: string) {
    const month = this.month(monthValue);
    const line = await this.prisma.payrollLine.findFirst({ where: { staffId, run: { month } }, include: { run: true } });
    if (!line) throw new NotFoundException('No payslip for that person and month');
    return this.payslipFromLine(line);
  }

  /** The person's own payslips: only months where they have been paid (released by Finance). */
  async myPayslips(staffId: string) {
    const lines = await this.prisma.payrollLine.findMany({ where: { staffId, status: 'paid' }, include: { run: { select: { month: true } } }, orderBy: { run: { month: 'desc' } } });
    return { months: lines.map((l) => ({ month: l.run.month, label: monthLabel(l.run.month), paidOn: l.paidAt?.toISOString() ?? null })) };
  }

  async myPayslip(staffId: string, monthValue: unknown) {
    const month = this.month(monthValue);
    const line = await this.prisma.payrollLine.findFirst({ where: { staffId, status: 'paid', run: { month } }, include: { run: true } });
    if (!line) throw new NotFoundException(`Your ${monthLabel(month)} payslip is not released yet`);
    return this.payslipFromLine(line);
  }

  // ----------------------------------------------------------- downloads

  /** The salary sheet for the CA: pay, deductions and payments. */
  async sheetCsv(monthValue: unknown, now = new Date()): Promise<{ filename: string; csv: string }> {
    const sheet = await this.sheet(monthValue, now);
    const header = [
      'Month', 'Staff code', 'Name', 'Role', 'Salary days', 'Paid days', 'Loss of pay days', 'Working days not on staff', 'Unmarked working days', 'Full days', 'Half days', 'Paid leave', 'Unpaid leave', 'Absent', 'Holidays',
      'Shortfall not made up (minutes)', 'Monthly pay (Rs)', 'Basic (Rs)', 'HRA (Rs)', 'Special allowance (Rs)', 'Not on staff (Rs)', 'Loss of pay (Rs)', 'Shortfall (Rs)', 'PF (Rs)', 'ESI (Rs)', 'Professional tax (Rs)',
      'Deductions (Rs)', 'Correction (Rs)', 'Correction note', 'Carried to next sheet (Rs)', 'Net pay (Rs)', 'Status', 'Paid on', 'Payment reference',
    ];
    const rows: CsvValue[][] = sheet.rows.map((r) => [
      sheet.month, r.staffCode, r.name, ROLE_LABEL[r.role] ?? r.role, r.salaryDays, r.paidDays, r.lossOfPayDays, r.notEmployedDays, r.unmarkedDays, r.fullDays, r.halfDays, r.paidLeaveDays, r.unpaidLeaveDays, r.absentDays, r.holidays,
      r.shortfallMinutes, rupees(r.monthlyPaise), rupees(r.basicPaise), rupees(r.hraPaise), rupees(r.specialPaise), rupees(r.notEmployedPaise), rupees(r.lossOfPayPaise), rupees(r.shortfallPaise), rupees(r.pfPaise), rupees(r.esiPaise), rupees(r.professionalTaxPaise),
      rupees(r.deductionsPaise), rupees(r.correctionPaise), r.correctionNote ?? '', rupees(r.carryForwardPaise), rupees(r.netPaise), r.line?.status === 'paid' ? 'Paid' : sheet.status === 'draft' ? 'Draft' : 'Not paid', r.line?.paidAt?.slice(0, 10) ?? '', r.line?.utrLast4 ? `****${r.line.utrLast4}` : '',
    ]);
    const total: CsvValue[] = header.map(() => '');
    total[0] = sheet.month;
    total[1] = 'TOTAL';
    total[header.indexOf('Deductions (Rs)')] = rupees(sheet.totals.deductionsPaise);
    total[header.indexOf('Correction (Rs)')] = rupees(sheet.totals.correctionsPaise);
    total[header.indexOf('Carried to next sheet (Rs)')] = rupees(sheet.totals.carryForwardPaise);
    total[header.indexOf('Net pay (Rs)')] = rupees(sheet.totals.netPaise);
    total[header.indexOf('Status')] = sheet.status;
    rows.push(total);
    return { filename: `salary-sheet-${sheet.month}.csv`, csv: toCsv(header, rows) };
  }

  // -------------------------------------------------------- for P&L, books

  /** Salaries for P&L: approved or paid months whose last day falls in the period (earned pay before statutory deductions). */
  async salariesInRange(from: Date, to: Date): Promise<{ totalPaise: number; months: { month: string; status: string; costPaise: number }[]; pendingMonths: string[] }> {
    const runs = await this.prisma.payrollRun.findMany({ select: { month: true, status: true, netPaise: true, lines: { select: { netPaise: true, pfPaise: true, esiPaise: true, professionalTaxPaise: true } } } });
    const months: { month: string; status: string; costPaise: number }[] = [];
    const pendingMonths: string[] = [];
    for (const run of runs) {
      const lastMs = monthBounds(run.month).to.getTime();
      if (lastMs < from.getTime() || lastMs > to.getTime()) continue;
      if (run.status === 'approved' || run.status === 'paid') {
        months.push({ month: run.month, status: run.status, costPaise: sumPaise(run.lines.map((l) => l.netPaise + l.pfPaise + l.esiPaise + l.professionalTaxPaise)) });
      } else {
        pendingMonths.push(run.month);
      }
    }
    months.sort((a, b) => a.month.localeCompare(b.month));
    return { totalPaise: sumPaise(months.map((m) => m.costPaise)), months, pendingMonths };
  }
}
