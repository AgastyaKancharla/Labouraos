import { Injectable } from '@nestjs/common';
import { LeaveRequest } from '@prisma/client';
import { PrismaService } from '../../common/prisma/prisma.service';
import { getCalendarPartsInTimezone } from '../../common/time/period-boundary';
import { PricingService, goLiveDayOf } from '../pricing/pricing.service';
import { AttendanceClock } from './attendance-clock';
import { ATTENDANCE_ROLES } from './attendance-days.service';
import { monthRange } from './day-rules';
import { WorkingDaysService } from './working-days.service';

export const LEAVE_KINDS = ['casual', 'emergency'] as const;
export type LeaveKind = (typeof LEAVE_KINDS)[number];

export interface KindBalance {
  earned: number;
  taken: number;
  paidTaken: number;
  unpaidTaken: number;
  left: number;
}

export interface LeaveBalance {
  staffId: string;
  asOfMonth: string;
  casual: KindBalance;
  emergency: KindBalance;
}


/** "YYYY-MM" of an IST calendar date stored at UTC midnight. */
export function monthOf(date: Date): string {
  return date.toISOString().slice(0, 7);
}

export function nextMonth(month: string): string {
  const [year, m] = month.split('-').map((part) => Number(part));
  return m === 12 ? `${year + 1}-01` : `${year}-${String(m + 1).padStart(2, '0')}`;
}

/** "YYYY-MM-DD" of an instant in IST. */
function istDayOf(at: Date): string {
  const parts = getCalendarPartsInTimezone(at);
  return `${parts.year}-${String(parts.month).padStart(2, '0')}-${String(parts.day).padStart(2, '0')}`;
}

/**
 * The first month that earns paid leave (Master Guide, decided 11 Nov): none in
 * the month someone joins, even on the 1st; the first leaves come on the 1st of
 * the following month. With a go-live date in Settings (owner decision 12 Nov)
 * accrual starts from the later of joining and go-live: the first 1st of a month
 * on or after go-live, if that is later.
 */
export function firstAccrualMonth(joiningDay: string, goLiveDay?: string | null): string {
  const fromJoining = nextMonth(joiningDay.slice(0, 7));
  if (!goLiveDay) return fromJoining;
  const fromGoLive = goLiveDay.endsWith('-01') ? goLiveDay.slice(0, 7) : nextMonth(goLiveDay.slice(0, 7));
  return fromGoLive > fromJoining ? fromGoLive : fromJoining;
}

/**
 * Leave balances and the leave days written on the attendance record.
 * Earned: `casualLeavePerMonth` and `emergencyLeavePerMonth` on the 1st of
 * each month (one LeaveAccrual row per month), carried forward with no limit.
 * Taken: leave days on the attendance record. Left: earned minus paid days.
 */
