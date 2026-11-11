import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.service';
import { PricingService } from '../pricing/pricing.service';
import { isWeeklyOff } from './day-rules';

const DAY_MS = 24 * 3600 * 1000;

export type NonWorkingReason = 'weekly_off' | 'holiday';

export interface WorkingCalendar {
  workingDates: Date[];
  weeklyOffs: Date[];
  holidays: Array<{ date: Date; name: string }>;
}

/**
 * The one place that says whether a date is a working day. A weekly day off
 * (Settings `weeklyOffDays`) and a public holiday (the CEO's holiday list)
 * behave the same: never absent, not a leave day, time worked on them is
 * make-up, and they are left out of pace and the month's working days.
 * Dates are IST calendar dates stored at UTC midnight.
 */
@Injectable()
export class WorkingDaysService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly pricing: PricingService,
  ) {}

  async reasonFor(date: Date): Promise<NonWorkingReason | null> {
    const policy = await this.pricing.current();
    if (isWeeklyOff(date, policy.weeklyOffDays)) return 'weekly_off';
    const holiday = await this.prisma.holiday.findUnique({ where: { date }, select: { id: true } });
    return holiday ? 'holiday' : null;
  }

  async isNonWorking(date: Date): Promise<boolean> {
    return (await this.reasonFor(date)) !== null;
  }

  /** Every date from..to (inclusive), sorted into working days, weekly offs and holidays. */
  async calendar(from: Date, to: Date): Promise<WorkingCalendar> {
    const policy = await this.pricing.current();
    const holidays = await this.prisma.holiday.findMany({
      where: { date: { gte: from, lte: to } },
      orderBy: { date: 'asc' },
    });
    const holidayDays = new Set(holidays.map((row) => row.date.getTime()));
    const result: WorkingCalendar = { workingDates: [], weeklyOffs: [], holidays: [] };
    for (let at = from.getTime(); at <= to.getTime(); at += DAY_MS) {
      const date = new Date(at);
      if (isWeeklyOff(date, policy.weeklyOffDays)) result.weeklyOffs.push(date);
      else if (!holidayDays.has(at)) result.workingDates.push(date);
    }
    result.holidays = holidays
      .filter((row) => !isWeeklyOff(row.date, policy.weeklyOffDays))
      .map((row) => ({ date: row.date, name: row.name }));
    return result;
  }
}
