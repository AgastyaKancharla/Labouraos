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
import { calculateDaysElapsed } from '../placement/placement.service';
import { PricingService } from '../pricing/pricing.service';

export interface FieldAgentMetricsResult {
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
    placementsClosed: number;
    replacementsSecuredInside15Days: number;
    replacementsIn15Days: number; // alias
    repeatBusinesses: number;
  };
  details: {
    placementsClosed: {
      count: number;
      placementCodes: string[];
    };
    replacementsSecuredInside15Days: {
      count: number;
      replacementCandidateIds: string[];
      placementCodes: string[];
    };
    replacementsIn15Days: {
      count: number;
      replacementPlacementCodes: string[];
    };
    repeatBusinesses: {
      count: number;
      businessCodes: string[];
    };
  };
}

/**
 * Field Agent Performance Metrics Service
 *
 * SPECIFICATION & GOVERNANCE RULES (Phase 6.7 Task 4):
 *
 * Three locked metrics, computed fresh on every request from existing records.
 * Nothing self-reported; no stored aggregate column.
 *
 * 1. Placements Closed:
 *    Placements with `createdByStaffId` = this agent where the candidate joined AND
 *    the business paid, within the period.
 *    - PERIOD TIMESTAMP: The closing event occurs when BOTH candidate joined (joinedDate != null)
 *      AND the business placement fee was paid (payment status in completed/succeeded).
 *      The closing timestamp is `max(placement.joinedDate, placementFeePayment.createdAt)`.
 *      A placement whose closing timestamp falls within `[startUtc, endUtc]` counts for this period.
 *    - REVENUE INTEGRITY RULE: Placements closed must require BOTH joined and paid — a candidate
 *      who joined but whose business never paid earned Laboura nothing, so counting it would reward
 *      work that produced no revenue.
 *
 * 2. Replacement Vacancies Filled Inside 15 Days:
 *    Replacement vacancies (those with `replacementForPlacementId` set) filled by a placement
 *    that reached joined, within 15 days of the parent placement's `dropoutReportedAt`.
 *    Attributed to the agent who created the replacement placement (`replacementPlacement.createdByStaffId`).
 *    - PERIOD TIMESTAMP: Scoped by the replacement placement's `joinedDate` falling within `[startUtc, endUtc]`.
 *    - MARGIN PROTECTION: Filling a replacement within 15 days prevents a 100% placement-fee refund.
 *      If filled on day 16 or later (`diffMs > 15 days`), it does NOT count.
 *
 * 3. Repeat Businesses:
 *    Businesses where this agent closed a placement within the period and the business already
 *    had an earlier joined placement.
 *    - PERIOD TIMESTAMP: Evaluates placements closed by this agent during `[startUtc, endUtc]` where
 *      the business had at least one prior placement with `joinedDate < thisPlacement.joinedDate`.
 *    - DISTINCT COUNT: Returns distinct count of retained businesses closed by this agent this period.
 *
 * SALARY-ONLY REMINDER: Field agents are salaried employees/interns (Playbook §7).
 * No commission or variable compensation is computed or awarded.
 */
