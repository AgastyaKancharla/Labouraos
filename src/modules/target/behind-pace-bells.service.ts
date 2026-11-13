import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { Staff } from '@prisma/client';
import { PrismaService } from '../../common/prisma/prisma.service';
import { getCalendarPartsInTimezone, getPeriodBoundaries, getTimezoneForCity } from '../../common/time/period-boundary';
import { NotificationService } from '../notification/notification.service';
import { NotificationSourcesService } from '../notification/notification-sources.service';
import { TargetOverviewService } from './target-overview.service';

/** The pace check is heavy (every agent's month), so the bell sweep runs it at most this often. */
export const BEHIND_PACE_CHECK_EVERY_MS = 60 * 60 * 1000;

/**
 * Guide, Monthly targets: "Agents who fall behind pace are flagged to their
 * Team Lead and Manager." Uses the same pace check as the target screens
 * ("Behind"), with the Settings values (behindPaceStartDay, default day 8;
 * behindPaceThresholdPercent, default 80% of where the target should be by
 * today; neither number is in the guide). An agent behind pace is on the bell
 * of their Team Lead, their Manager and the CEO (owner decision 12 Nov: "The
 * CEO also gets a bell when an agent falls behind pace"); one bell per agent
 * and recipient, cleared by itself once they are back on pace or the month
 * ends. The targets are counts, so the bell says counts (never money for the
 * Team Lead or Manager).
 */
@Injectable()
export class BehindPaceBellsService implements OnModuleInit {
  private readonly logger = new Logger(BehindPaceBellsService.name);
  private lastRunAt = 0;

  constructor(
    private readonly prisma: PrismaService,
    private readonly overview: TargetOverviewService,
    private readonly notifications: NotificationService,
    private readonly sources: NotificationSourcesService,
  ) {}

  onModuleInit(): void {
    this.sources.registerRequestSource('behind pace', (now) => this.sweepIfDue(now));
  }

  async sweepIfDue(now: Date): Promise<unknown> {
    if (now.getTime() - this.lastRunAt < BEHIND_PACE_CHECK_EVERY_MS) return { skipped: true };
    this.lastRunAt = now.getTime();
    return this.sweep(now);
  }

  async sweep(now: Date): Promise<{ behind: number; opened: number; cleared: number }> {
    const dir = await this.sources.directory();
    const agents = await this.prisma.staff.findMany({ where: { role: { in: ['call_agent', 'field_agent'] }, status: 'active' } });
    const drafts = [];
    let behind = 0;
    for (const agent of agents) {
      const result = await this.check(agent, now);
      if (!result) continue;
      behind += 1;
      const chain = dir.chainOf(agent.id);
      // The CEO at the top of the agent's line; an agent with no line reaches every active CEO.
      const ceos = chain.ceo ? [chain.ceo] : dir.ceos();
      drafts.push(
        ...this.sources.drafts(
          [chain.teamLead, chain.manager, ...ceos],
          {
            kind: 'behind_pace',
            title: `${agent.name} (${agent.code}) is behind pace this month`,
            body: result,
            subjectType: 'staff_pace',
            subjectId: agent.id,
          },
          { id: agent.id },
        ),
      );
    }
    const { opened, cleared } = await this.notifications.reconcileKind('behind_pace', drafts, () => ({ reason: 'back_on_pace' }), now);
    return { behind, opened, cleared };
  }

  /** The metrics behind pace, in words ("Placements closed: 2 of 12, should be 5 by now"), or null when on pace. */
  private async check(agent: Staff, now: Date): Promise<string | null> {
    try {
      const timezone = getTimezoneForCity(agent.city || 'Bengaluru');
      const parts = getCalendarPartsInTimezone(now, timezone);
      const period = getPeriodBoundaries(parts.year, parts.month, timezone);
      const actor = { sub: agent.id, role: agent.role, email: agent.email, code: agent.code, teamLeadId: agent.teamLeadId };
      const result = await this.overview.buildSingleAgentOverview(agent, parts.year, parts.month, period, actor, now);
      if (!result.isBehindPace) return null;
      const lines = Object.values(result.metrics)
        .filter((m) => m.direction === 'higher_is_better' && m.isBehindPace)
        .map((m) => `${m.label}: ${m.achieved ?? 0} of ${m.effectiveTarget}, about ${Math.ceil(m.expectedPace ?? 0)} by now`);
      return lines.join(' · ') || 'Behind on this month’s targets';
    } catch (err) {
      this.logger.warn(`Pace check failed for ${agent.code}: ${(err as Error).message}`);
      return null;
    }
  }
}
