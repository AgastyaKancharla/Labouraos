import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  Optional,
} from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.service';
import { JwtPayload } from '../../common/auth/jwt-payload.interface';
import { Staff } from '@prisma/client';
import { FormattedTargetResponse, TargetService } from './target.service';
import { CallAgentMetricsService } from './call-agent-metrics.service';
import { FieldAgentMetricsService } from './field-agent-metrics.service';
import { MoneyAtRiskResult, MoneyAtRiskService } from './money-at-risk.service';
import { WorkingDaysService } from '../attendance/working-days.service';
import {
  ALL_METRIC_KEYS,
  calculateProRatingFactor,
  evaluateMetricPace,
  evaluateMetricTarget,
  PaceEvaluationResult,
  TargetMetricKey,
} from './target.constants';
import {
  DEFAULT_BUSINESS_TIMEZONE,
  getCalendarPartsInTimezone,
  getPeriodBoundaries,
  getTimezoneForCity,
  isPastPeriod,
} from '../../common/time/period-boundary';

export interface AgentOverview {
  staff: {
    id: string;
    code: string;
    name: string;
    role: string;
    city: string;
    createdAt: Date;
    teamLeadId: string | null;
  };
  target: FormattedTargetResponse | null;
  achieved: {
    candidatesActivated?: number;
    refundRate?: number | null;
    vacanciesCaptured?: number;
    placementsClosed?: number;
    replacementsSecuredInside15Days?: number;
    repeatBusinesses?: number;
    details?: Record<string, unknown>;
  };
  metrics: Record<TargetMetricKey, PaceEvaluationResult>;
  isBehindPace: boolean;
  isBreached: boolean;
}

export interface MetricTotals {
  candidatesActivated: number;
  vacanciesCaptured: number;
  placementsClosed: number;
  replacementsSecuredInside15Days: number;
  replacementsInside15Days: number; // alias
  repeatBusinesses: number;
}

export interface AchievedTotals extends MetricTotals {
  refundRate: number | null;
  refundRateDetails: {
    totalMatured: number;
    totalRefunded: number;
  };
}

export interface TargetOverviewResult {
  scope: 'agent' | 'team' | 'city';
  period: {
    year: number;
    month: number;
    timezone: string;
    startUtc: string;
    endUtc: string;
    daysInMonth: number;
    currentDay: number;
    asOf: string;
  };
  agent?: AgentOverview;
  teamLead?: {
    id: string;
    code: string;
    name: string;
    role: string;
  };
  agents: AgentOverview[];
  teamTotal?: {
    agentsCount: number;
    behindPaceCount: number;
    breachCount: number;
    targets: MetricTotals;
    achieved: AchievedTotals;
  };
  totals?: {
    agentsCount: number;
    behindPaceCount: number;
    breachCount: number;
    targets: MetricTotals;
    achieved: AchievedTotals;
  };
  moneyAtRisk?: MoneyAtRiskResult;
}

/**
 * Target Overview & Behind-Pace Flagging Service
 *
 * SPECIFICATION & GOVERNANCE RULES (Phase 6.7 Task 6):
 *
 * 1. Three visibility levels enforced strictly server-side on every query:
 *    - Agent: their own target, achieved metrics, and money-at-risk list.
 *    - Team Lead: each supervised agent's figures, team totals, behind-pace flags, and team money-at-risk.
 *    - CEO and Manager: all agents, city-wide totals, and city-wide money at risk.
 *    - Finance: Refused with 403 Forbidden on all target endpoints.
 *
 * 2. Behind-pace flagging:
 *    - Fires mid-month from day 8 onward (BEHIND_PACE_START_DAY = 8) in the business timezone.
 *    - Applies ONLY to higher_is_better metrics (volume & margin floors).
 *    - Target scaled by days elapsed: expectedPace = effectiveTarget * (daysElapsed / daysInPeriod).
 *    - For mid-month joiners, counts days from their creation day matching calculateProRatingFactor.
 *    - Flagged if achieved < (BEHIND_PACE_THRESHOLD * expectedPace), where BEHIND_PACE_THRESHOLD = 0.8.
 *    - Status 'not_targeted' or 'not_measured' is never flagged.
 *
 * 3. Refund rate breach flag:
 *    - Fires only when actual rate > target AND matured denominator >= MIN_REFUND_RATE_DENOMINATOR (5).
 *    - Zero denominator has no rate and is never flagged.
 *
 * 4. Reuses CallAgentMetricsService, FieldAgentMetricsService and MoneyAtRiskService.
 *    Never duplicates calculation logic or stores aggregate columns.
 */