@Injectable()
export class FieldAgentMetricsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly pricingService: PricingService,
  ) {}

  /**
   * Computes Field Agent performance metrics for a specific calendar month.
   *
   * @param staffId Target field agent staff ID
   * @param year Optional calendar year (defaults to current year in staff timezone)
   * @param month Optional calendar month 1-12 (defaults to current month in staff timezone)
   * @param actor Authenticated user context for server-side RBAC scoping
   * @param now Injectable time parameter for deterministic testing and clock-mocking
   */
  async getFieldAgentMetrics(
    staffId: string,
    year?: number,
    month?: number,
    actor?: JwtPayload,
    now: Date = new Date(),
  ): Promise<FieldAgentMetricsResult> {
    // 1. Resolve target staff member
    const effectiveStaffId = staffId === 'me' && actor ? actor.sub : staffId;

    const staff = await this.prisma.staff.findUnique({
      where: { id: effectiveStaffId },
    });
    if (!staff) {
      throw new NotFoundException(`Staff '${effectiveStaffId}' not found`);
    }

    if (staff.role !== 'field_agent') {
      throw new BadRequestException(
        `Staff '${staff.code}' is a '${staff.role}'. Field agent metrics apply only to role 'field_agent'.`,
      );
    }

    // 2. Server-side RBAC scoping
    if (actor) {
      if (actor.role === 'finance') {
        throw new ForbiddenException('Access denied: finance cannot access targets or performance metrics');
      }
      if (actor.role === 'field_agent' || actor.role === 'call_agent') {
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

    // 4. Metric 1: Placements Closed
    // Placements with createdByStaffId = this agent where the candidate joined AND the business paid,
    // within the period.
    // Fetch placements created by this agent that have reached joinedDate.
    const joinedPlacements = await this.prisma.placement.findMany({
      where: {
        createdByStaffId: effectiveStaffId,
        joinedDate: { not: null },
      },
      include: {
        payments: {
          where: {
            type: 'placement_fee',
            status: { in: ['completed', 'succeeded'] },
          },
          orderBy: { createdAt: 'asc' },
        },
        business: {
          select: { id: true, code: true },
        },
      },
    });

    const closedPlacements: typeof joinedPlacements = [];

    for (const pl of joinedPlacements) {
      if (!pl.joinedDate) continue;
      // Must have at least one successful placement_fee payment
      const qualifyingPayment = pl.payments[0];
      if (!qualifyingPayment) continue;

      // Closing timestamp is when BOTH joined and paid occurred
      const paymentDate = qualifyingPayment.createdAt;
      const closingDate = pl.joinedDate > paymentDate ? pl.joinedDate : paymentDate;

      if (closingDate.getTime() >= startUtc.getTime() && closingDate.getTime() <= endUtc.getTime()) {
        closedPlacements.push(pl);
      }
    }

    const placementsClosedCount = closedPlacements.length;
    const closedPlacementCodes = closedPlacements.map((p) => p.code);

    // 5. Metric 2: Replacements Secured Inside 15 Days
    //
    // CRITICAL ARCHITECTURAL REFACTOR (Phase 6.7 Task 4 Correction):
    // Measures replacement candidates (ReplacementCandidate with status 'accepted') accepted within 15 days
    // of parent placement's dropoutReportedAt.
    //
    // RATIONALE FOR MEASURING ACCEPTANCE OVER JOINING:
    // placement-refund-eligibility.ts blocks the refund when a replacement candidate is ACCEPTED,
    // not when they join. An agent who gets a replacement accepted on day 10 saves the full placement fee
    // for Laboura even if the worker serves notice and joins on day 18. The metric exists to reward
    // margin protection, so it must measure the milestone that legally and operationally saves the margin.
    //
    // SHARED DAYS-ELAPSED LOGIC:
    // Reuses calculateDaysElapsed() from placement.service.ts.
    //
    // PERIOD TIMESTAMP: Scoped by replacementCandidate.acceptedAt falling within [startUtc, endUtc].
    // Null acceptedAt values are honest-null and excluded from metrics.
    const acceptedReplacements = await this.prisma.replacementCandidate.findMany({
      where: {
        status: 'accepted',
        acceptedAt: {
          not: null,
          gte: startUtc,
          lte: endUtc,
        },
        placement: {
          createdByStaffId: effectiveStaffId,
        },
      },
      include: {
        placement: {
          select: {
            id: true,
            code: true,
            dropoutReportedAt: true,
            createdByStaffId: true,
          },
        },
      },
    });

    const eligibleSecuredReplacements: typeof acceptedReplacements = [];
    const policy = await this.pricingService.current();

    for (const rc of acceptedReplacements) {
      const placement = rc.placement;
      if (!placement || !placement.dropoutReportedAt || !rc.acceptedAt) {
        continue;
      }

      const daysElapsed = calculateDaysElapsed(
        placement.dropoutReportedAt,
        rc.acceptedAt,
      );

      if (daysElapsed <= policy.replacementSearchDays) {
        eligibleSecuredReplacements.push(rc);
      }
    }

    const replacementsSecuredCount = eligibleSecuredReplacements.length;
    const replacementCandidateIds = eligibleSecuredReplacements.map((rc) => rc.id);
    const replacementPlacementCodes = eligibleSecuredReplacements.map((rc) => rc.placement.code);

    // 6. Metric 3: Repeat Businesses
    // Businesses where this agent closed a placement within the period and the business already
    // had an earlier joined placement.
    const repeatBusinessCodesSet = new Set<string>();

    for (const pl of closedPlacements) {
      if (!pl.joinedDate || !pl.business) continue;

      // Check if business has any prior placement with joinedDate strictly before this placement's joinedDate
      const priorJoinedPlacement = await this.prisma.placement.findFirst({
        where: {
          businessId: pl.businessId,
          id: { not: pl.id },
          joinedDate: {
            not: null,
            lt: pl.joinedDate,
          },
        },
        select: { id: true },
      });

      if (priorJoinedPlacement) {
        repeatBusinessCodesSet.add(pl.business.code);
      }
    }

    const repeatBusinessesCount = repeatBusinessCodesSet.size;
    const repeatBusinessCodes = Array.from(repeatBusinessCodesSet);

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
        placementsClosed: placementsClosedCount,
        replacementsSecuredInside15Days: replacementsSecuredCount,
        replacementsIn15Days: replacementsSecuredCount,
        repeatBusinesses: repeatBusinessesCount,
      },
      details: {
        placementsClosed: {
          count: placementsClosedCount,
          placementCodes: closedPlacementCodes,
        },
        replacementsSecuredInside15Days: {
          count: replacementsSecuredCount,
          replacementCandidateIds,
          placementCodes: replacementPlacementCodes,
        },
        replacementsIn15Days: {
          count: replacementsSecuredCount,
          replacementPlacementCodes,
        },
        repeatBusinesses: {
          count: repeatBusinessesCount,
          businessCodes: repeatBusinessCodes,
        },
      },
    };
  }
}
