import { BadRequestException, ForbiddenException, Injectable } from '@nestjs/common';
import { JwtPayload } from '../../common/auth/jwt-payload.interface';
import { PrismaService } from '../../common/prisma/prisma.service';
import { TargetService } from '../target/target.service';
import { paceFor, parseMonth } from '../ceo-portal/ceo-team.service';
import { percent } from '../ceo-portal/ceo-common';
import { monthOf, previousMonth } from './manager-common';
import { ManagerTree, ManagerTreeService } from './manager-tree.service';
import { CompanyPlanService, PLAN_METRICS, emptyPlan, splitDifference, sumOrNull, valuesOf } from '../company-plan/company-plan.service';

/** The target fields a Manager edits on MG-Targets (guide, Monthly targets). */
export const EDITABLE_TARGET_KEYS = ['candidatesActivated', 'vacanciesCaptured', 'placementsClosed', 'repeatBusinesses'] as const;
type EditableKey = (typeof EDITABLE_TARGET_KEYS)[number];

type TargetValues = Partial<Record<EditableKey, number | null>>;

export interface AgentTargetRow {
  staff: { id: string; code: string; name: string; role: string; isIntern: boolean };
  team: string | null;
  teamLeadId: string | null;
  targetId: string | null;
  target: Record<EditableKey, number | null>;
  main: { metric: string; done: number; target: number | null; percent: number | null };
  pace: string;
}

/**
 * MG-Targets: the agents' monthly targets in the Manager's tree, each team's
 * total, "Copy from last month" and the leaderboard. Targets are stored per
 * agent (the Target table); a team's target is the sum of its agents'. The
 * actual writes go through TargetService, which checks the Manager's tree
 * and refuses past months.
 */
