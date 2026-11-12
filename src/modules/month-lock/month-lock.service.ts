import { ForbiddenException, Injectable } from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.service';
import { istMonth } from '../finance/finance-rules';
import { monthLabel } from '../finance/payroll-rules';

/**
 * Month-end close (Phase 22 Part B). After the CEO closes a month on the
 * Month-end review, that month's money records never change (owner decision
 * 11 Nov). Writes to a dated money record ask `assertOpen*` first; money that
 * arrives later for a closed month is booked in the current open month with a
 * note (`bookingFor`).
 */
@Injectable()
export class MonthLockService {
  constructor(private readonly prisma: PrismaService) {}

  async isClosed(month: string): Promise<boolean> {
    const row = await this.prisma.monthClose.findUnique({ where: { month }, select: { status: true } });
    return row?.status === 'closed';
  }

  /** Throws when the month (yyyy-mm) is closed. `what` says what was being changed. */
  async assertOpen(month: string, what: string): Promise<void> {
    if (await this.isClosed(month)) {
      throw new ForbiddenException({
        statusCode: 403,
        error: 'Forbidden',
        code: 'month_closed',
        message: `${monthLabel(month)} is closed, so ${what} can't be changed. Put the correction into an open month with a note, or ask the CEO to reopen ${monthLabel(month)}.`,
      });
    }
  }

  /** The same check for the IST month a date falls in. */
  async assertOpenOn(date: Date, what: string): Promise<void> {
    await this.assertOpen(istMonth(date), what);
  }

  /**
   * Where money dated `date` is booked: on that date, or — when its month is
   * closed — now, in the open month, with a note giving the real date.
   */
  async bookingFor(date: Date, now = new Date()): Promise<{ at: Date; note: string | null }> {
    const month = istMonth(date);
    if (!(await this.isClosed(month))) return { at: date, note: null };
    const day = new Date(date.getTime() + 5.5 * 3600_000).toISOString().slice(0, 10);
    return { at: now, note: `Bank date ${day}: ${monthLabel(month)} is closed, so it is booked in ${monthLabel(istMonth(now))}` };
  }
}
