import { Injectable } from '@nestjs/common';
import { LeaveRequest, Prisma } from '@prisma/client';
import { PrismaService } from '../../common/prisma/prisma.service';
import { getCalendarPartsInTimezone } from '../../common/time/period-boundary';
import { PricingService, goLiveDayOf } from '../pricing/pricing.service';
import { AttendanceClock } from './attendance-clock';
import { ATTENDANCE_ROLES } from './attendance-days.service';
import { classifyDay, lateMinutesFor, monthRange } from './day-rules';
import {
  halvesToDays,
  isLeaveHalf,
  LeaveHalf,
  leaveFieldsFor,
  leaveHalvesOf,
  splitPaid,
} from './leave-units';
import { WorkingDaysService } from './working-days.service';

export const LEAVE_KINDS = ['casual', 'emergency'] as const;
export type LeaveKind = (typeof LEAVE_KINDS)[number];

/** Leave fields cleared: the day carries no leave any more. */
export const NO_LEAVE = {
  leaveKind: null,
  leaveUnpaid: false,
  leaveHalf: null,
  leavePartUnpaid: false,
  leaveRequestId: null,
  otherLeaveRequestId: null,
} as const;

/** Days, whole or half (1.5): a half day of leave uses half a day of the balance. */
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

  /** Paid leave earned so far (from the first earning month), in half days. */
  private async earnedHalves(staffId: string, kind: LeaveKind): Promise<number> {
    await this.ensureAccrued(staffId);
    const first = await this.firstEarningMonth(staffId);
    // Rows before the first earning month stay in the table but never count.
    const accruals = (await this.prisma.leaveAccrual.findMany({ where: { staffId } })).filter((row) => !first || row.month >= first);
    return 2 * accruals.reduce((sum, row) => sum + (kind === 'casual' ? row.casual : row.emergency), 0);
  }

  /** Attendance days carrying leave: full leave days and days with a half day of leave. */
  private leaveRowsWhere(staffId: string): Prisma.AttendanceDayWhereInput {
    return { staffId, OR: [{ dayType: 'leave' }, { leaveHalf: { not: null } }] };
  }

  /**
   * Balances in days, counted in halves (owner decision 12 Nov): a half day of
   * leave uses half a day of the balance, so "left" can be 1.5.
   */
  async balance(staffId: string): Promise<LeaveBalance> {
    const [casualEarned, emergencyEarned] = [await this.earnedHalves(staffId, 'casual'), await this.earnedHalves(staffId, 'emergency')];
    const leaveDays = await this.prisma.attendanceDay.findMany({
      where: this.leaveRowsWhere(staffId),
      select: { dayType: true, leaveKind: true, leaveUnpaid: true, leaveHalf: true, leavePartUnpaid: true },
    });
    const build = (kind: LeaveKind, earnedHalves: number): KindBalance => {
      let paid = 0;
      let unpaid = 0;
      for (const row of leaveDays) {
        if ((row.leaveKind ?? 'casual') !== kind) continue;
        const halves = leaveHalvesOf(row);
        paid += halves.paid;
        unpaid += halves.unpaid;
      }
      return {
        earned: halvesToDays(earnedHalves),
        taken: halvesToDays(paid + unpaid),
        paidTaken: halvesToDays(paid),
        unpaidTaken: halvesToDays(unpaid),
        left: halvesToDays(Math.max(0, earnedHalves - paid)),
      };
    };
    return {
      staffId,
      asOfMonth: monthOf(this.todayIst()),
      casual: build('casual', casualEarned),
      emergency: build('emergency', emergencyEarned),
    };
  }

  /** Whole days from..to, weekly days off and holidays left out. */
  async leaveDates(from: Date, to: Date): Promise<Date[]> {
    return (await this.workingDays.calendar(from, to)).workingDates;
  }

  /** Leave days a request asks for (or a part of it): ½ for a half day, else the working days in the range. */
  async requestDays(request: { fromDate: Date; toDate: Date; half?: string | null }): Promise<{ dates: Date[]; days: number }> {
    const dates = await this.leaveDates(request.fromDate, request.toDate);
    const perDay = isLeaveHalf(request.half) ? 1 : 2;
    return { dates, days: halvesToDays(dates.length * perDay) };
  }

  /** Casual days on leave in a month (approved), and in pending requests; half days count ½. */
  async casualDaysInMonth(
    staffId: string,
    month: string,
    excludeRequestId?: string,
  ): Promise<{ taken: number; pending: number }> {
    const range = monthRange(month);
    if (!range) return { taken: 0, pending: 0 };
    const rows = await this.prisma.attendanceDay.findMany({
      where: {
        ...this.leaveRowsWhere(staffId),
        leaveKind: 'casual',
        date: { gte: range.from, lte: range.to },
      },
      select: { dayType: true, leaveKind: true, leaveUnpaid: true, leaveHalf: true, leavePartUnpaid: true },
    });
    const takenHalves = rows.reduce((sum, row) => sum + leaveHalvesOf(row).total, 0);
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
    let pendingHalves = 0;
    for (const request of pendingRequests) {
      const dates = await this.leaveDates(request.fromDate, request.toDate);
      pendingHalves += dates.filter((date) => monthOf(date) === month).length * (isLeaveHalf(request.half) ? 1 : 2);
    }
    return { taken: halvesToDays(takenHalves), pending: halvesToDays(pendingHalves) };
  }

  /**
   * The date of a pending or approved leave request of the person that a new
   * request would cover again, or null. A full day clashes with any leave on
   * the date; a half day with a full day or the same half. The other half of a
   * date is free, as long as it is the same kind of leave (one date carries one
   * kind): the two halves then make a full leave day.
   */
  async findOverlap(
    staffId: string,
    dates: Date[],
    half: LeaveHalf | null,
    kind: string,
    excludeRequestId?: string,
  ): Promise<{ date: string; reason: 'covered' | 'other_kind' } | null> {
    if (!dates.length) return null;
    const first = dates[0];
    const last = dates[dates.length - 1];
    const others = await this.prisma.leaveRequest.findMany({
      where: {
        staffId,
        status: { in: ['pending', 'approved'] },
        fromDate: { lte: last },
        toDate: { gte: first },
        ...(excludeRequestId ? { id: { not: excludeRequestId } } : {}),
      },
    });
    for (const date of dates) {
      for (const other of others) {
        // An approval of part of the dates covers only those dates.
        const from = other.status === 'approved' && other.approvedFromDate ? other.approvedFromDate : other.fromDate;
        const to = other.status === 'approved' && other.approvedToDate ? other.approvedToDate : other.toDate;
        if (date.getTime() < from.getTime() || date.getTime() > to.getTime()) continue;
        const otherHalf = isLeaveHalf(other.half) ? other.half : null;
        const label = date.toISOString().slice(0, 10);
        if (!half || !otherHalf || otherHalf === half) return { date: label, reason: 'covered' };
        if (other.kind !== kind) return { date: label, reason: 'other_kind' };
      }
    }
    return null;
  }

  /**
   * Runs `work` in a transaction under the person's leave lock (a Postgres
   * advisory transaction lock, as payroll and payments use): two approvals for
   * the same person never read the same balance or write the same day at once.
   */
  private async underLeaveLock<T>(staffId: string, work: (tx: Prisma.TransactionClient) => Promise<T>): Promise<T> {
    return this.prisma.$transaction(
      async (tx) => {
        await tx.$executeRaw(Prisma.sql`SELECT pg_advisory_xact_lock(hashtext(${`leave:${staffId}`}))`);
        return work(tx);
      },
      { timeout: 30_000, maxWait: 30_000 },
    );
  }

  /** Earned paid leave in halves, and paid halves already used, read inside the lock. */
  private async paidLeftHalves(tx: Prisma.TransactionClient, staffId: string, kind: LeaveKind): Promise<number> {
    const earned = await this.earnedHalves(staffId, kind);
    const rows = await tx.attendanceDay.findMany({
      where: { ...this.leaveRowsWhere(staffId), leaveKind: kind },
      select: { dayType: true, leaveKind: true, leaveUnpaid: true, leaveHalf: true, leavePartUnpaid: true },
    });
    return Math.max(0, earned - rows.reduce((sum, row) => sum + leaveHalvesOf(row).paid, 0));
  }

  /**
   * Marks one date of an approved request as leave, inside the lock.
   * - a full day: not on a day worked, nor on a day already carrying leave;
   * - a half day: also on a day worked (the other half is a working half day);
   *   on a day whose other half is already a half day of leave of the same
   *   kind, the two make one full leave day (`otherLeaveRequestId`).
   * Returns the half days it wrote (0 when nothing was written).
   */
  private async markDay(
    tx: Prisma.TransactionClient,
    request: LeaveRequest,
    date: Date,
    paidLeft: number,
  ): Promise<{ written: number; paid: number; dayId: string | null }> {
    const half = isLeaveHalf(request.half) ? request.half : null;
    const existing = await tx.attendanceDay.findUnique({
      where: { staffId_date: { staffId: request.staffId, date } },
    });
    const carried = existing ? leaveHalvesOf(existing) : { total: 0, paid: 0, unpaid: 0 };
    if (
      half &&
      existing &&
      carried.total === 1 &&
      existing.leaveHalf &&
      existing.leaveHalf !== half &&
      existing.leaveKind === request.kind &&
      existing.leaveRequestId !== request.id &&
      !existing.otherLeaveRequestId
    ) {
      // The other half is already leave: one full leave day of the two requests.
      // A day still open (logged in now) stays open; it becomes leave when it closes.
      const paid = Math.min(1, paidLeft);
      const open = Boolean(existing.loginAt && !existing.logoutAt);
      await tx.attendanceDay.update({
        where: { id: existing.id },
        data: {
          ...(open ? {} : { dayType: 'leave', closedReason: existing.loginAt ? existing.closedReason : null }),
          otherLeaveRequestId: request.id,
          ...leaveFieldsFor(2, carried.paid + paid, null),
        },
      });
      return { written: 1, paid, dayId: existing.id };
    }
    if (carried.total > 0) return { written: 0, paid: 0, dayId: null };
    if (!half && existing?.loginAt) return { written: 0, paid: 0, dayId: null };
    const unit: 1 | 2 = half ? 1 : 2;
    const paid = Math.min(unit, paidLeft);
    const worked = Boolean(half && existing?.loginAt);
    const data = {
      ...(worked ? {} : { dayType: 'leave', closedReason: null }),
      leaveKind: request.kind,
      leaveRequestId: request.id,
      otherLeaveRequestId: null,
      ...leaveFieldsFor(unit, paid, half),
    };
    if (existing) {
      await tx.attendanceDay.update({ where: { id: existing.id }, data });
      return { written: unit, paid, dayId: worked ? existing.id : null };
    }
    await tx.attendanceDay.create({ data: { staffId: request.staffId, date, ...data } });
    return { written: unit, paid, dayId: null };
  }

  /**
   * Writes the leave days of an approved request. Days the person worked are
   * left alone. The first days up to the paid balance are paid; the rest are
   * unpaid leave (nothing is ever blocked). Counted in half days: a full day
   * with only half a day of balance left is half paid, half unpaid.
   *
   * A half day of leave marks its one date even when the person has logged in
   * that day (the other half is a working half day): a closed day is worked
   * out again with half the production needed, and lateness counts from the
   * middle of the shift when the first half is on leave. Runs in a transaction
   * under the person's leave lock, so the balance read and the days written
   * can't interleave with another approval.
   */
  async applyApproval(request: LeaveRequest): Promise<{ paidDays: number; unpaidDays: number }> {
    const kind: LeaveKind = request.kind === 'emergency' ? 'emergency' : 'casual';
    const dates = await this.leaveDates(request.fromDate, request.toDate);
    await this.ensureAccrued(request.staffId);
    const { paidHalves, unpaidHalves, worked } = await this.underLeaveLock(request.staffId, async (tx) => {
      let left = await this.paidLeftHalves(tx, request.staffId, kind);
      let paidHalves = 0;
      let unpaidHalves = 0;
      const worked: string[] = [];
      for (const date of dates) {
        const result = await this.markDay(tx, request, date, left);
        left -= result.paid;
        paidHalves += result.paid;
        unpaidHalves += result.written - result.paid;
        if (result.dayId) worked.push(result.dayId);
      }
      return { paidHalves, unpaidHalves, worked };
    });
    for (const dayId of worked) await this.reclassifyWorkedDay(dayId);
    return { paidDays: halvesToDays(paidHalves), unpaidDays: halvesToDays(unpaidHalves) };
  }

  /**
   * Marks one date of an approved request as (unpaid) leave again after a
   * holiday on it was removed; the caller works the request's split out again
   * with `reallocate`. Merges with the other half like an approval.
   */
  async markHolidayRemoved(request: LeaveRequest, date: Date): Promise<void> {
    const result = await this.underLeaveLock(request.staffId, (tx) => this.markDay(tx, request, date, 0));
    if (result.dayId) await this.reclassifyWorkedDay(result.dayId);
  }

  /** The half days of a leave day that belong to a request, and how many of those are paid. */
  private shareOf(
    row: { dayType: string; leaveKind: string | null; leaveUnpaid: boolean; leaveHalf: string | null; leavePartUnpaid: boolean; leaveRequestId: string | null; otherLeaveRequestId: string | null },
    requestId: string,
  ): { halves: number; paid: number } {
    const all = leaveHalvesOf(row);
    if (!row.otherLeaveRequestId) return row.leaveRequestId === requestId ? { halves: all.total, paid: all.paid } : { halves: 0, paid: 0 };
    // Two half days on one date: an unpaid half is counted against the half approved second.
    if (row.leaveRequestId === requestId) return { halves: 1, paid: row.leaveUnpaid ? 0 : 1 };
    if (row.otherLeaveRequestId === requestId) return { halves: 1, paid: row.leaveUnpaid || row.leavePartUnpaid ? 0 : 1 };
    return { halves: 0, paid: 0 };
  }

  /**
   * Works out again which leave days of a request are paid, after its days
   * changed (a holiday added or removed). Days in date order are paid while
   * the balance, not counting this request, lasts; the rest are unpaid.
   */
  async reallocate(requestId: string): Promise<{ paidDays: number; unpaidDays: number }> {
    const request = await this.prisma.leaveRequest.findUniqueOrThrow({ where: { id: requestId } });
    const kind: LeaveKind = request.kind === 'emergency' ? 'emergency' : 'casual';
    const earned = await this.earnedHalves(request.staffId, kind);
    const result = await this.underLeaveLock(request.staffId, async (tx) => {
      const all = await tx.attendanceDay.findMany({
        where: { ...this.leaveRowsWhere(request.staffId), leaveKind: request.kind },
        orderBy: { date: 'asc' },
      });
      const mine = all.filter((row) => this.shareOf(row, requestId).halves > 0);
      // Paid elsewhere: every other leave day, and the other request's half of a shared day.
      let paidElsewhere = 0;
      for (const row of all) {
        const halves = leaveHalvesOf(row);
        paidElsewhere += halves.paid - this.shareOf(row, requestId).paid;
      }
      const units = mine.map((row) => this.shareOf(row, requestId).halves);
      const split = splitPaid(Math.max(0, earned - paidElsewhere), units);
      for (const [index, row] of mine.entries()) {
        const myPaid = split.perDay[index].paid;
        let fields;
        if (row.otherLeaveRequestId) {
          const theirs = this.shareOf(row, row.leaveRequestId === requestId ? row.otherLeaveRequestId : (row.leaveRequestId ?? '')).paid;
          fields = leaveFieldsFor(2, myPaid + theirs, null);
        } else {
          fields = leaveFieldsFor(units[index] as 1 | 2, myPaid, isLeaveHalf(row.leaveHalf) ? row.leaveHalf : null);
        }
        if (row.leaveUnpaid !== fields.leaveUnpaid || row.leavePartUnpaid !== fields.leavePartUnpaid) {
          await tx.attendanceDay.update({
            where: { id: row.id },
            data: { leaveUnpaid: fields.leaveUnpaid, leavePartUnpaid: fields.leavePartUnpaid },
          });
        }
      }
      const out = { paidDays: halvesToDays(split.paidHalves), unpaidDays: halvesToDays(split.unpaidHalves) };
      await tx.leaveRequest.update({ where: { id: requestId }, data: out });
      return out;
    });
    return result;
  }

  /**
   * Takes the leave days of a request off the record (an approval overturned).
   * A past day goes back to absent; a future day is removed. A half day of
   * leave on a day the person worked keeps the day and loses the leave: it is
   * worked out again as a normal day (lateness too). A full day made of two
   * half days goes back to the other request's half day.
   */
  async undoApproval(request: LeaveRequest): Promise<void> {
    const today = this.todayIst();
    const { reclassify, others } = await this.underLeaveLock(request.staffId, async (tx) => {
      const rows = await tx.attendanceDay.findMany({
        where: {
          OR: [
            { leaveRequestId: request.id, OR: [{ dayType: 'leave', loginAt: null }, { leaveHalf: { not: null } }, { otherLeaveRequestId: { not: null } }] },
            { otherLeaveRequestId: request.id },
          ],
        },
      });
      const reclassify: string[] = [];
      const others = new Set<string>();
      for (const row of rows) {
        if (row.otherLeaveRequestId) {
          // Back to the other request's half day (paid or not is worked out again below).
          const remaining = row.leaveRequestId === request.id ? row.otherLeaveRequestId : row.leaveRequestId;
          const remainingRequest = remaining ? await tx.leaveRequest.findUnique({ where: { id: remaining } }) : null;
          const half = remainingRequest && isLeaveHalf(remainingRequest.half) ? remainingRequest.half : null;
          if (!remainingRequest || !half) {
            await tx.attendanceDay.update({ where: { id: row.id }, data: NO_LEAVE });
            continue;
          }
          await tx.attendanceDay.update({
            where: { id: row.id },
            data: {
              ...(row.loginAt ? { dayType: 'open' } : {}),
              leaveRequestId: remainingRequest.id,
              otherLeaveRequestId: null,
              leaveKind: remainingRequest.kind,
              ...leaveFieldsFor(1, 1, half),
            },
          });
          others.add(remainingRequest.id);
          if (row.loginAt) reclassify.push(row.id);
        } else if (row.loginAt) {
          await tx.attendanceDay.update({ where: { id: row.id }, data: NO_LEAVE });
          reclassify.push(row.id);
        } else if (row.date.getTime() < today.getTime()) {
          await tx.attendanceDay.update({
            where: { id: row.id },
            data: { dayType: 'absent', closedReason: 'no_login', ...NO_LEAVE },
          });
        } else {
          await tx.attendanceDay.delete({ where: { id: row.id } });
        }
      }
      return { reclassify, others };
    });
    for (const dayId of reclassify) await this.reclassifyWorkedDay(dayId);
    for (const id of others) await this.reallocate(id);
  }

  /**
   * A working day gets its day type and lateness again, after its half day of
   * leave was added or taken away (half the production is needed on a half
   * day of leave; lateness counts from mid-shift when the first half is on
   * leave). A closed day a Team Lead or Manager changed keeps their change,
   * as in AttendanceService.recalculateDay; an open day only gets its lateness.
   */
  async reclassifyWorkedDay(dayId: string): Promise<void> {
    const day = await this.prisma.attendanceDay.findUnique({ where: { id: dayId } });
    if (!day?.loginAt) return;
    const policy = await this.pricing.current();
    const leaveHalf = day.leaveHalf && day.leaveKind ? day.leaveHalf : null;
    const lateMinutes = lateMinutesFor(day.loginAt, policy, leaveHalf);
    if (!day.logoutAt) {
      await this.prisma.attendanceDay.update({ where: { id: dayId }, data: { lateMinutes } });
      return;
    }
    const result = classifyDay(day.productionSeconds, policy, await this.workingDays.isNonWorking(day.date), Boolean(leaveHalf));
    const changed = Boolean(day.dayTypeChangedAt);
    // Two half days of leave on the date: a full leave day, whatever was worked.
    const fullLeave = Boolean(day.otherLeaveRequestId && day.leaveKind);
    await this.prisma.attendanceDay.update({
      where: { id: dayId },
      data: {
        lateMinutes,
        dayType: fullLeave ? 'leave' : changed ? day.dayType : result.dayType,
        shortfallSeconds: changed ? 0 : result.shortfallSeconds,
        makeUpSeconds: changed && day.dayType === 'half' ? 0 : result.makeUpSeconds,
      },
    });
  }
}
