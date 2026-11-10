import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.service';
import { JwtPayload } from '../../common/auth/jwt-payload.interface';
import {
  getCalendarPartsInTimezone,
  getPeriodBoundaries,
} from '../../common/time/period-boundary';
import { PricingService } from '../pricing/pricing.service';

export interface CallAgentMetricsResult {
  staffId: string;
  staff: {
    id: string;
    code: string;
    name: string;
    role: string;
    city: string;
  };
  period: {
    year: number;
    month: number;
    timezone: string;
    startUtc: string;
    endUtc: string;
    daysInMonth: number;
  };
  metrics: {
    candidatesActivated: number;
    vacanciesCaptured: number;
    refundRate: number | null;
  };
  details: {
    refundRate: {
      maturedCount: number;
      refundedCount: number;
      rate: number | null;
    };
  };
}

/**
 * Call Agent Performance Metrics Service
 *
 * SPECIFICATION & GOVERNANCE RULES (Phase 6.7 Task 3):
 *
 * Three locked metrics, computed fresh on every request from existing records.
 * Nothing self-reported; no stored aggregate column.
 *
 * 1. Candidates activated:
 *    Job seekers with `registeredByStaffId` = this agent whose ₹499 was received
 *    within the period (paymentReceivedAt in period boundary).
 *
 * 2. Refund rate on own registrations:
 *    Of job seekers this agent registered whose 30-day deadline has passed, the share
 *    that were refunded. A rate (ratio 0.0 to 1.0), not a count — lower is better.
 *    - The denominator is strictly candidates whose deadline has ACTUALLY PASSED
 *      (e.g., a candidate registered 3 days ago cannot yet count for or against the agent).
 *    - Where the denominator is zero, returns null rather than 0.0. An agent with no
 *      matured registrations has no refund rate, and showing 0% would read as perfect performance.
 *
 * 3. Vacancies captured:
 *    Vacancies with `capturedByStaffId` = this agent created within the period
 *    (createdAt in period boundary).
 *
 * PROHIBITED METRICS (CRITICAL ARCHITECTURAL LOCK):
 * --------------------------------------------------
 * Calls dialled and calls connected are STRICTLY NOT metrics and MUST NOT be added.
 * Both are gamed within a fortnight by dialling and hanging up, and neither predicts
 * revenue or successful placements. Performance is measured exclusively by revenue-generating
 * and margin-protecting outcomes.
 */
