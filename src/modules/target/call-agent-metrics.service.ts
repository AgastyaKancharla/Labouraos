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

export interface CallAgentMetricsResult {
  staffId: string;
  staff: {
    id: string;
    code: string;
    name: string;
    role: string;
    area: string | null;
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
  constructor(private readonly prisma: PrismaService) {}

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
        createdAt: {
          gte: startUtc,
          lte: endUtc,
        },
      },
    });

    // 6. Metric 3: Refund Rate on Own Registrations
    // Of job seekers this agent registered whose 30-day deadline has passed, the share that were refunded.
    // Denominator: only candidates whose 30-day deadline has actually passed as of the evaluation date.
    // Evaluation date is 'now' if querying current or future period, or end of month if querying a past period.
    const evaluationDate = now.getTime() < endUtc.getTime() ? now : endUtc;
    const msIn30Days = 30 * 24 * 60 * 60 * 1000;
    const maxPaymentDate = new Date(evaluationDate.getTime() - msIn30Days);

    const maturedCandidates = await this.prisma.jobSeeker.findMany({
      where: {
        registeredByStaffId: effectiveStaffId,
        paymentReceivedAt: {
          not: null,
          lte: maxPaymentDate,
        },
      },
      select: { id: true },
    });

    const maturedCount = maturedCandidates.length;
    let refundedCount = 0;
    let refundRate: number | null = null;

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

    return {
      staffId: staff.id,
      staff: {
        id: staff.id,
        code: staff.code,
        name: staff.name,
        role: staff.role,
        area: staff.area,
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