@Injectable()
export class LeaveService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly pricing: PricingService,
    private readonly clock: AttendanceClock,
    private readonly workingDays: WorkingDaysService,
  ) {}

  todayIst(): Date {
    const parts = getCalendarPartsInTimezone(this.clock.now());
    return new Date(Date.UTC(parts.year, parts.month - 1, parts.day));
  }

  /**
   * The day someone joined (IST "YYYY-MM-DD"): the joining date the CEO
   * entered; else their first login (first attendance login or first session,
   * as payroll counts it); else the day the account was created.
   */
  async joiningDay(staff: { id: string; joinedOn: Date | null; createdAt: Date }): Promise<string> {
    if (staff.joinedOn) return staff.joinedOn.toISOString().slice(0, 10);
    const [firstDay, firstSession] = await Promise.all([
      this.prisma.attendanceDay.findFirst({
        where: { staffId: staff.id, loginAt: { not: null } },
        orderBy: { loginAt: 'asc' },
        select: { loginAt: true },
      }),
      this.prisma.staffSession.findFirst({
        where: { staffId: staff.id },
        orderBy: { createdAt: 'asc' },
        select: { createdAt: true },
      }),
    ]);
    const logins = [firstDay?.loginAt, firstSession?.createdAt].filter((d): d is Date => Boolean(d));
    if (logins.length) return istDayOf(new Date(Math.min(...logins.map((d) => d.getTime()))));
    return istDayOf(staff.createdAt);
  }

  /**
   * Writes the month's accrual for every month whose 1st has come since the
   * person joined (joining date, else first login, else account created), or
   * since the go-live date in Settings when that is later. No
   * leave is earned in the joining month, even for someone joining on the 1st
   * (Master Guide, decided 11 Nov): the first accrual is on the 1st of the
   * following month. A row for a month before that (written from an older
   * rule, or before the joining date or go-live was set) is never deleted: the
   * balance simply does not count it, so a wrong date entered by mistake and
   * corrected later brings the leave back. Safe to run again: one row per person per month.
   */
  async ensureAccrued(staffId: string): Promise<number> {
    const staff = await this.prisma.staff.findUnique({
      where: { id: staffId },
      select: { id: true, role: true, status: true, createdAt: true, joinedOn: true },
    });
    if (!staff || !ATTENDANCE_ROLES.includes(staff.role) || staff.status !== 'active') return 0;
    const policy = await this.pricing.current();
    let month = firstAccrualMonth(await this.joiningDay(staff), goLiveDayOf(policy));
    const current = monthOf(this.todayIst());
    const existing = new Set(
      (
        await this.prisma.leaveAccrual.findMany({
          where: { staffId },
          select: { month: true },
        })
      ).map((row) => row.month),
    );
    let written = 0;
    for (let guard = 0; month <= current && guard < 600; guard += 1) {
      if (!existing.has(month)) {
        await this.prisma.leaveAccrual.upsert({
          where: { staffId_month: { staffId, month } },
          create: {
            staffId,
            month,
            casual: policy.casualLeavePerMonth,
            emergency: policy.emergencyLeavePerMonth,
          },
          update: {},
        });
        written += 1;
      }
      month = nextMonth(month);
    }
    return written;
  }

  /** Nightly: accrues for everyone who marks attendance. */
  async accrueAll(): Promise<{ written: number }> {
    const people = await this.prisma.staff.findMany({
      where: { role: { in: ATTENDANCE_ROLES }, status: 'active' },
      select: { id: true },
    });
    let written = 0;
    for (const person of people) {
      written += await this.ensureAccrued(person.id);
    }
    return { written };
  }

  /** The first month that earns leave for a person (later of joining and go-live), or null for someone who earns none. */
  async firstEarningMonth(staffId: string): Promise<string | null> {
    const staff = await this.prisma.staff.findUnique({
      where: { id: staffId },
      select: { id: true, createdAt: true, joinedOn: true },
    });
    if (!staff) return null;
    return firstAccrualMonth(await this.joiningDay(staff), goLiveDayOf(await this.pricing.current()));
  }

  async balance(staffId: string): Promise<LeaveBalance> {
    await this.ensureAccrued(staffId);
    const first = await this.firstEarningMonth(staffId);
    // Rows before the first earning month stay in the table but never count.
    const accruals = (await this.prisma.leaveAccrual.findMany({ where: { staffId } })).filter((row) => !first || row.month >= first);
    const leaveDays = await this.prisma.attendanceDay.findMany({
      where: { staffId, dayType: 'leave' },
      select: { leaveKind: true, leaveUnpaid: true },
    });
    const build = (kind: LeaveKind): KindBalance => {
      const earned = accruals.reduce(
        (sum, row) => sum + (kind === 'casual' ? row.casual : row.emergency),
        0,
      );
      const ofKind = leaveDays.filter((row) => (row.leaveKind ?? 'casual') === kind);
      const paidTaken = ofKind.filter((row) => !row.leaveUnpaid).length;
      const unpaidTaken = ofKind.length - paidTaken;
      return {
        earned,
        taken: ofKind.length,
        paidTaken,
        unpaidTaken,
        left: Math.max(0, earned - paidTaken),
      };
    };
    return {
      staffId,
      asOfMonth: monthOf(this.todayIst()),
      casual: build('casual'),
      emergency: build('emergency'),
    };
  }

  /** Whole days from..to, weekly days off and holidays left out. */
  async leaveDates(from: Date, to: Date): Promise<Date[]> {
    return (await this.workingDays.calendar(from, to)).workingDates;
  }

  /** Casual days on leave in a month (approved), and in pending requests. */
  async casualDaysInMonth(
    staffId: string,
    month: string,
    excludeRequestId?: string,
  ): Promise<{ taken: number; pending: number }> {
    const range = monthRange(month);
    if (!range) return { taken: 0, pending: 0 };
    const taken = await this.prisma.attendanceDay.count({
      where: {
        staffId,
        dayType: 'leave',
        leaveKind: 'casual',
        date: { gte: range.from, lte: range.to },
      },
    });
    const pendingRequests = await this.prisma.leaveRequest.findMany({
      where: {
        staffId,
        kind: 'casual',
        status: 'pending',
        fromDate: { lte: range.to },
        toDate: { gte: range.from },
        ...(excludeRequestId ? { id: { not: excludeRequestId } } : {}),
      },
    });
    let pending = 0;
    for (const request of pendingRequests) {
      const dates = await this.leaveDates(request.fromDate, request.toDate);
      pending += dates.filter((date) => monthOf(date) === month).length;
    }
    return { taken, pending };
  }

  /**
   * Writes the leave days of an approved request. Days the person worked are
   * left alone. The first days up to the paid balance are paid; the rest are
   * unpaid leave (nothing is ever blocked).
   */
  async applyApproval(request: LeaveRequest): Promise<{ paidDays: number; unpaidDays: number }> {
    const balance = await this.balance(request.staffId);
    let paidLeft = request.kind === 'emergency' ? balance.emergency.left : balance.casual.left;
    let paidDays = 0;
    let unpaidDays = 0;
    for (const date of await this.leaveDates(request.fromDate, request.toDate)) {
      const existing = await this.prisma.attendanceDay.findUnique({
        where: { staffId_date: { staffId: request.staffId, date } },
      });
      if (existing && (existing.loginAt || existing.dayType === 'leave')) continue;
      const unpaid = paidLeft <= 0;
      if (!unpaid) paidLeft -= 1;
      const data = {
        dayType: 'leave',
        closedReason: null,
        leaveKind: request.kind,
        leaveUnpaid: unpaid,
        leaveRequestId: request.id,
      };
      if (existing) {
        await this.prisma.attendanceDay.update({ where: { id: existing.id }, data });
      } else {
        await this.prisma.attendanceDay.create({
          data: { staffId: request.staffId, date, ...data },
        });
      }
      if (unpaid) unpaidDays += 1;
      else paidDays += 1;
    }
    return { paidDays, unpaidDays };
  }

  /**
   * Works out again which leave days of a request are paid, after its days
   * changed (a holiday added or removed). Days in date order are paid while
   * the balance, not counting this request, lasts; the rest are unpaid.
   */
  async reallocate(requestId: string): Promise<{ paidDays: number; unpaidDays: number }> {
    const request = await this.prisma.leaveRequest.findUniqueOrThrow({ where: { id: requestId } });
    const rows = await this.prisma.attendanceDay.findMany({
      where: { leaveRequestId: requestId, dayType: 'leave' },
      orderBy: { date: 'asc' },
    });
    await this.ensureAccrued(request.staffId);
    const first = await this.firstEarningMonth(request.staffId);
    const accruals = (await this.prisma.leaveAccrual.findMany({ where: { staffId: request.staffId } })).filter((row) => !first || row.month >= first);
    const earned = accruals.reduce(
      (sum, row) => sum + (request.kind === 'emergency' ? row.emergency : row.casual),
      0,
    );
    const paidElsewhere = await this.prisma.attendanceDay.count({
      where: {
        staffId: request.staffId,
        dayType: 'leave',
        leaveKind: request.kind,
        leaveUnpaid: false,
        NOT: { leaveRequestId: requestId },
      },
    });
    let left = Math.max(0, earned - paidElsewhere);
    let paidDays = 0;
    let unpaidDays = 0;
    for (const row of rows) {
      const unpaid = left <= 0;
      if (!unpaid) left -= 1;
      if (row.leaveUnpaid !== unpaid) {
        await this.prisma.attendanceDay.update({ where: { id: row.id }, data: { leaveUnpaid: unpaid } });
      }
      if (unpaid) unpaidDays += 1;
      else paidDays += 1;
    }
    await this.prisma.leaveRequest.update({
      where: { id: requestId },
      data: { paidDays, unpaidDays },
    });
    return { paidDays, unpaidDays };
  }

  /**
   * Takes the leave days of a request off the record (an approval overturned).
   * A past day goes back to absent; a future day is removed.
   */
  async undoApproval(request: LeaveRequest): Promise<void> {
    const today = this.todayIst();
    const rows = await this.prisma.attendanceDay.findMany({
      where: { leaveRequestId: request.id, dayType: 'leave', loginAt: null },
    });
    for (const row of rows) {
      if (row.date.getTime() < today.getTime()) {
        await this.prisma.attendanceDay.update({
          where: { id: row.id },
          data: {
            dayType: 'absent',
            closedReason: 'no_login',
            leaveKind: null,
            leaveUnpaid: false,
            leaveRequestId: null,
          },
        });
      } else {
        await this.prisma.attendanceDay.delete({ where: { id: row.id } });
      }
    }
  }
}
