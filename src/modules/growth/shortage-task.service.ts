import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../common/prisma/prisma.service';
import { AuditService } from '../../common/audit/audit.service';
import { MatchingService, tradeKey } from '../vacancy/matching.service';
import { ReportingScopeService } from '../staff/reporting-scope.service';
import { staffScopeFor } from './growth-scope';

export interface ShortageSweepResult {
  vacanciesChecked: number;
  opened: number;
  updated: number;
  closed: number;
}

interface ShortGroup {
  key: string;
  tradeKey: string;
  trade: string;
  areaKey: string;
  area: string;
  city: string;
  openPositions: number;
  vacancyIds: string[];
  /** Positions per Team Lead responsible (via each business's account agent). */
  positionsByTeamLead: Map<string, number>;
}

/** The normalised form of an area name, for grouping ("  HSR  layout" = "HSR Layout"). */
export function areaKey(name: string): string {
  return name.trim().replace(/\s+/g, ' ').toLocaleLowerCase('en-IN');
}

function plural(trade: string): string {
  const lower = trade.trim().toLocaleLowerCase('en-IN');
  return lower.endsWith('s') ? lower : `${lower}s`;
}

export function shortageTitle(trade: string, area: string, openPositions: number): string {
  return `${trade}, ${area}: ${openPositions} open, 0 available — send agents to register ${plural(trade)} here`;
}

/**
 * N3 "Trade and area shortage tasks" (confirmed 11 Nov). When open vacancies in a
 * trade and area have no matching available job seeker (the matching engine's own
 * Step 1 rules, within each job seeker's travel distance), the Team Lead gets one task
 * per trade and area to send agents to register that trade there. The daily sweep keeps
 * the counts fresh and closes the task by itself when supply appears or the vacancies
 * are no longer open.
 *
 * Areas are not owned by anyone (Master Guide: "Nobody assigns areas"), so the Team
 * Lead responsible is the Team Lead of the businesses' account agents; when several
 * teams have short vacancies in the same trade and area, the one with the most open
 * positions gets the task.
 */