@Injectable()
export class ManagerTargetsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tree: ManagerTreeService,
    private readonly targets: TargetService,
    private readonly plans: CompanyPlanService,
  ) {}

  /**
   * "Split the CEO's plan into teams": the CEO's plan, each of the Manager's
   * teams with its split and the sum of its agents' targets, the split of
   * teams under other Managers (one total), and whether it all adds up.
   */
  async planSplit(tree: ManagerTree, year: number, month: number) {
    const leadIds = tree.leads.map((l) => l.id);
    const [company, splits] = await Promise.all([this.plans.company(year, month), this.plans.teamPlans(year, month)]);
    const teams = [];
    for (const lead of tree.leads) {
      teams.push({
        teamLeadId: lead.id,
        team: lead.team,
        teamLead: lead.name,
        split: valuesOf(splits.find((x) => x.teamLeadId === lead.id)),
        agents: await this.plans.agentSums(this.tree.trackedTeamIds(tree, lead.id), year, month),
      });
    }
    const others = splits.filter((x) => !leadIds.includes(x.teamLeadId));
    const otherTeams = others.length ? emptyPlan() : null;
    if (otherTeams) for (const key of PLAN_METRICS) otherTeams[key] = sumOrNull(others.map((x) => x[key]));
    const total = emptyPlan();
    for (const key of PLAN_METRICS) total[key] = sumOrNull([...teams.map((t) => t.split[key]), otherTeams?.[key] ?? null]);
    const plan = company ? valuesOf(company) : null;
    return { company: plan, teams, otherTeams, total, difference: splitDifference(plan, total) };
  }

  /** Save the Manager's split for teams in their tree (PUT /manager/targets/split). */
  async saveSplit(actor: JwtPayload, body: { year?: unknown; month?: unknown; rows?: unknown }, now: Date) {
    const sel = parseMonth(body?.year, body?.month, now);
    const tree = await this.tree.load(actor.sub);
    const result = await this.plans.saveTeamPlans({ id: actor.sub, role: actor.role }, sel.year, sel.month, body?.rows, tree.leads.map((l) => l.id), now);
    return { ...result, plan: await this.planSplit(tree, sel.year, sel.month) };
  }

  async board(actor: { id: string; role: string }, year: unknown, month: unknown, now: Date) {
    const tree = await this.tree.load(actor.id);
    const sel = parseMonth(year, month, now);
    const m = monthOf(sel.year, sel.month, now);
    // Owner accounts carry no targets and are not on the leaderboard (owner decision 14 Nov).
    const targetAgents = this.tree.targetAgents(tree);
    const ids = targetAgents.map((a) => a.id);
    const rows = ids.length ? await this.prisma.target.findMany({ where: { staffId: { in: ids }, year: m.year, month: m.month } }) : [];
    const prev = previousMonth(m.year, m.month);
    const prevCount = ids.length ? await this.prisma.target.count({ where: { staffId: { in: ids }, year: prev.year, month: prev.month } }) : 0;
    const range = { from: m.from, to: now.getTime() < m.to.getTime() ? now : m.to };
    const agents: AgentTargetRow[] = [];
    for (const a of targetAgents) {
      const t = rows.find((r) => r.staffId === a.id) ?? null;
      const started = now.getTime() >= m.from.getTime();
      const c = started ? await this.tree.counts([a.id], range) : null;
      const field = a.role === 'field_agent';
      const mainTarget = field ? (t?.placementsClosed ?? null) : (t?.candidatesActivated ?? null);
      const mainDone = c ? (field ? c.placed : c.paid) : 0;
      agents.push({
        staff: { id: a.id, code: a.code, name: a.name, role: a.role, isIntern: a.isIntern },
        team: a.team,
        teamLeadId: a.teamLeadId,
        targetId: t?.id ?? null,
        target: {
          candidatesActivated: t?.candidatesActivated ?? null,
          vacanciesCaptured: t?.vacanciesCaptured ?? null,
          placementsClosed: t?.placementsClosed ?? null,
          repeatBusinesses: t?.repeatBusinesses ?? null,
        },
        main: { metric: field ? 'placed' : 'paid', done: mainDone, target: mainTarget, percent: mainTarget ? percent(mainDone, mainTarget) : null },
        pace: paceFor(mainDone, mainTarget, m.dayOfMonth, m.daysInMonth),
      });
    }
    const sum = (list: typeof agents, key: EditableKey) => {
      const values = list.map((r) => r.target[key]).filter((v): v is number => typeof v === 'number');
      return values.length ? values.reduce((x, y) => x + y, 0) : null;
    };
    const teams = tree.leads.map((l) => {
      const mine = agents.filter((a) => a.teamLeadId === l.id);
      return {
        teamLeadId: l.id,
        team: l.team,
        candidatesActivated: sum(mine, 'candidatesActivated'),
        vacanciesCaptured: sum(mine, 'vacanciesCaptured'),
        placementsClosed: sum(mine, 'placementsClosed'),
        repeatBusinesses: sum(mine, 'repeatBusinesses'),
      };
    });
    const leaderboard = [...agents]
      .filter((a) => a.main.done > 0 || a.main.target)
      .sort((x, y) => (y.main.metric === 'placed' ? 10 : 1) * y.main.done - (x.main.metric === 'placed' ? 10 : 1) * x.main.done || (y.main.percent ?? -1) - (x.main.percent ?? -1))
      .map((a, i) => ({ position: i + 1, staff: a.staff, team: a.team, main: a.main }));
    return {
      year: m.year,
      month: m.month,
      dayOfMonth: m.dayOfMonth,
      daysInMonth: m.daysInMonth,
      editable: now.getTime() <= m.to.getTime(),
      previous: { year: prev.year, month: prev.month, targets: prevCount },
      whole: {
        candidatesActivated: sum(agents, 'candidatesActivated'),
        vacanciesCaptured: sum(agents, 'vacanciesCaptured'),
        placementsClosed: sum(agents, 'placementsClosed'),
        repeatBusinesses: sum(agents, 'repeatBusinesses'),
      },
      teams,
      plan: await this.planSplit(tree, m.year, m.month),
      agents,
      leaderboard,
    };
  }

  private clean(value: unknown, key: string): number | null | undefined {
    if (value === undefined) return undefined;
    if (value === null || value === '') return null;
    const n = typeof value === 'string' ? Number(value) : value;
    if (typeof n !== 'number' || !Number.isInteger(n) || n < 0 || n > 100000) {
      throw new BadRequestException(`${key} must be a whole number of 0 or more`);
    }
    return n;
  }

  /**
   * Save targets for several agents in one go (Save targets). Creates a
   * target where there is none and updates it otherwise; an agent left with
   * every value empty is skipped. Everyone must be in the Manager's tree.
   */
  async save(actor: JwtPayload, body: { year?: unknown; month?: unknown; rows?: unknown }, now: Date) {
    const sel = parseMonth(body?.year, body?.month, now);
    if (!Array.isArray(body?.rows) || body.rows.length === 0) throw new BadRequestException('rows must list the targets to save');
    if (body.rows.length > 200) throw new BadRequestException('At most 200 rows at a time');
    const tree = await this.tree.load(actor.sub);
    const agentIds = new Set(this.tree.targetAgents(tree).map((a) => a.id));
    const parsed = (body.rows as Array<Record<string, unknown>>).map((r) => {
      const staffId = typeof r?.staffId === 'string' ? r.staffId : '';
      if (!agentIds.has(staffId)) throw new ForbiddenException('Every row must be an agent in your teams');
      const values: TargetValues = {};
      for (const key of EDITABLE_TARGET_KEYS) {
        const v = this.clean(r[key], key);
        if (v !== undefined) values[key] = v;
      }
      return { staffId, values };
    });
    let created = 0;
    let updated = 0;
    let skipped = 0;
    for (const row of parsed) {
      const existing = await this.prisma.target.findUnique({ where: { staffId_year_month: { staffId: row.staffId, year: sel.year, month: sel.month } } });
      const hasValue = Object.values(row.values).some((v) => typeof v === 'number');
      if (existing) {
        const merged = { ...existing, ...row.values };
        const anyLeft = ['candidatesActivated', 'refundRate', 'vacanciesCaptured', 'placementsClosed', 'replacementsInside15Days', 'repeatBusinesses'].some(
          (k) => (merged as Record<string, unknown>)[k] !== null && (merged as Record<string, unknown>)[k] !== undefined,
        );
        if (!anyLeft) {
          skipped += 1;
          continue;
        }
        const changed = EDITABLE_TARGET_KEYS.some((k) => row.values[k] !== undefined && row.values[k] !== existing[k]);
        if (!changed) continue;
        await this.targets.updateTarget(existing.id, row.values, actor.sub, now, actor);
        updated += 1;
      } else if (hasValue) {
        await this.targets.setTarget({ staffId: row.staffId, year: sel.year, month: sel.month, ...row.values }, actor.sub, now, actor);
        created += 1;
      } else {
        skipped += 1;
      }
    }
    return { created, updated, skipped };
  }

  /**
   * "Copy from last month" for the Manager's own agents (the Manager-scoped
   * version of the CEO's POST /ceo/targets/copy): an agent with a target in
   * `from` and none in `to` gets the same numbers; existing targets are left
   * alone. Past months are refused by TargetService.
   */
  async copy(actor: JwtPayload, body: { fromYear?: unknown; fromMonth?: unknown; toYear?: unknown; toMonth?: unknown }, now: Date) {
    const to = parseMonth(body?.toYear, body?.toMonth, now);
    const defaultFrom = previousMonth(to.year, to.month);
    const from = parseMonth(body?.fromYear ?? defaultFrom.year, body?.fromMonth ?? defaultFrom.month, now);
    if (from.year === to.year && from.month === to.month) throw new BadRequestException('Pick two different months');
    const tree = await this.tree.load(actor.sub);
    const ids = this.tree.targetAgents(tree).map((a) => a.id);
    if (!ids.length) return { copied: 0, skipped: [], from, to };
    const [source, existing] = await Promise.all([
      this.prisma.target.findMany({ where: { staffId: { in: ids }, year: from.year, month: from.month } }),
      this.prisma.target.findMany({ where: { staffId: { in: ids }, year: to.year, month: to.month }, select: { staffId: true } }),
    ]);
    const have = new Set(existing.map((t) => t.staffId));
    let copied = 0;
    const skipped: { staffId: string; reason: string }[] = [];
    for (const t of source) {
      if (have.has(t.staffId)) {
        skipped.push({ staffId: t.staffId, reason: 'already has a target' });
        continue;
      }
      await this.targets.setTarget(
        {
          staffId: t.staffId,
          year: to.year,
          month: to.month,
          candidatesActivated: t.candidatesActivated,
          refundRate: t.refundRate,
          vacanciesCaptured: t.vacanciesCaptured,
          placementsClosed: t.placementsClosed,
          replacementsInside15Days: t.replacementsInside15Days,
          repeatBusinesses: t.repeatBusinesses,
        },
        actor.sub,
        now,
        actor,
      );
      copied += 1;
    }
    return { copied, skipped, from, to };
  }
}
