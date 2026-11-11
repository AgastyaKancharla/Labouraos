import { Injectable } from '@nestjs/common';
import { LeaveRequest } from '@prisma/client';
import { PrismaService } from '../../common/prisma/prisma.service';
import { getCalendarPartsInTimezone } from '../../common/time/period-boundary';
import { PricingService } from '../pricing/pricing.service';
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
   * Writes the month's accrual for every month whose 1st has come since the
   * account was created. No leave is earned in the joining month, even for a
   * person created on the 1st (Master Guide, decided 11 Nov): the first
   * accrual is on the 1st of the following month.
   * Safe to run again: one row per person per month.
   */
  async ensureAccrued(staffId: string): Promise<number> {
    const staff = await this.prisma.staff.findUnique({
      where: { id: staffId },
      select: { id: true, role: true, status: true, createdAt: true },
    });
    if (!staff || !ATTENDANCE_ROLES.includes(staff.role) || staff.status !== 'active') return 0;
    const created = getCalendarPartsInTimezone(staff.createdAt);
    let month = `${created.year}-${String(created.month).padStart(2, '0')}`;
    month = nextMonth(month);
    const current = monthOf(this.todayIst());
    const existing = new Set(
      (
        await this.prisma.leaveAccrual.findMany({
          where: { staffId },
          select: { month: true },
        })
      ).map((row) => row.month),
    );
    const policy = await this.pricing.current();
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

  async balance(staffId: string): Promise<LeaveBalance> {
    await this.ensureAccrued(staffId);
    const accruals = await this.prisma.leaveAccrual.findMany({ where: { staffId } });
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
    const accruals = await this.prisma.leaveAccrual.findMany({ where: { staffId: request.staffId } });
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
