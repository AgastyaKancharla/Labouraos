import {
  BadRequestException,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.service';
import { FieldAgentMetricsService } from './field-agent-metrics.service';
import { JwtPayload } from '../../common/auth/jwt-payload.interface';
import {
  DEFAULT_BUSINESS_TIMEZONE,
  getCalendarPartsInTimezone,
  getPeriodBoundaries,
} from '../../common/time/period-boundary';

export interface LeaderboardEntry {
  position: number;
  staffId: string;
  staffCode: string;
  name: string;
  placementsClosed: number;
}

export interface LeaderboardResult {
  period: {
    year: number;
    month: number;
    timezone: string;
    startUtc: string;
    endUtc: string;
  };
  totalParticipants: number;
  leaderboard: LeaderboardEntry[];
}

/**
 * Placements Leaderboard Service
 *
 * SPECIFICATION & GOVERNANCE RULES (Phase 6.7 Task 7):
 *
 * 1. Ranks only field agents who have a placementsClosed target set for that period.
 *    Nobody else appears (no call agents, no un-targeted field agents).
 *    Newly created accounts without a target do not appear at the bottom on day one.
 *
 * 2. Visible to call agents, field agents, Team Leads, Manager and CEO.
 *    Finance is refused (403 Forbidden).
 *
 * 3. Never shows anyone's target — an agent on a pro-rated target would otherwise
 *    look artificially good or bad next to a full-month peer.
 *
 * 4. Deterministic ordering:
 *    - Placements closed, highest first (descending).
 *    - Ties broken by staff code ascending (A→Z), ensuring rank never flips on refresh.
 *
 * 5. Current month by default, with ?year=&month= for historical periods.
 */
@Injectable()
export class LeaderboardService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly fieldAgentMetricsService: FieldAgentMetricsService,
  ) {}

  async getLeaderboard(
    query: { year?: number; month?: number },
    actor: JwtPayload,
    now: Date = new Date(),
  ): Promise<LeaderboardResult> {
    // 1. RBAC Guard: Finance is denied
    if (actor.role === 'finance') {
      throw new ForbiddenException(
        'Access denied: finance cannot access targets or leaderboard',
      );
    }

    // 2. Resolve period boundaries in business timezone
    const timezone = DEFAULT_BUSINESS_TIMEZONE;
    const nowParts = getCalendarPartsInTimezone(now, timezone);
    const targetYear = query.year ?? nowParts.year;
    const targetMonth = query.month ?? nowParts.month;

    if (!Number.isInteger(targetYear) || targetYear < 2020 || targetYear > 2100) {
      throw new BadRequestException('year must be a valid 4-digit integer');
    }
    if (!Number.isInteger(targetMonth) || targetMonth < 1 || targetMonth > 12) {
      throw new BadRequestException('month must be an integer between 1 and 12');
    }

    const period = getPeriodBoundaries(targetYear, targetMonth, timezone);

    // 3. Find all field agents who have a placementsClosed target set for that period
    const targets = await this.prisma.target.findMany({
      where: {
        year: targetYear,
        month: targetMonth,
        placementsClosed: { not: null },
        staff: {
          role: 'field_agent',
        },
      },
      include: {
        staff: true,
      },
    });

    // 4. Compute achieved placementsClosed for each participant
    const entries: {
      staffId: string;
      staffCode: string;
      name: string;
      placementsClosed: number;
    }[] = [];

    for (const tgt of targets) {
      const metrics = await this.fieldAgentMetricsService.getFieldAgentMetrics(
        tgt.staffId,
        targetYear,
        targetMonth,
        actor,
        now,
      );

      entries.push({
        staffId: tgt.staff.id,
        staffCode: tgt.staff.code,
        name: tgt.staff.name,
        placementsClosed: metrics.metrics.placementsClosed,
      });
    }

    // 5. Order: placements closed highest first; ties broken by staff code A→Z
    entries.sort((a, b) => {
      if (b.placementsClosed !== a.placementsClosed) {
        return b.placementsClosed - a.placementsClosed;
      }
      return a.staffCode.localeCompare(b.staffCode);
    });

    // 6. Assign positions (1, 2, 3...)
    const leaderboard: LeaderboardEntry[] = entries.map((entry, index) => ({
      position: index + 1,
      staffId: entry.staffId,
      staffCode: entry.staffCode,
      name: entry.name,
      placementsClosed: entry.placementsClosed,
    }));

    return {
      period: {
        year: targetYear,
        month: targetMonth,
        timezone,
        startUtc: period.startUtc.toISOString(),
        endUtc: period.endUtc.toISOString(),
      },
      totalParticipants: leaderboard.length,
      leaderboard,
    };
  }
}