@Injectable()
export class TargetOverviewService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly targetService: TargetService,
    private readonly callAgentMetricsService: CallAgentMetricsService,
    private readonly fieldAgentMetricsService: FieldAgentMetricsService,
    private readonly moneyAtRiskService: MoneyAtRiskService,
    @Optional() private readonly workingDays?: WorkingDaysService,
  ) {}

  async getOverview(
    params: { staffId?: string; year?: number; month?: number },
    actor: JwtPayload,
    now: Date = new Date(),
  ): Promise<TargetOverviewResult> {
    // 1. RBAC Guard: Finance is completely denied access to targets
    if (actor.role === 'finance') {
      throw new ForbiddenException(
        'Access denied: finance cannot access targets or performance metrics',
      );
    }

    // 2. Resolve actor staff record to determine timezone / city
    const actorStaff = await this.prisma.staff.findUnique({
      where: { id: actor.sub },
    });
    if (!actorStaff) {
      throw new NotFoundException(`Staff '${actor.sub}' not found`);
    }

    const timezone = getTimezoneForCity(actorStaff.city || DEFAULT_BUSINESS_TIMEZONE);
    const nowParts = getCalendarPartsInTimezone(now, timezone);
    const targetYear = params.year ?? nowParts.year;
    const targetMonth = params.month ?? nowParts.month;

    if (!Number.isInteger(targetYear) || targetYear < 2020 || targetYear > 2100) {
      throw new BadRequestException('year must be a valid 4-digit integer');
    }
    if (!Number.isInteger(targetMonth) || targetMonth < 1 || targetMonth > 12) {
      throw new BadRequestException('month must be an integer between 1 and 12');
    }

    const periodBoundaries = getPeriodBoundaries(targetYear, targetMonth, timezone);

    // 3. Dispatch based on visibility level
    if (actor.role === 'call_agent' || actor.role === 'field_agent') {
      if (params.staffId && params.staffId !== actor.sub) {
        throw new ForbiddenException('Access denied: can only access your own targets');
      }
      return this.getAgentOverview(actorStaff, targetYear, targetMonth, periodBoundaries, actor, now);
    }

    if (actor.role === 'team_lead') {
      return this.getTeamLeadOverview(
        actorStaff,
        params.staffId,
        targetYear,
        targetMonth,
        periodBoundaries,
        actor,
        now,
      );
    }

    // CEO and Manager
    return this.getManagementOverview(
      params.staffId,
      targetYear,
      targetMonth,
      periodBoundaries,
      actor,
      now,
    );
  }

  /**
   * Builds single agent overview for Call Agent or Field Agent
   */
  private async getAgentOverview(
    staff: Staff,
    year: number,
    month: number,
    period: ReturnType<typeof getPeriodBoundaries>,
    actor: JwtPayload,
    now: Date,
  ): Promise<TargetOverviewResult> {
    const agentOverview = await this.buildSingleAgentOverview(staff, year, month, period, actor, now);
    const moneyAtRisk = await this.moneyAtRiskService.getMoneyAtRisk(staff.id, actor, now);

    const timezone = period.timezone;
    const nowParts = getCalendarPartsInTimezone(now, timezone);
    let currentDay = 0;
    if (nowParts.year === year && nowParts.month === month) {
      currentDay = nowParts.day;
    } else if (isPastPeriod(year, month, now, timezone)) {
      currentDay = period.daysInMonth;
    }

    return {
      scope: 'agent',
      period: {
        year,
        month,
        timezone,
        startUtc: period.startUtc.toISOString(),
        endUtc: period.endUtc.toISOString(),
        daysInMonth: period.daysInMonth,
        currentDay,
        asOf: now.toISOString(),
      },
      agent: agentOverview,
      agents: [agentOverview],
      moneyAtRisk,
    };
  }

  /**
   * Builds Team Lead view: supervised agents, team aggregate totals, team money at risk
   */
  private async getTeamLeadOverview(
    teamLeadStaff: Staff,
    targetStaffId: string | undefined,
    year: number,
    month: number,
    period: ReturnType<typeof getPeriodBoundaries>,
    actor: JwtPayload,
    now: Date,
  ): Promise<TargetOverviewResult> {
    const timezone = period.timezone;
    const nowParts = getCalendarPartsInTimezone(now, timezone);
    let currentDay = 0;
    if (nowParts.year === year && nowParts.month === month) {
      currentDay = nowParts.day;
    } else if (isPastPeriod(year, month, now, timezone)) {
      currentDay = period.daysInMonth;
    }

    // If specific staffId requested, verify they belong to this team
    if (targetStaffId) {
      const staff = await this.prisma.staff.findUnique({
        where: { id: targetStaffId },
      });
      if (!staff || staff.teamLeadId !== actor.sub) {
        throw new ForbiddenException(
          `Access denied: staff '${targetStaffId}' is not part of your team`,
        );
      }
      const agentOverview = await this.buildSingleAgentOverview(staff, year, month, period, actor, now);
      const moneyAtRisk = await this.moneyAtRiskService.getMoneyAtRisk(staff.id, actor, now);

      return {
        scope: 'agent',
        period: {
          year,
          month,
          timezone,
          startUtc: period.startUtc.toISOString(),
          endUtc: period.endUtc.toISOString(),
          daysInMonth: period.daysInMonth,
          currentDay,
          asOf: now.toISOString(),
        },
        teamLead: {
          id: teamLeadStaff.id,
          code: teamLeadStaff.code,
          name: teamLeadStaff.name,
          role: teamLeadStaff.role,
        },
        agent: agentOverview,
        agents: [agentOverview],
        moneyAtRisk,
      };
    }

    // Fetch all team agents
    const teamAgents = await this.prisma.staff.findMany({
      where: {
        teamLeadId: actor.sub,
        role: { in: ['call_agent', 'field_agent'] },
      },
      orderBy: { code: 'asc' },
    });

    const agents: AgentOverview[] = [];
    for (const agentStaff of teamAgents) {
      const overview = await this.buildSingleAgentOverview(agentStaff, year, month, period, actor, now);
      agents.push(overview);
    }

    const teamTotal = this.computeAggregates(agents);
    const moneyAtRisk = await this.moneyAtRiskService.getMoneyAtRisk(undefined, actor, now);

    return {
      scope: 'team',
      period: {
        year,
        month,
        timezone,
        startUtc: period.startUtc.toISOString(),
        endUtc: period.endUtc.toISOString(),
        daysInMonth: period.daysInMonth,
        currentDay,
        asOf: now.toISOString(),
      },
      teamLead: {
        id: teamLeadStaff.id,
        code: teamLeadStaff.code,
        name: teamLeadStaff.name,
        role: teamLeadStaff.role,
      },
      agents,
      teamTotal,
      moneyAtRisk,
    };
  }

  /**
   * Builds CEO / Manager view: all agents or specific agent, city-wide totals, city money at risk
   */
  private async getManagementOverview(
    targetStaffId: string | undefined,
    year: number,
    month: number,
    period: ReturnType<typeof getPeriodBoundaries>,
    actor: JwtPayload,
    now: Date,
  ): Promise<TargetOverviewResult> {
    const timezone = period.timezone;
    const nowParts = getCalendarPartsInTimezone(now, timezone);
    let currentDay = 0;
    if (nowParts.year === year && nowParts.month === month) {
      currentDay = nowParts.day;
    } else if (isPastPeriod(year, month, now, timezone)) {
      currentDay = period.daysInMonth;
    }

    if (targetStaffId) {
      const staff = await this.prisma.staff.findUnique({
        where: { id: targetStaffId },
      });
      if (!staff) {
        throw new NotFoundException(`Staff '${targetStaffId}' not found`);
      }
      const agentOverview = await this.buildSingleAgentOverview(staff, year, month, period, actor, now);
      const moneyAtRisk = await this.moneyAtRiskService.getMoneyAtRisk(staff.id, actor, now);

      return {
        scope: 'agent',
        period: {
          year,
          month,
          timezone,
          startUtc: period.startUtc.toISOString(),
          endUtc: period.endUtc.toISOString(),
          daysInMonth: period.daysInMonth,
          currentDay,
          asOf: now.toISOString(),
        },
        agent: agentOverview,
        agents: [agentOverview],
        moneyAtRisk,
      };
    }

    // City-wide agents
    const allAgents = await this.prisma.staff.findMany({
      where: {
        role: { in: ['call_agent', 'field_agent'] },
      },
      orderBy: { code: 'asc' },
    });

    const agents: AgentOverview[] = [];
    for (const agentStaff of allAgents) {
      const overview = await this.buildSingleAgentOverview(agentStaff, year, month, period, actor, now);
      agents.push(overview);
    }

    const totals = this.computeAggregates(agents);
    const moneyAtRisk = await this.moneyAtRiskService.getMoneyAtRisk(undefined, actor, now);

    return {
      scope: 'city',
      period: {
        year,
        month,
        timezone,
        startUtc: period.startUtc.toISOString(),
        endUtc: period.endUtc.toISOString(),
        daysInMonth: period.daysInMonth,
        currentDay,
        asOf: now.toISOString(),
      },
      agents,
      totals,
      moneyAtRisk,
    };
  }

  /**
   * Builds single agent overview combining Target pro-rating, achieved metrics,
   * pacing evaluation, and breach flags.
   */
  async buildSingleAgentOverview(
    staff: Staff,
    year: number,
    month: number,
    period: ReturnType<typeof getPeriodBoundaries>,
    actor: JwtPayload,
    now: Date,
  ): Promise<AgentOverview> {
    // 1. Fetch Target for this agent & period
    const targetRecord = await this.prisma.target.findUnique({
      where: {
        staffId_year_month: {
          staffId: staff.id,
          year,
          month,
        },
      },
      include: { staff: true },
    });

    const formattedTarget = targetRecord
      ? this.targetService.formatTargetResponse(targetRecord)
      : null;

    // 2. Fetch achieved metrics using respective service
    let achieved: Record<string, number | null | undefined> = {};
    let details: Record<string, unknown> = {};

    if (staff.role === 'call_agent') {
      const res = await this.callAgentMetricsService.getCallAgentMetrics(
        staff.id,
        year,
        month,
        actor,
        now,
      );
      achieved = res.metrics;
      details = res.details;
    } else if (staff.role === 'field_agent') {
      const res = await this.fieldAgentMetricsService.getFieldAgentMetrics(
        staff.id,
        year,
        month,
        actor,
        now,
      );
      achieved = res.metrics;
      details = res.details;
    }

    // 3. Pro-rating and pacing calculations in business timezone
    const timezone = period.timezone;
    const nowParts = getCalendarPartsInTimezone(now, timezone);
    let currentDay = 0;
    if (nowParts.year === year && nowParts.month === month) {
      currentDay = nowParts.day;
    } else if (isPastPeriod(year, month, now, timezone)) {
      currentDay = period.daysInMonth;
    }

    const { daysInMonth, factor } = calculateProRatingFactor(
      staff.createdAt,
      year,
      month,
      timezone,
    );

    const createdParts = getCalendarPartsInTimezone(staff.createdAt, timezone);
    const startDay =
      createdParts.year === year && createdParts.month === month
        ? createdParts.day
        : 1;

    let daysInPeriod = Math.max(0, daysInMonth - startDay + 1);
    let daysElapsed = Math.min(daysInPeriod, Math.max(0, currentDay - startDay + 1));
    // Pace counts working days only: weekly days off and public holidays are
    // left out (Master Guide, Attendance: holidays and weekly offs behave the same).
    if (this.workingDays && daysInPeriod > 0) {
      const calendar = await this.workingDays.calendar(
        new Date(Date.UTC(year, month - 1, startDay)),
        new Date(Date.UTC(year, month - 1, daysInMonth)),
      );
      const working = calendar.workingDates.map((date) => date.getUTCDate());
      daysInPeriod = working.length;
      daysElapsed = working.filter((day) => day <= currentDay).length;
    }

    // 4. Evaluate each metric
    const metrics = {} as Record<TargetMetricKey, PaceEvaluationResult>;
    const rrDetails = details.refundRate as
      | { maturedCount?: number; refundedCount?: number }
      | undefined;
    const maturedCount = rrDetails?.maturedCount ?? 0;

    for (const key of ALL_METRIC_KEYS) {
      const targetEval = formattedTarget
        ? formattedTarget.metrics[key]
        : evaluateMetricTarget(key, null, factor);

      const achievedVal = achieved[key] ?? null;

      metrics[key] = evaluateMetricPace({
        metric: key,
        targetEvaluation: targetEval,
        achieved: achievedVal,
        currentDay,
        daysElapsed,
        daysInPeriod,
        maturedCount,
      });
    }

    const isBehindPace = Object.values(metrics).some(
      (m) => m.direction === 'higher_is_better' && m.isBehindPace,
    );
    const isBreached = metrics.refundRate?.isBreached ?? false;

    return {
      staff: {
        id: staff.id,
        code: staff.code,
        name: staff.name,
        role: staff.role,
        city: staff.city,
        createdAt: staff.createdAt,
        teamLeadId: staff.teamLeadId,
      },
      target: formattedTarget,
      achieved: {
        ...achieved,
        details,
      },
      metrics,
      isBehindPace,
      isBreached,
    };
  }

  /**
   * Computes aggregate target and achieved totals across a list of agents
   */
  private computeAggregates(agents: AgentOverview[]) {
    let candidatesActivatedTarget = 0;
    let vacanciesCapturedTarget = 0;
    let placementsClosedTarget = 0;
    let replacementsInside15DaysTarget = 0;
    let repeatBusinessesTarget = 0;

    let candidatesActivatedAchieved = 0;
    let vacanciesCapturedAchieved = 0;
    let placementsClosedAchieved = 0;
    let replacementsInside15DaysAchieved = 0;
    let repeatBusinessesAchieved = 0;

    let totalMatured = 0;
    let totalRefunded = 0;

    let behindPaceCount = 0;
    let breachCount = 0;

    for (const a of agents) {
      if (a.isBehindPace) behindPaceCount++;
      if (a.isBreached) breachCount++;

      // Targets
      const t = a.target?.effective;
      if (t) {
        if (typeof t.candidatesActivated === 'number') candidatesActivatedTarget += t.candidatesActivated;
        if (typeof t.vacanciesCaptured === 'number') vacanciesCapturedTarget += t.vacanciesCaptured;
        if (typeof t.placementsClosed === 'number') placementsClosedTarget += t.placementsClosed;
        if (typeof t.replacementsInside15Days === 'number') {
          replacementsInside15DaysTarget += t.replacementsInside15Days;
        }
        if (typeof t.repeatBusinesses === 'number') repeatBusinessesTarget += t.repeatBusinesses;
      }

      // Achieved
      if (typeof a.achieved.candidatesActivated === 'number') {
        candidatesActivatedAchieved += a.achieved.candidatesActivated;
      }
      if (typeof a.achieved.vacanciesCaptured === 'number') {
        vacanciesCapturedAchieved += a.achieved.vacanciesCaptured;
      }
      if (typeof a.achieved.placementsClosed === 'number') {
        placementsClosedAchieved += a.achieved.placementsClosed;
      }
      if (typeof a.achieved.replacementsSecuredInside15Days === 'number') {
        replacementsInside15DaysAchieved += a.achieved.replacementsSecuredInside15Days;
      }
      if (typeof a.achieved.repeatBusinesses === 'number') {
        repeatBusinessesAchieved += a.achieved.repeatBusinesses;
      }

      const rrDetails = a.achieved.details?.refundRate as
        | { maturedCount?: number; refundedCount?: number }
        | undefined;
      if (rrDetails) {
        if (typeof rrDetails.maturedCount === 'number') totalMatured += rrDetails.maturedCount;
        if (typeof rrDetails.refundedCount === 'number') totalRefunded += rrDetails.refundedCount;
      }
    }

    const teamRefundRate = totalMatured > 0 ? totalRefunded / totalMatured : null;

    return {
      agentsCount: agents.length,
      behindPaceCount,
      breachCount,
      targets: {
        candidatesActivated: candidatesActivatedTarget,
        vacanciesCaptured: vacanciesCapturedTarget,
        placementsClosed: placementsClosedTarget,
        replacementsSecuredInside15Days: replacementsInside15DaysTarget,
        replacementsInside15Days: replacementsInside15DaysTarget,
        repeatBusinesses: repeatBusinessesTarget,
      },
      achieved: {
        candidatesActivated: candidatesActivatedAchieved,
        vacanciesCaptured: vacanciesCapturedAchieved,
        placementsClosed: placementsClosedAchieved,
        replacementsSecuredInside15Days: replacementsInside15DaysAchieved,
        replacementsInside15Days: replacementsInside15DaysAchieved,
        repeatBusinesses: repeatBusinessesAchieved,
        refundRate: teamRefundRate,
        refundRateDetails: {
          totalMatured,
          totalRefunded,
        },
      },
    };
  }
}
