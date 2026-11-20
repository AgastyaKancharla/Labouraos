import { BadRequestException, Injectable } from '@nestjs/common';
import { JwtPayload } from '../../common/auth/jwt-payload.interface';
import { PrismaService } from '../../common/prisma/prisma.service';
import { TargetService } from '../target/target.service';
import { paceFor, parseMonth } from '../ceo-portal/ceo-team.service';
import { percent } from '../ceo-portal/ceo-common';
import { monthOf, previousMonth } from './manager-common';
import { ManagerTree, ManagerTreeService } from './manager-tree.service';
import { CompanyPlanService, PLAN_METRICS, emptyPlan, splitDifference, sumOrNull, valuesOf } from '../company-plan/company-plan.service';
import { TargetSplitService } from '../company-plan/target-split.service';

/** The target fields a Manager edits on MG-Targets (guide, Monthly targets). */
export const EDITABLE_TARGET_KEYS = ['candidatesActivated', 'vacanciesCaptured', 'placementsClosed', 'repeatBusinesses'] as const;
type EditableKey = (typeof EDITABLE_TARGET_KEYS)[number];


export interface AgentTargetRow {
  staff: { id: string; code: string; name: string; role: string; isIntern: boolean };
  team: string | null;
  teamLeadId: string | null;
  targetId: string | null;
  target: Record<EditableKey, number | null>;
  main: { metric: string; done: number; target: number | null; percent: number | null };
  pace: string;
  /** The fields set by hand (the rest come from the automatic split). */
  handSet: string[];
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
    private readonly split: TargetSplitService,
  ) {}

  /**
   * "Split the CEO's plan into teams": the CEO's plan, each of the Manager's
   * teams with its split and the sum of its agents' targets, the split of
   * teams under other Managers (one total), and whether it all adds up.
   */
  async planSplit(tree: ManagerTree, year: number, month: number) {
    const leadIds = tree.leads.map((l) => l.id);
    const [company, splits] = await Promise.all([this.plans.company(year, month), this.plans.teamPlans(year, month)]);
    const marks = await this.split.readMarks(year, month, leadIds);
    const teams = [];
    for (const lead of tree.leads) {
      const mark = marks.teams.find((m) => m.teamLeadId === lead.id);
      teams.push({
        teamLeadId: lead.id,
        team: lead.team,
        teamLead: lead.name,
        split: valuesOf(splits.find((x) => x.teamLeadId === lead.id)),
        agents: await this.plans.agentSums(this.tree.trackedTeamIds(tree, lead.id), year, month),
        handSet: mark?.handSet ?? [],
        leaverCredit: mark?.leaverCredit ?? {},
        flags: mark?.flags ?? [],
      });
    }
    // Teams under other Managers: only active Team Leads (a closed team's old row is not counted).
    const otherIds = splits.filter((x) => !leadIds.includes(x.teamLeadId)).map((x) => x.teamLeadId);
    const activeOthers = otherIds.length
      ? new Set((await this.prisma.staff.findMany({ where: { id: { in: otherIds }, role: 'team_lead', status: { not: 'deactivated' } }, select: { id: true } })).map((r) => r.id))
      : new Set<string>();
    const others = splits.filter((x) => activeOthers.has(x.teamLeadId));
    const otherTeams = others.length ? emptyPlan() : null;
    if (otherTeams) for (const key of PLAN_METRICS) otherTeams[key] = sumOrNull(others.map((x) => x[key]));
    const total = emptyPlan();
    for (const key of PLAN_METRICS) total[key] = sumOrNull([...teams.map((t) => t.split[key]), otherTeams?.[key] ?? null]);
    const plan = company ? valuesOf(company) : null;
    // The Manager's share of the CEO's plan: what the split gave their teams (per metric the CEO set).
    const share = emptyPlan();
    for (const key of PLAN_METRICS) share[key] = plan?.[key] === null || !plan ? null : (sumOrNull(teams.map((t) => t.split[key])) ?? 0);
    return { company: plan, automatic: marks.automatic, share, teams, otherTeams, total, difference: splitDifference(plan, total), agentHandSet: marks.agents };
  }

  /** Save the Manager's split for teams in their tree (PUT /manager/targets/split). */
  async saveSplit(actor: JwtPayload, body: { year?: unknown; month?: unknown; rows?: unknown }, now: Date) {
    const sel = parseMonth(body?.year, body?.month, now);
    const tree = await this.tree.load(actor.sub);
    const result = await this.split.saveTeamValues({ id: actor.sub, role: actor.role }, sel.year, sel.month, body?.rows, tree.leads.map((l) => l.id), now);
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
    const plan = await this.planSplit(tree, m.year, m.month);
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
        handSet: t?.handSetFields ?? [],
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
    // Agents who left this month with a target: their unreached part can be transferred.
    const leftPeople = await this.tree.leftSince(actor.id, m.from);
    const leftTargets = leftPeople.length ? await this.prisma.target.findMany({ where: { staffId: { in: leftPeople.map((p) => p.id) }, year: m.year, month: m.month } }) : [];
    const left = leftPeople
      .map((p) => {
        const t = leftTargets.find((x) => x.staffId === p.id);
        return t
          ? { staff: p, target: { candidatesActivated: t.candidatesActivated, vacanciesCaptured: t.vacanciesCaptured, placementsClosed: t.placementsClosed, repeatBusinesses: t.repeatBusinesses } }
          : null;
      })
      .filter((x): x is NonNullable<typeof x> => x !== null);
    return {
      year: m.year,
      month: m.month,
      left,
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
      plan,
      agents,
      leaderboard,
    };
  }

  /**
   * Save targets for several agents in one go (Save targets). A number that
   * changes is "set by hand" and kept; empty puts it back to automatic. The
   * hand-set numbers of a team's agents may not add up to more than the
   * team's number; the rest is spread over the other agents. Everyone must be
   * in the Manager's tree; past months are refused.
   */
  async save(actor: JwtPayload, body: { year?: unknown; month?: unknown; rows?: unknown }, now: Date) {
    const sel = parseMonth(body?.year, body?.month, now);
    if (!Array.isArray(body?.rows) || body.rows.length === 0) throw new BadRequestException('rows must list the targets to save');
    const tree = await this.tree.load(actor.sub);
    return this.split.saveAgentValues({ id: actor.sub, role: actor.role }, sel.year, sel.month, body.rows, this.tree.targetAgents(tree).map((a) => a.id), now);
  }

  /** "Reset to automatic" for a team's number (kind 'team', id = Team Lead) or an agent's (kind 'agent'); key = one metric, or the whole row. */
  async reset(actor: JwtPayload, body: { year?: unknown; month?: unknown; kind?: unknown; id?: unknown; key?: unknown }, now: Date) {
    const sel = parseMonth(body?.year, body?.month, now);
    const tree = await this.tree.load(actor.sub);
    const result = await this.split.reset(
      { id: actor.sub, role: actor.role },
      { year: sel.year, month: sel.month, kind: body?.kind, id: body?.id, key: body?.key },
      { leadIds: tree.leads.map((l) => l.id), agentIds: this.tree.targetAgents(tree).map((a) => a.id) },
      now,
    );
    return { ...result, plan: await this.planSplit(tree, sel.year, sel.month) };
  }

  /** "Transfer target": what one agent has not reached yet goes to another agent of the same work type in the Manager's tree. */
  async transfer(actor: JwtPayload, body: { year?: unknown; month?: unknown; fromStaffId?: unknown; toStaffId?: unknown }, now: Date) {
    const sel = parseMonth(body?.year, body?.month, now);
    const tree = await this.tree.load(actor.sub);
    const active = new Set(this.tree.targetAgents(tree).map((a) => a.id));
    return this.split.transfer(
      { id: actor.sub, role: actor.role },
      { year: sel.year, month: sel.month, fromStaffId: body?.fromStaffId, toStaffId: body?.toStaffId },
      // An agent who has left is no longer in the tree: still the Manager's when they were under one of the Manager's people.
      async (staffId, opts) => active.has(staffId) || (opts.allowLeft && (await this.tree.isUnder(actor.sub, staffId))),
      now,
    );
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