@Injectable()
export class ShortageTaskService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly matching: MatchingService,
    private readonly reportingScope: ReportingScopeService,
    private readonly auditService: AuditService,
  ) {}

  async sweep(now: Date = new Date()): Promise<ShortageSweepResult> {
    const vacancies = await this.prisma.vacancy.findMany({
      where: {
        status: 'open',
        latitude: { not: null },
        longitude: { not: null },
        salaryMinPaise: { not: null },
      },
      select: {
        id: true,
        city: true,
        tradeSkill: true,
        headcount: true,
        locality: true,
        createdAt: true,
        business: { select: { locality: true, accountAgentId: true } },
      },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    });
    const located = vacancies.filter((v) => (v.locality ?? v.business.locality ?? '').trim().length > 0);
    const matches = await this.matching.suitableSeekerIds(located.map((v) => v.id));

    const short = new Map<string, ShortGroup>();
    const supplied = new Set<string>();
    const teamLeadOf = new Map<string, string | null>();
    for (const vacancy of located) {
      const found = matches.get(vacancy.id);
      if (found === null || found === undefined) continue; // candidates cannot be shown for it at all
      const area = (vacancy.locality ?? vacancy.business.locality)!.trim().replace(/\s+/g, ' ');
      const key = `${tradeKey(vacancy.tradeSkill)}|${areaKey(area)}`;
      if (found.length > 0) {
        supplied.add(key);
        continue;
      }
      const group = short.get(key) ?? {
        key,
        tradeKey: tradeKey(vacancy.tradeSkill),
        trade: vacancy.tradeSkill.trim(),
        areaKey: areaKey(area),
        area,
        city: vacancy.city,
        openPositions: 0,
        vacancyIds: [],
        positionsByTeamLead: new Map<string, number>(),
      };
      group.openPositions += vacancy.headcount;
      group.vacancyIds.push(vacancy.id);
      const agentId = vacancy.business.accountAgentId;
      if (agentId) {
        if (!teamLeadOf.has(agentId)) teamLeadOf.set(agentId, await this.teamLeadFor(agentId));
        const lead = teamLeadOf.get(agentId);
        if (lead) group.positionsByTeamLead.set(lead, (group.positionsByTeamLead.get(lead) ?? 0) + vacancy.headcount);
      }
      short.set(key, group);
    }

    let opened = 0;
    let updated = 0;
    for (const group of short.values()) {
      const assignedTeamLeadId = this.pickTeamLead(group.positionsByTeamLead);
      const data = {
        trade: group.trade,
        area: group.area,
        openPositions: group.openPositions,
        vacancyIds: group.vacancyIds,
        assignedTeamLeadId,
        title: shortageTitle(group.trade, group.area, group.openPositions),
        lastCheckedAt: now,
      };
      const existing = await this.prisma.shortageTask.findUnique({ where: { openKey: group.key } });
      if (existing) {
        await this.prisma.shortageTask.update({ where: { id: existing.id }, data });
        updated++;
        continue;
      }
      try {
        const task = await this.prisma.shortageTask.create({
          data: {
            ...data,
            openKey: group.key,
            city: group.city,
            tradeKey: group.tradeKey,
            areaKey: group.areaKey,
            status: 'open',
            openedAt: now,
          },
        });
        opened++;
        await this.auditService.log({
          actorId: 'system',
          action: 'shortage_task.opened',
          entityType: 'shortage_task',
          entityCode: task.id,
          after: { trade: task.trade, tradeKey: task.tradeKey, areaKey: task.areaKey, openPositions: task.openPositions, assignedTeamLeadId },
          city: task.city,
        });
      } catch (error) {
        // Another run opened it a moment ago: refresh that one instead.
        if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
          await this.prisma.shortageTask.update({ where: { openKey: group.key }, data });
          updated++;
        } else {
          throw error;
        }
      }
    }

    const stale = await this.prisma.shortageTask.findMany({
      where: { status: 'open', openKey: { notIn: [...short.keys()] } },
      select: { id: true, openKey: true, city: true, trade: true, areaKey: true },
    });
    for (const task of stale) {
      const reason = task.openKey && supplied.has(task.openKey) ? 'supply_appeared' : 'no_open_vacancies';
      const closed = await this.prisma.shortageTask.updateMany({
        where: { id: task.id, status: 'open' },
        data: { status: 'closed', openKey: null, closedAt: now, closedReason: reason, lastCheckedAt: now },
      });
      if (closed.count === 1) {
        await this.auditService.log({
          actorId: 'system',
          action: 'shortage_task.closed',
          entityType: 'shortage_task',
          entityCode: task.id,
          before: { status: 'open' },
          after: { status: 'closed', closedReason: reason, trade: task.trade, areaKey: task.areaKey },
          city: task.city,
        });
      }
    }

    return { vacanciesChecked: located.length, opened, updated, closed: stale.length };
  }

  /** Open shortage tasks: a Team Lead sees his own, a Manager his tree's (and unassigned ones), the CEO all. */
  async listOpen(actor: { id: string; role: string }) {
    const scope = await staffScopeFor(actor, this.reportingScope);
    const where: Prisma.ShortageTaskWhereInput = { status: 'open' };
    if (actor.role === 'team_lead') {
      where.assignedTeamLeadId = actor.id;
    } else if (scope) {
      where.OR = [{ assignedTeamLeadId: { in: scope } }, { assignedTeamLeadId: null }];
    }
    const tasks = await this.prisma.shortageTask.findMany({
      where,
      orderBy: [{ openPositions: 'desc' }, { openedAt: 'asc' }],
    });
    const leadIds = [...new Set(tasks.map((t) => t.assignedTeamLeadId).filter((id): id is string => Boolean(id)))];
    const leads = leadIds.length
      ? await this.prisma.staff.findMany({ where: { id: { in: leadIds } }, select: { id: true, code: true, name: true } })
      : [];
    return tasks.map((task) => ({
      ...task,
      openVacancies: task.vacancyIds.length,
      available: 0,
      assignedTeamLead: leads.find((lead) => lead.id === task.assignedTeamLeadId) ?? null,
    }));
  }

  private async teamLeadFor(agentId: string): Promise<string | null> {
    const agent = await this.prisma.staff.findUnique({ where: { id: agentId }, select: { role: true, status: true } });
    if (!agent) return null;
    if (agent.role === 'team_lead') return agentId;
    const chain = await this.reportingScope.chainOf(agentId);
    return chain.teamLead?.id ?? null;
  }

  private pickTeamLead(positions: Map<string, number>): string | null {
    let best: string | null = null;
    let bestCount = -1;
    for (const [lead, count] of positions) {
      if (count > bestCount) {
        best = lead;
        bestCount = count;
      }
    }
    return best;
  }
}