@Injectable()
export class CallAgentMetricsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly pricingService: PricingService,
  ) {}

  /**
   * Computes Call Agent performance metrics for a specific calendar month.
   *
   * @param staffId Target call agent staff ID
   * @param year Optional calendar year (defaults to current year in staff timezone)
   * @param month Optional calendar month 1-12 (defaults to current month in staff timezone)
   * @param actor Authenticated user context for server-side RBAC scoping
   * @param now Injectable time parameter for deterministic testing and clock-mocking
   */
  async getCallAgentMetrics(
    staffId: string,
    year?: number,
    month?: number,
    actor?: JwtPayload,
    now: Date = new Date(),
  ): Promise<CallAgentMetricsResult> {
    // 1. Resolve target staff member
    const effectiveStaffId = staffId === 'me' && actor ? actor.sub : staffId;

    const staff = await this.prisma.staff.findUnique({
      where: { id: effectiveStaffId },
    });
    if (!staff) {
      throw new NotFoundException(`Staff '${effectiveStaffId}' not found`);
    }

    if (staff.role !== 'call_agent') {
      throw new BadRequestException(
        `Staff '${staff.code}' is a '${staff.role}'. Call agent metrics apply only to role 'call_agent'.`,
      );
    }

    // 2. Server-side RBAC scoping
    if (actor) {
      if (actor.role === 'finance') {
        throw new ForbiddenException('Access denied: finance cannot access targets or performance metrics');
      }
      if (actor.role === 'call_agent' || actor.role === 'field_agent') {
        if (effectiveStaffId !== actor.sub) {
          throw new ForbiddenException('Access denied: can only access your own targets and metrics');
        }
      } else if (actor.role === 'team_lead') {
        if (staff.teamLeadId !== actor.sub) {
          throw new ForbiddenException(
            `Access denied: staff '${staff.code}' is not part of your team`,
          );
        }
      }
      // CEO and Manager have city-wide access (scope: all)
    }

    // 3. Resolve period boundaries in staff's city timezone
    const currentParts = getCalendarPartsInTimezone(now, staff.city);
    const targetYear = year ?? currentParts.year;
    const targetMonth = month ?? currentParts.month;

    if (!Number.isInteger(targetYear) || targetYear < 2020 || targetYear > 2100) {
      throw new BadRequestException('year must be a valid 4-digit integer');
    }
    if (!Number.isInteger(targetMonth) || targetMonth < 1 || targetMonth > 12) {
      throw new BadRequestException('month must be an integer between 1 and 12');
    }

    const period = getPeriodBoundaries(targetYear, targetMonth, staff.city);
    const { startUtc, endUtc } = period;

    // 4. Metric 1: Candidates Activated
    // Job seekers with registeredByStaffId = this agent whose ₹499 was received within the period
    const candidatesActivated = await this.prisma.jobSeeker.count({
      where: {
        registeredByStaffId: effectiveStaffId,
        paymentReceivedAt: {
          not: null,
          gte: startUtc,
          lte: endUtc,
        },
      },
    });

    // 5. Metric 2: Vacancies Captured
    // Vacancies with capturedByStaffId = this agent created within the period
    const vacanciesCaptured = await this.prisma.vacancy.count({
      where: {
        capturedByStaffId: effectiveStaffId,
        // Phase 20 Task 8: only vacancies the contact person confirmed count as captured.
        status: { notIn: ['draft', 'awaiting_confirmation'] },
        createdAt: {
          gte: startUtc,
          lte: endUtc,
        },
      },
    });

    // 6. Metric 3: Refund Rate on Own Registrations
    //
    // PERIOD-SCOPING & 30-DAY LAG (CRITICAL ARCHITECTURAL DESIGN):
    // The denominator is scoped strictly to candidates whose 30-day refund guarantee
    // deadline fell within the evaluation period. Because a candidate's 30-day guarantee
    // deadline is computed as paymentReceivedAt + jobSeekerGuaranteeDays from PricingPolicy,
    // candidates maturing in the period had their payment received between:
    //   startPaymentDate = period.startUtc - 30 days
    //   endPaymentDate = period.endUtc - 30 days
    //
    // DOCUMENTED LAG: This window intentionally lags candidate onboarding by 30 days,
    // so an agent's November refund rate reflects their October registrations whose guarantee
    // matured during November. This is correct and intended: an agent's performance is measured
    // against the monthly cohort of candidates completing their guarantee window, avoiding lifetime
    // cumulative dilution where historical refunds remain in the denominator forever.
    //
    // ZERO-DENOMINATOR RULE: If zero candidates matured (e.g. new agent with no registrations
    // 30 days prior), refundRate returns null rather than 0% (which would read as perfect performance).
    const policy = await this.pricingService.current();
    const guaranteeWindowMs = policy.jobSeekerGuaranteeDays * 24 * 60 * 60 * 1000;
    const startPaymentDate = new Date(startUtc.getTime() - guaranteeWindowMs);
    const endPaymentDate = new Date(endUtc.getTime() - guaranteeWindowMs);
    const nowPaymentDate = new Date(now.getTime() - guaranteeWindowMs);

    // If querying mid-month, a candidate's deadline must have also actually passed as of 'now'
    const maxPaymentDate = now.getTime() < endUtc.getTime() ? nowPaymentDate : endPaymentDate;

    let maturedCount = 0;
    let refundedCount = 0;
    let refundRate: number | null = null;

    if (maxPaymentDate.getTime() >= startPaymentDate.getTime()) {
      const maturedCandidates = await this.prisma.jobSeeker.findMany({
        where: {
          registeredByStaffId: effectiveStaffId,
          paymentReceivedAt: {
            not: null,
            gte: startPaymentDate,
            lte: maxPaymentDate,
          },
        },
        select: { id: true },
      });

      maturedCount = maturedCandidates.length;

      if (maturedCount > 0) {
        const maturedIds = maturedCandidates.map((c) => c.id);
        const refundedPayments = await this.prisma.payment.findMany({
          where: {
            jobSeekerId: { in: maturedIds },
            type: 'refund',
            status: { in: ['pending', 'processing', 'completed', 'succeeded'] },
          },
          select: { jobSeekerId: true },
          distinct: ['jobSeekerId'],
        });

        refundedCount = refundedPayments.length;
        refundRate = refundedCount / maturedCount;
      }
    }

    return {
      staffId: staff.id,
      staff: {
        id: staff.id,
        code: staff.code,
        name: staff.name,
        role: staff.role,
        city: staff.city,
      },
      period: {
        year: targetYear,
        month: targetMonth,
        timezone: period.timezone,
        startUtc: startUtc.toISOString(),
        endUtc: endUtc.toISOString(),
        daysInMonth: period.daysInMonth,
      },
      metrics: {
        candidatesActivated,
        vacanciesCaptured,
        refundRate,
      },
      details: {
        refundRate: {
          maturedCount,
          refundedCount,
          rate: refundRate,
        },
      },
    };
  }
}
