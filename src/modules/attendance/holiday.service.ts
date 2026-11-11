import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Holiday } from '@prisma/client';
import { PrismaService } from '../../common/prisma/prisma.service';
import { AuditService } from '../../common/audit/audit.service';
import { AttendanceService } from './attendance.service';
import { AttendanceDaysService } from './attendance-days.service';
import { LeaveService } from './leave.service';
import { WorkingDaysService } from './working-days.service';

interface Actor {
  id: string;
  role: string;
}

interface HolidayInput {
  date?: string;
  name?: string;
}

export interface HolidayView {
  id: string;
  date: string;
  name: string;
  weekday: number;
}

/**
 * Public holidays (owner decision, Master Guide Attendance). The CEO keeps
 * the list per year and can add, change or remove a holiday at any time.
 * A holiday is a paid day off for everyone: never absent, not a leave day,
 * and not a working day. Changing the list works the affected days out again,
 * from the 1st of the current month onward (earlier months are closed).
 */
@Injectable()
export class HolidayService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly attendance: AttendanceService,
    private readonly days: AttendanceDaysService,
    private readonly leave: LeaveService,
    private readonly workingDays: WorkingDaysService,
  ) {}

  async list(yearText?: string): Promise<{ year: number; holidays: HolidayView[] }> {
    const year = yearText ? this.parseYear(yearText) : this.leave.todayIst().getUTCFullYear();
    const rows = await this.prisma.holiday.findMany({
      where: { date: { gte: this.yearStart(year), lte: this.yearEnd(year) } },
      orderBy: { date: 'asc' },
    });
    return { year, holidays: rows.map((row) => this.view(row)) };
  }

  /** Replaces the whole list for one year. */
  async setYear(actor: Actor, yearText: string, body: { holidays?: HolidayInput[] }) {
    const year = this.parseYear(yearText);
    if (!Array.isArray(body?.holidays)) {
      throw new BadRequestException('holidays must be a list of { date, name }');
    }
    const wanted = body.holidays.map((item) => this.parseInput(item));
    const seen = new Set<string>();
    for (const item of wanted) {
      if (item.date.getUTCFullYear() !== year) {
        throw new BadRequestException(`${this.label(item.date)} is not in ${year}`);
      }
      if (seen.has(this.label(item.date))) {
        throw new BadRequestException(`${this.label(item.date)} is listed twice`);
      }
      seen.add(this.label(item.date));
    }
    const existing = await this.prisma.holiday.findMany({
      where: { date: { gte: this.yearStart(year), lte: this.yearEnd(year) } },
    });
    const before = existing.map((row) => ({ date: this.label(row.date), name: row.name }));
    const changed: Date[] = [];
    for (const row of existing) {
      if (!seen.has(this.label(row.date))) {
        await this.prisma.holiday.delete({ where: { id: row.id } });
        changed.push(row.date);
      }
    }
    for (const item of wanted) {
      const found = existing.find((row) => row.date.getTime() === item.date.getTime());
      if (found) {
        if (found.name !== item.name) {
          await this.prisma.holiday.update({
            where: { id: found.id },
            data: { name: item.name, updatedByStaffId: actor.id },
          });
        }
      } else {
        await this.prisma.holiday.create({
          data: { date: item.date, name: item.name, createdByStaffId: actor.id },
        });
        changed.push(item.date);
      }
    }
    await this.audit.log({
      actorId: actor.id,
      action: 'attendance.holidays_set',
      entityType: 'holiday',
      entityCode: String(year),
      before: { holidays: before },
      after: { holidays: wanted.map((item) => ({ date: this.label(item.date), name: item.name })) },
    });
    await this.rework(changed);
    return this.list(String(year));
  }

  async add(actor: Actor, body: HolidayInput): Promise<HolidayView> {
    const item = this.parseInput(body);
    const clash = await this.prisma.holiday.findUnique({ where: { date: item.date } });
    if (clash) throw new ConflictException(`${this.label(item.date)} is already a holiday`);
    const row = await this.prisma.holiday.create({
      data: { date: item.date, name: item.name, createdByStaffId: actor.id },
    });
    await this.audit.log({
      actorId: actor.id,
      action: 'attendance.holiday_added',
      entityType: 'holiday',
      entityCode: this.label(row.date),
      after: { date: this.label(row.date), name: row.name },
    });
    await this.rework([row.date]);
    return this.view(row);
  }

  async update(actor: Actor, id: string, body: HolidayInput): Promise<HolidayView> {
    const row = await this.prisma.holiday.findUnique({ where: { id } });
    if (!row) throw new NotFoundException('Holiday not found');
    const date = body?.date !== undefined ? this.parseDate(body.date) : row.date;
    const name = body?.name !== undefined ? this.parseName(body.name) : row.name;
    if (date.getTime() !== row.date.getTime()) {
      const clash = await this.prisma.holiday.findUnique({ where: { date } });
      if (clash) throw new ConflictException(`${this.label(date)} is already a holiday`);
    }
    const updated = await this.prisma.holiday.update({
      where: { id },
      data: { date, name, updatedByStaffId: actor.id },
    });
    await this.audit.log({
      actorId: actor.id,
      action: 'attendance.holiday_changed',
      entityType: 'holiday',
      entityCode: this.label(updated.date),
      before: { date: this.label(row.date), name: row.name },
      after: { date: this.label(updated.date), name: updated.name },
    });
    if (date.getTime() !== row.date.getTime()) await this.rework([row.date, date]);
    return this.view(updated);
  }

  async remove(actor: Actor, id: string): Promise<{ removed: true }> {
    const row = await this.prisma.holiday.findUnique({ where: { id } });
    if (!row) throw new NotFoundException('Holiday not found');
    await this.prisma.holiday.delete({ where: { id } });
    await this.audit.log({
      actorId: actor.id,
      action: 'attendance.holiday_removed',
      entityType: 'holiday',
      entityCode: this.label(row.date),
      before: { date: this.label(row.date), name: row.name },
    });
    await this.rework([row.date]);
    return { removed: true };
  }

  /** Works out each changed date again; dates before this month are left alone. */
  async rework(dates: Date[]): Promise<void> {
    const today = this.leave.todayIst();
    const monthStart = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), 1));
    for (const date of dates) {
      if (date.getTime() < monthStart.getTime()) continue;
      await this.reworkDate(date, today);
    }
  }

  private async reworkDate(date: Date, today: Date): Promise<void> {
    if (await this.workingDays.isNonWorking(date)) {
      // Now a day off: nobody is absent, and no leave day is used.
      await this.prisma.attendanceDay.deleteMany({
        where: { date, dayType: 'absent', loginAt: null },
      });
      const leaveRows = await this.prisma.attendanceDay.findMany({
        where: { date, dayType: 'leave', loginAt: null },
        select: { id: true, leaveRequestId: true },
      });
      await this.prisma.attendanceDay.deleteMany({
        where: { id: { in: leaveRows.map((row) => row.id) } },
      });
      for (const requestId of new Set(leaveRows.map((row) => row.leaveRequestId))) {
        if (requestId) await this.leave.reallocate(requestId);
      }
    } else {
      // A working day again: approved leave covers it, and a past day with
      // no login and no leave is absent.
      const requests = await this.prisma.leaveRequest.findMany({
        where: { status: 'approved', fromDate: { lte: date }, toDate: { gte: date } },
      });
      for (const request of requests) {
        const existing = await this.prisma.attendanceDay.findUnique({
          where: { staffId_date: { staffId: request.staffId, date } },
        });
        if (existing && (existing.loginAt || existing.dayType === 'leave')) continue;
        const data = {
          dayType: 'leave',
          closedReason: null,
          leaveKind: request.kind,
          leaveUnpaid: true,
          leaveRequestId: request.id,
        };
        if (existing) {
          await this.prisma.attendanceDay.update({ where: { id: existing.id }, data });
        } else {
          await this.prisma.attendanceDay.create({ data: { staffId: request.staffId, date, ...data } });
        }
        await this.leave.reallocate(request.id);
      }
      if (date.getTime() < today.getTime()) {
        await this.days.markAbsentDays(date);
      }
    }
    // Days worked on that date: off (all make-up) or full/half again.
    const worked = await this.prisma.attendanceDay.findMany({
      where: { date, loginAt: { not: null }, logoutAt: { not: null } },
      select: { id: true },
    });
    for (const day of worked) {
      await this.attendance.recalculateDay(day.id);
    }
  }

  private view(row: Holiday): HolidayView {
    return { id: row.id, date: this.label(row.date), name: row.name, weekday: row.date.getUTCDay() };
  }

  private parseInput(item: HolidayInput): { date: Date; name: string } {
    return { date: this.parseDate(item?.date), name: this.parseName(item?.name) };
  }

  private parseName(value: unknown): string {
    const name = String(value ?? '').trim();
    if (!name) throw new BadRequestException('A holiday needs a name');
    if (name.length > 100) throw new BadRequestException('A holiday name is at most 100 characters');
    return name;
  }

  private parseDate(value: unknown): Date {
    const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(value ?? ''));
    if (!match) throw new BadRequestException('date must look like 2027-01-26');
    const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
    if (this.label(date) !== match[0]) throw new BadRequestException('date is not a real date');
    return date;
  }

  private parseYear(value: string): number {
    const year = Number(value);
    if (!Number.isInteger(year) || year < 2020 || year > 2100) {
      throw new BadRequestException('year must look like 2027');
    }
    return year;
  }

  private yearStart(year: number): Date {
    return new Date(Date.UTC(year, 0, 1));
  }

  private yearEnd(year: number): Date {
    return new Date(Date.UTC(year, 11, 31));
  }

  private label(date: Date): string {
    return date.toISOString().slice(0, 10);
  }
}
