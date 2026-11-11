import { BadRequestException, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../common/prisma/prisma.service';
import { PricingService } from '../pricing/pricing.service';
import { ReportingScopeService } from '../staff/reporting-scope.service';
import { primaryJobSeekerTrade } from '../job-seeker/job-seeker-legacy-read';
import { DAYS_TO_FIRST_INTERVIEW_ALERT_DAYS, LIVE_REFUND_STATUSES } from './growth.constants';
import { staffScopeFor } from './growth-scope';

const DAY_MS = 24 * 60 * 60 * 1000;

export interface WaitingSeekerRow {
  jobSeekerId: string;
  code: string;
  firstName: string;
  trade: string | null;
  locality: string | null;
  status: string;
  paidAt: string;
  daysSincePaid: number;
  daysLeftOnGuarantee: number;
  registeredBy: { id: string; code: string; name: string } | null;
}

export interface DaysToFirstInterviewList {
  asOf: string;
  minDays: number;
  total: number;
  rows: WaitingSeekerRow[];
}

export interface DaysToFirstInterviewSummary {
  asOf: string;
  minDays: number;
  /** The Command Center number: paid job seekers with no interview booked minDays or more after paying. */
  waitingCount: number;
  /** Every paid job seeker still waiting for a first interview, whatever the day. */
  waitingAnyDays: number;
  oldestDays: number | null;
}

/**
 * N2 "Days to first interview" (confirmed 11 Nov). For every paid job seeker in his
 * current 30-day guarantee: the days since the ₹499 was received with no interview
 * booked since. The early warning for a refund — it shows on day 10, the
 * close-to-refund list only on day 15. Counts only, never money.
 *
 * "Interview booked" is any interview proposed after he paid, whatever happened to it,
 * except one that was cancelled.
 */
@Injectable()
export class DaysToFirstInterviewService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly pricingService: PricingService,
    private readonly reportingScope: ReportingScopeService,
  ) {}

  parseMinDays(value?: string): number {
    if (value === undefined || value === '') return DAYS_TO_FIRST_INTERVIEW_ALERT_DAYS;
    const parsed = Number(value);
    if (!Number.isInteger(parsed) || parsed < 0 || parsed > 365) {
      throw new BadRequestException('minDays must be a whole number of days between 0 and 365');
    }
    return parsed;
  }

  async list(
    actor: { id: string; role: string },
    minDays: number = DAYS_TO_FIRST_INTERVIEW_ALERT_DAYS,
    now: Date = new Date(),
  ): Promise<DaysToFirstInterviewList> {
    const waiting = await this.waiting(actor, now);
    const rows = waiting.filter((row) => row.daysSincePaid >= minDays);
    return { asOf: now.toISOString(), minDays, total: rows.length, rows };
  }

  async summary(
    actor: { id: string; role: string },
    minDays: number = DAYS_TO_FIRST_INTERVIEW_ALERT_DAYS,
    now: Date = new Date(),
  ): Promise<DaysToFirstInterviewSummary> {
    const waiting = await this.waiting(actor, now);
    return {
      asOf: now.toISOString(),
      minDays,
      waitingCount: waiting.filter((row) => row.daysSincePaid >= minDays).length,
      waitingAnyDays: waiting.length,
      oldestDays: waiting.length ? waiting[0].daysSincePaid : null,
    };
  }

  /** Every paid seeker in scope with no interview since paying, longest wait first. */
  private async waiting(actor: { id: string; role: string }, now: Date): Promise<WaitingSeekerRow[]> {
    const scope = await staffScopeFor(actor, this.reportingScope);
    const policy = await this.pricingService.current();
    const where: Prisma.JobSeekerWhereInput = {
      status: { in: ['active', 'paused'] },
      paymentReceivedAt: { not: null, lte: now },
      anonymisedAt: null,
    };
    if (scope) where.registeredByStaffId = { in: scope };

    const seekers = await this.prisma.jobSeeker.findMany({
      where,
      select: {
        id: true,
        code: true,
        name: true,
        status: true,
        locality: true,
        paymentReceivedAt: true,
        trades: { select: { trade: true, isPrimary: true } },
        registeredBy: { select: { id: true, code: true, name: true } },
      },
    });
    if (seekers.length === 0) return [];
    const ids = seekers.map((s) => s.id);
    const [interviews, refunds] = await Promise.all([
      this.prisma.interview.findMany({
        where: { jobSeekerId: { in: ids }, status: { not: 'cancelled' } },
        select: { jobSeekerId: true, proposedAt: true },
      }),
      this.prisma.payment.findMany({
        where: { type: 'refund', jobSeekerId: { in: ids }, status: { in: [...LIVE_REFUND_STATUSES] } },
        select: { jobSeekerId: true, createdAt: true },
      }),
    ]);

    const rows: WaitingSeekerRow[] = [];
    for (const seeker of seekers) {
      const paidAt = seeker.paymentReceivedAt!;
      if (interviews.some((i) => i.jobSeekerId === seeker.id && i.proposedAt >= paidAt)) continue;
      // Refunded in this guarantee: no longer a paying job seeker waiting for work.
      if (refunds.some((r) => r.jobSeekerId === seeker.id && r.createdAt >= paidAt)) continue;
      const daysSincePaid = Math.floor((now.getTime() - paidAt.getTime()) / DAY_MS);
      rows.push({
        jobSeekerId: seeker.id,
        code: seeker.code,
        firstName: seeker.name.trim().split(/\s+/)[0] ?? '',
        trade: primaryJobSeekerTrade(seeker) ?? null,
        locality: seeker.locality,
        status: seeker.status,
        paidAt: paidAt.toISOString(),
        daysSincePaid,
        daysLeftOnGuarantee: policy.jobSeekerGuaranteeDays - daysSincePaid,
        registeredBy: seeker.registeredBy,
      });
    }
    rows.sort((a, b) => b.daysSincePaid - a.daysSincePaid || a.code.localeCompare(b.code));
    return rows;
  }
}
