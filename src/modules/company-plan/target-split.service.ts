import { BadRequestException, ForbiddenException, Injectable, Logger, NotFoundException, OnApplicationBootstrap, OnModuleInit, Optional } from '@nestjs/common';
import { CompanyPlan, Prisma, Target, TeamPlan } from '@prisma/client';
import { PrismaService } from '../../common/prisma/prisma.service';
import { AuditService } from '../../common/audit/audit.service';
import { teamLeadOf } from '../../common/rbac/own-team';
import { istDayKey } from '../ceo-portal/ceo-common';
import { WorkingDaysService } from '../attendance/working-days.service';
import { CallAgentMetricsService } from '../target/call-agent-metrics.service';
import { FieldAgentMetricsService } from '../target/field-agent-metrics.service';
import { AGENT_TARGET_FIELD, PLAN_METRICS, PLAN_METRIC_LABEL, PlanMetricKey, PlanValues, valuesOf } from './company-plan.service';
import {
  AGENT_FIELD_LABEL,
  AgentField,
  FIELD_WORK_TYPE,
  METRIC_OF_FIELD,
  NO_MANAGER,
  SPLIT_AGENT_FIELDS,
  SplitAgent,
  SplitFlag,
  SplitResult,
  SplitTeam,
  WorkType,
  addCredit,
  emptyResult,
  fieldsFor,
  groupTeams,
  isAgentField,
  isPlanMetric,
  leaverCredit,
  spreadGroupMetric,
  spreadTeamMetric,
  splitPlan,
  unreached,
  workTypeOf,
  workingDaysFrom,
} from './target-split';
import { StaffSplitEvent, TargetSplitHandler, TargetSplitHooks } from './target-split.hooks';

type Achieved = Map<string, Partial<Record<AgentField, number>>>;
type Client = Prisma.TransactionClient | PrismaService;

interface TeamRow {
  id: string;
  code: string;
  name: string;
  teamName: string | null;
  groupKey: string;
  plan: TeamPlan | null;
}

interface AgentRow {
  id: string;
  code: string;
  name: string;
  role: string;
  workType: WorkType;
  teamLeadId: string;
  /** Day of the month from which the agent counts (1 = whole month). */
  startDay: number;
  target: Target | null;
}

interface MonthState {
  year: number;
  month: number;
  key: string;
  /** The current IST month (achieved so far is a floor). */
  current: boolean;
  /** Day of the month today (current month only). */
  today: number;
  workingDays: number[];
  company: CompanyPlan | null;
  teams: TeamRow[];
  agents: AgentRow[];
}

export interface SplitRunSummary {
  year: number;
  month: number;
  trigger: string;
  teams: number;
  agents: number;
  teamRowsChanged: number;
  agentRowsChanged: number;
  flags: SplitFlag[];
}

type Actor = { id: string; role: string };

const monthKey = (year: number, month: number) => `${year}-${String(month).padStart(2, '0')}`;
const numberOrNull = (v: unknown): number | null => (typeof v === 'number' ? v : null);

/** Parse a whole number 0–100,000 from a request; empty = null; undefined = not sent. */
function parseCount(value: unknown, key: string): number | null | undefined {
  if (value === undefined) return undefined;
  if (value === null || value === '') return null;
  const n = typeof value === 'string' ? Number(value) : value;
  if (typeof n !== 'number' || !Number.isInteger(n) || n < 0 || n > 100000) throw new BadRequestException(`${key} must be a whole number of 0 or more`);
  return n;
}

function teamHandSet(plan: TeamPlan | null): Partial<Record<PlanMetricKey, number>> {
  const out: Partial<Record<PlanMetricKey, number>> = {};
  if (!plan) return out;
  for (const k of plan.handSetFields) if (isPlanMetric(k) && typeof plan[k] === 'number') out[k] = plan[k] as number;
  return out;
}

function agentHandSet(target: Target | null): Partial<Record<AgentField, number>> {
  const out: Partial<Record<AgentField, number>> = {};
  if (!target) return out;
  for (const k of target.handSetFields) if (isAgentField(k) && typeof target[k] === 'number') out[k] = target[k] as number;
  return out;
}

export function creditOf(plan: TeamPlan | null): Partial<Record<PlanMetricKey, number>> {
  const out: Partial<Record<PlanMetricKey, number>> = {};
  const raw = plan?.leaverCredit;
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return out;
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) if (isPlanMetric(k) && typeof v === 'number' && v > 0) out[k] = v;
  return out;
}

function agentValues(target: Target | null): Record<AgentField, number | null> {
  return {
    candidatesActivated: target?.candidatesActivated ?? null,
    vacanciesCaptured: target?.vacanciesCaptured ?? null,
    placementsClosed: target?.placementsClosed ?? null,
    repeatBusinesses: target?.repeatBusinesses ?? null,
  };
}

/** The flags in plain words for MG-Targets and T-Targets. */
export function flagText(flag: SplitFlag, teamName: (id: string) => string): string {
  const metric = PLAN_METRIC_LABEL[flag.metric].toLowerCase();
  if (flag.kind === 'no_agents') return `No ${flag.workType} agents in ${teamName(flag.teamId)} for ${metric}: ${flag.amount} stays with the team`;
  if (flag.kind === 'unassigned') return `${flag.amount} ${metric} not given to anyone: every ${flag.level === 'team' ? 'agent' : 'team'} has a number set by hand${flag.level === 'team' ? ` in ${teamName(flag.teamId)}` : ''}`;
  if (flag.level === 'team') return `The agents' ${metric} in ${teamName(flag.teamId)} add up to more than the team's number (set by hand or already done)`;
  if (flag.level === 'group') return `The teams' ${metric} add up to more than the Manager's share (set by hand or already done)`;
  return `The teams' ${metric} add up to more than the CEO's plan (set by hand or already done)`;
}

/**
 * The automatic target split (Master Guide rev 195, 17 Nov): CEO plan →
 * Managers → teams (TeamPlan) → agents (Target), hand changes kept and the
 * rest re-spread, mid-month re-splits when people join, leave or move,
 * "Transfer target", "Reset to automatic" and the one-off backfill. Every
 * run, hand change, reset and transfer is audited. Past months are never
 * changed. Hand-set values: `handSetFields` on TeamPlan and Target.
 */
@Injectable()
export class TargetSplitService implements OnModuleInit, OnApplicationBootstrap, TargetSplitHandler {
  private readonly logger = new Logger(TargetSplitService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly workingDays: WorkingDaysService,
    private readonly callMetrics: CallAgentMetricsService,
    private readonly fieldMetrics: FieldAgentMetricsService,
    @Optional() private readonly hooks?: TargetSplitHooks,
  ) {}

  onModuleInit(): void {
    this.hooks?.register(this);
  }

  /** Backfill (spec 7): once at start-up, outside tests, in the background. */
  onApplicationBootstrap(): void {
    if (process.env.NODE_ENV === 'test') return;
    void this.backfill(new Date()).catch((error: unknown) => {
      this.logger.warn(`Target split backfill failed: ${error instanceof Error ? error.message : String(error)}`);
    });
  }

  // ------------------------------------------------------------- months

  private currentMonth(now: Date): { year: number; month: number; day: number } {
    const [y, m, d] = istDayKey(now).split('-').map(Number);
    return { year: y, month: m, day: d };
  }

  isPast(year: number, month: number, now: Date): boolean {
    const c = this.currentMonth(now);
    return year * 12 + month < c.year * 12 + c.month;
  }

  assertNotPast(year: number, month: number, now: Date): void {
    if (this.isPast(year, month, now)) throw new BadRequestException('A past month cannot be changed');
  }

  private async workingDaysOf(year: number, month: number): Promise<number[]> {
    const days = new Date(Date.UTC(year, month, 0)).getUTCDate();
    try {
      const cal = await this.workingDays.calendar(new Date(Date.UTC(year, month - 1, 1)), new Date(Date.UTC(year, month - 1, days)));
      const list = cal.workingDates.map((d) => d.getUTCDate());
      if (list.length) return list;
    } catch {
      // No Settings row (fresh database): every day counts.
    }
    return Array.from({ length: days }, (_, i) => i + 1);
  }

  /** The people and numbers of a month, as the split sees them. */
  private async loadState(client: Client, year: number, month: number, now: Date, workingDays?: number[]): Promise<MonthState> {
    const key = monthKey(year, month);
    const c = this.currentMonth(now);
    const current = c.year === year && c.month === month;
    const [company, staff, plans] = await Promise.all([
      client.companyPlan.findUnique({ where: { year_month: { year, month } } }),
      client.staff.findMany({
        where: { role: { in: ['manager', 'team_lead', 'call_agent', 'field_agent'] }, status: { not: 'deactivated' } },
        select: { id: true, code: true, name: true, role: true, isOwnerAccount: true, teamLeadId: true, reportsToId: true, teamName: true, joinedOn: true, createdAt: true },
        orderBy: { code: 'asc' },
      }),
      client.teamPlan.findMany({ where: { year, month } }),
    ]);
    const roleOf = new Map(staff.map((s) => [s.id, s.role]));
    const leads = staff.filter((s) => s.role === 'team_lead');
    const leadIds = new Set(leads.map((l) => l.id));
    const teams: TeamRow[] = leads.map((l) => ({
      id: l.id,
      code: l.code,
      name: l.name,
      teamName: l.teamName,
      groupKey: l.reportsToId && roleOf.get(l.reportsToId) === 'manager' ? l.reportsToId : NO_MANAGER,
      plan: plans.find((p) => p.teamLeadId === l.id) ?? null,
    }));
    const pending: Omit<AgentRow, 'target'>[] = [];
    for (const s of staff) {
      const workType = workTypeOf(s.role);
      if (!workType || s.isOwnerAccount) continue;
      const reportsToRole = s.reportsToId ? roleOf.get(s.reportsToId) : undefined;
      const lead = teamLeadOf({ role: s.role, teamLeadId: s.teamLeadId, reportsToId: s.reportsToId, reportsTo: reportsToRole ? { role: reportsToRole } : null });
      if (!lead || !leadIds.has(lead)) continue;
      const joinKey = s.joinedOn ? s.joinedOn.toISOString().slice(0, 10) : istDayKey(s.createdAt);
      if (joinKey.slice(0, 7) > key) continue; // joins after this month
      const startDay = joinKey.slice(0, 7) === key ? Number(joinKey.slice(8, 10)) : 1;
      pending.push({ id: s.id, code: s.code, name: s.name, role: s.role, workType, teamLeadId: lead, startDay });
    }
    const targets = pending.length ? await client.target.findMany({ where: { year, month, staffId: { in: pending.map((a) => a.id) } } }) : [];
    const agents: AgentRow[] = pending.map((a) => {
      const target = targets.find((t) => t.staffId === a.id) ?? null;
      return { ...a, startDay: target?.splitFromDay ?? a.startDay, target };
    });
    return { year, month, key, current, today: current ? c.day : 0, workingDays: workingDays ?? (await this.workingDaysOf(year, month)), company, teams, agents };
  }

  /** Done so far this month per agent (the counting T-Targets and MG-Targets show); only for the current month. */
  private async achievedFor(agents: Array<{ id: string; workType: WorkType }>, year: number, month: number, now: Date): Promise<Achieved> {
    const out: Achieved = new Map();
    const c = this.currentMonth(now);
    if (c.year !== year || c.month !== month) return out;
    for (const a of agents) {
      try {
        if (a.workType === 'call') {
          const m = await this.callMetrics.getCallAgentMetrics(a.id, year, month, undefined, now);
          out.set(a.id, { candidatesActivated: m.metrics.candidatesActivated, vacanciesCaptured: m.metrics.vacanciesCaptured });
        } else {
          const m = await this.fieldMetrics.getFieldAgentMetrics(a.id, year, month, undefined, now);
          out.set(a.id, { placementsClosed: m.metrics.placementsClosed, repeatBusinesses: m.metrics.repeatBusinesses });
        }
      } catch {
        out.set(a.id, {});
      }
    }
    return out;
  }

  private splitTeams(state: MonthState, achieved: Achieved): SplitTeam[] {
    return state.teams.map((t) => ({
      id: t.id,
      groupKey: t.groupKey,
      handSet: teamHandSet(t.plan),
      credit: creditOf(t.plan),
      agents: state.agents
        .filter((a) => a.teamLeadId === t.id)
        .map(
          (a): SplitAgent => ({
            id: a.id,
            workType: a.workType,
            weight: workingDaysFrom(state.workingDays, a.startDay),
            handSet: agentHandSet(a.target),
            achieved: achieved.get(a.id) ?? {},
          }),
        ),
    }));
  }

  private async locked<T>(year: number, month: number, fn: (tx: Prisma.TransactionClient) => Promise<T>): Promise<T> {
    return this.prisma.$transaction(
      async (tx) => {
        await tx.$executeRaw(Prisma.sql`SELECT pg_advisory_xact_lock(hashtext(${`target_split:${monthKey(year, month)}`}))`);
        return fn(tx);
      },
      { timeout: 120_000, maxWait: 30_000 },
    );
  }

  /** Write the split's numbers: only rows that change; hand-set values are never touched. */
  private async write(tx: Prisma.TransactionClient, state: MonthState, result: SplitResult, actorId: string): Promise<{ teams: number; agents: number }> {
    let teamsChanged = 0;
    let agentsChanged = 0;
    for (const team of state.teams) {
      const next = result.teams[team.id];
      if (!next) continue;
      const before = valuesOf(team.plan);
      const v: PlanValues = { ...before };
      for (const k of PLAN_METRICS) if (!team.plan?.handSetFields.includes(k)) v[k] = next[k];
      if (PLAN_METRICS.every((k) => v[k] === before[k])) continue;
      if (team.plan) {
        await tx.teamPlan.update({
          where: { id: team.plan.id },
          data: {
            registered: v.registered,
            paid: v.paid,
            businessesSignedUp: v.businessesSignedUp,
            vacancies: v.vacancies,
            interviewsDone: v.interviewsDone,
            placed: v.placed,
            leftWithin30: v.leftWithin30,
            repeatBusinesses: v.repeatBusinesses,
          },
        });
      } else {
        if (PLAN_METRICS.every((k) => v[k] === null)) continue;
        await tx.teamPlan.create({
          data: {
            teamLeadId: team.id,
            year: state.year,
            month: state.month,
            registered: v.registered,
            paid: v.paid,
            businessesSignedUp: v.businessesSignedUp,
            vacancies: v.vacancies,
            interviewsDone: v.interviewsDone,
            placed: v.placed,
            leftWithin30: v.leftWithin30,
            repeatBusinesses: v.repeatBusinesses,
            setByStaffId: actorId,
          },
        });
      }
      teamsChanged += 1;
    }
    for (const agent of state.agents) {
      const next = result.agents[agent.id];
      if (!next) continue;
      const before = agentValues(agent.target);
      const v = { ...before };
      const hand = agent.target?.handSetFields ?? [];
      let anyAuto = false;
      for (const f of fieldsFor(agent.workType)) {
        if (hand.includes(f) || next[f] === undefined) continue;
        v[f] = next[f] ?? null;
        anyAuto = true;
      }
      const fromDay = anyAuto ? (agent.startDay > 1 ? agent.startDay : null) : (agent.target?.splitFromDay ?? null);
      const same = SPLIT_AGENT_FIELDS.every((f) => v[f] === before[f]) && fromDay === (agent.target?.splitFromDay ?? null);
      if (same) continue;
      if (agent.target) {
        await tx.target.update({
          where: { id: agent.target.id },
          data: {
            candidatesActivated: v.candidatesActivated,
            vacanciesCaptured: v.vacanciesCaptured,
            placementsClosed: v.placementsClosed,
            repeatBusinesses: v.repeatBusinesses,
            splitFromDay: fromDay,
            updatedById: actorId,
          },
        });
      } else {
        if (SPLIT_AGENT_FIELDS.every((f) => v[f] === null)) continue;
        await tx.target.create({
          data: {
            staffId: agent.id,
            year: state.year,
            month: state.month,
            candidatesActivated: v.candidatesActivated,
            vacanciesCaptured: v.vacanciesCaptured,
            placementsClosed: v.placementsClosed,
            repeatBusinesses: v.repeatBusinesses,
            splitFromDay: fromDay,
            createdById: actorId,
          },
        });
      }
      agentsChanged += 1;
    }
    return { teams: teamsChanged, agents: agentsChanged };
  }

  private async auditRun(tx: Prisma.TransactionClient, actorId: string, summary: SplitRunSummary): Promise<void> {
    await this.audit.log(
      {
        actorId,
        action: 'target_split.run',
        entityType: 'target_split',
        entityCode: monthKey(summary.year, summary.month),
        after: {
          trigger: summary.trigger,
          teams: summary.teams,
          agents: summary.agents,
          teamRowsChanged: summary.teamRowsChanged,
          agentRowsChanged: summary.agentRowsChanged,
          flags: summary.flags.slice(0, 50) as unknown as Prisma.JsonArray,
        },
      },
      tx,
    );
  }

  // ------------------------------------------------------------ the splits

  /**
   * The whole split of a month (CEO plan saved, backfill, "Split again", a
   * future month after a staff change). Current or future months only; a
   * month without a CEO plan has nothing to split (null).
   */
  async splitMonth(year: number, month: number, actorId: string, trigger: string, now: Date = new Date()): Promise<SplitRunSummary | null> {
    if (this.isPast(year, month, now)) return null;
    const outside = await this.loadState(this.prisma, year, month, now);
    if (!outside.company) return null;
    const achieved = await this.achievedFor(outside.agents, year, month, now);
    return this.locked(year, month, async (tx) => {
      const state = await this.loadState(tx, year, month, now, outside.workingDays);
      if (!state.company) return null;
      const result = splitPlan(valuesOf(state.company), this.splitTeams(state, achieved));
      const changed = await this.write(tx, state, result, actorId);
      const summary: SplitRunSummary = {
        year,
        month,
        trigger,
        teams: state.teams.length,
        agents: state.agents.length,
        teamRowsChanged: changed.teams,
        agentRowsChanged: changed.agents,
        flags: result.flags,
      };
      await this.auditRun(tx, actorId, summary);
      return summary;
    });
  }

  /** Re-spread the agents of these teams over each team's current numbers (team totals unchanged). */
  private async respreadTeamsIn(tx: Prisma.TransactionClient, state: MonthState, leadIds: string[], achieved: Achieved, actorId: string, trigger: string): Promise<SplitRunSummary> {
    const result = emptyResult();
    const teams = this.splitTeams(state, achieved).filter((t) => leadIds.includes(t.id));
    for (const t of teams) {
      const plan = state.teams.find((x) => x.id === t.id)?.plan ?? null;
      for (const metric of PLAN_METRICS) if (AGENT_TARGET_FIELD[metric]) spreadTeamMetric(t, metric, numberOrNull(plan?.[metric]), result);
    }
    const changed = await this.write(tx, state, result, actorId);
    const summary: SplitRunSummary = {
      year: state.year,
      month: state.month,
      trigger,
      teams: teams.length,
      agents: teams.reduce((n, t) => n + t.agents.length, 0),
      teamRowsChanged: 0,
      agentRowsChanged: changed.agents,
      flags: result.flags,
    };
    await this.auditRun(tx, actorId, summary);
    return summary;
  }

  /** Re-spread a Manager's share (the sum of their teams' numbers) over their teams that are not hand-set, then each team over its agents. */
  private groupShare(state: MonthState, groupKey: string, metric: PlanMetricKey): number | null {
    if (typeof state.company?.[metric] !== 'number') return null;
    return state.teams.filter((t) => t.groupKey === groupKey).reduce((sum, t) => sum + (numberOrNull(t.plan?.[metric]) ?? 0), 0);
  }

  /** `shares`: the Manager's share per metric as it was before a hand change (default: the sum of the teams' numbers now). */
  private async respreadGroupIn(
    tx: Prisma.TransactionClient,
    state: MonthState,
    groupKey: string,
    metrics: PlanMetricKey[],
    achieved: Achieved,
    actorId: string,
    trigger: string,
    shares?: Partial<Record<PlanMetricKey, number | null>>,
  ): Promise<SplitRunSummary> {
    const result = emptyResult();
    const teams = groupTeams(this.splitTeams(state, achieved).filter((t) => t.groupKey === groupKey)).get(groupKey) ?? [];
    for (const metric of metrics) {
      const total = shares && metric in shares ? (shares[metric] ?? null) : this.groupShare(state, groupKey, metric);
      spreadGroupMetric(groupKey, total, teams, metric, result);
    }
    // Keep the metrics not re-spread as they are.
    for (const id of Object.keys(result.teams)) {
      const plan = valuesOf(state.teams.find((x) => x.id === id)?.plan);
      for (const k of PLAN_METRICS) if (!metrics.includes(k)) result.teams[id][k] = plan[k];
    }
    const changed = await this.write(tx, state, result, actorId);
    const summary: SplitRunSummary = {
      year: state.year,
      month: state.month,
      trigger,
      teams: teams.length,
      agents: teams.reduce((n, t) => n + t.agents.length, 0),
      teamRowsChanged: changed.teams,
      agentRowsChanged: changed.agents,
      flags: result.flags,
    };
    await this.auditRun(tx, actorId, summary);
    return summary;
  }

  /** Future months with a CEO plan get a whole new split after a staff change. */
  private async resplitFutureMonths(actorId: string, now: Date): Promise<void> {
    const c = this.currentMonth(now);
    const plans = await this.prisma.companyPlan.findMany({
      where: { OR: [{ year: { gt: c.year } }, { year: c.year, month: { gt: c.month } }] },
      select: { year: true, month: true },
      orderBy: [{ year: 'asc' }, { month: 'asc' }],
    });
    for (const p of plans) await this.splitMonth(p.year, p.month, actorId, 'staff_change', now);
  }

  // ------------------------------------------------- staff changes (spec 3)

  async staffChanged(event: StaffSplitEvent, now: Date = new Date()): Promise<void> {
    const c = this.currentMonth(now);
    const plan = await this.prisma.companyPlan.findUnique({ where: { year_month: { year: c.year, month: c.month } }, select: { id: true } });
    if (plan && event.kind !== 'team_moved') await this.resplitCurrent(event, c, now);
    await this.resplitFutureMonths(event.actorId, now);
  }

  private async resplitCurrent(event: Exclude<StaffSplitEvent, { kind: 'team_moved' }>, c: { year: number; month: number; day: number }, now: Date): Promise<void> {
    const { year, month } = c;
    const staff = await this.prisma.staff.findUnique({
      where: { id: event.staffId },
      select: { id: true, role: true, teamLeadId: true, reportsToId: true, reportsTo: { select: { role: true } } },
    });
    const workType = staff ? workTypeOf(staff.role) : null;
    if (!staff || !workType) return;
    const lead = teamLeadOf(staff);
    const outside = await this.loadState(this.prisma, year, month, now);
    const oldLead = event.kind === 'moved' ? event.fromTeamLeadId : event.kind === 'left' ? lead : null;
    const newLead = event.kind === 'joined' || event.kind === 'moved' ? lead : null;
    const newTeamHasPlan = newLead ? Boolean(outside.teams.find((t) => t.id === newLead)?.plan) : true;
    if (newLead && !newTeamHasPlan) {
      // A team with no numbers this month yet (a new team): split the whole month again.
      await this.splitMonth(year, month, event.actorId, `staff_${event.kind}`, now);
      return;
    }
    const affected = [oldLead, newLead].filter((x): x is string => Boolean(x));
    const people = outside.agents.filter((a) => affected.includes(a.teamLeadId));
    const achieved = await this.achievedFor([...people, { id: staff.id, workType }], year, month, now);
    await this.locked(year, month, async (tx) => {
      if (oldLead && (event.kind === 'left' || event.kind === 'moved')) {
        const plan = (await tx.teamPlan.findMany({ where: { year, month } })).find((p) => p.teamLeadId === oldLead) ?? null;
        const row = event.kind === 'moved' ? event.before : agentValues((await tx.target.findMany({ where: { year, month, staffId: { in: [staff.id] } } }))[0] ?? null);
        if (plan && row) {
          const credit = addCredit(creditOf(plan), leaverCredit(row, achieved.get(staff.id) ?? {}));
          await tx.teamPlan.update({ where: { id: plan.id }, data: { leaverCredit: credit as Prisma.InputJsonObject } });
        }
      }
      if (newLead) {
        // Counted from today (or the joining day) in the new team; hand-set numbers from an old team do not follow.
        const existing = (await tx.target.findMany({ where: { year, month, staffId: { in: [staff.id] } } }))[0] ?? null;
        const fromDay = event.kind === 'joined' && !event.fromToday ? null : c.day;
        if (existing) {
          await tx.target.update({
            where: { id: existing.id },
            data: { splitFromDay: fromDay ?? existing.splitFromDay, handSetFields: event.kind === 'moved' ? [] : existing.handSetFields, updatedById: event.actorId },
          });
        } else if (fromDay) {
          await tx.target.create({ data: { staffId: staff.id, year, month, splitFromDay: fromDay, createdById: event.actorId } });
        }
      }
      const state = await this.loadState(tx, year, month, now, outside.workingDays);
      await this.respreadTeamsIn(tx, state, affected, achieved, event.actorId, `staff_${event.kind}`);
    });
  }

  /** After the CEO (POST/PATCH /targets) sets an agent's target by hand: re-spread the rest of the team. */
  async agentHandSet(staffId: string, year: number, month: number, actorId: string, now: Date = new Date()): Promise<void> {
    if (this.isPast(year, month, now)) return;
    const outside = await this.loadState(this.prisma, year, month, now);
    const agent = outside.agents.find((a) => a.id === staffId);
    if (!agent || !outside.company) return;
    const team = outside.agents.filter((a) => a.teamLeadId === agent.teamLeadId);
    const achieved = await this.achievedFor(team, year, month, now);
    await this.locked(year, month, async (tx) => {
      const state = await this.loadState(tx, year, month, now, outside.workingDays);
      await this.respreadTeamsIn(tx, state, [agent.teamLeadId], achieved, actorId, 'hand_set');
    });
  }

  // ----------------------------------------------------- hand changes (2)

  /**
   * The Manager's team numbers (PUT /manager/targets/split). A number that
   * changes becomes "set by hand"; empty = back to automatic. The hand-set
   * numbers of the Manager's teams may not add up to more than their share
   * of the CEO's plan; the rest of the share is spread over the other teams.
   */
  async saveTeamValues(actor: Actor, year: number, month: number, rows: unknown, allowedLeadIds: string[], now: Date = new Date()): Promise<{ created: number; updated: number; unchanged: number }> {
    if (actor.role !== 'manager') throw new ForbiddenException('A Manager splits the plan for their own teams');
    this.assertNotPast(year, month, now);
    if (!Array.isArray(rows) || rows.length === 0) throw new BadRequestException('rows must list the teams to save');
    if (rows.length > 100) throw new BadRequestException('At most 100 teams at a time');
    const allowed = new Set(allowedLeadIds);
    const parsed = (rows as Array<Record<string, unknown>>).map((row) => {
      const teamLeadId = typeof row?.teamLeadId === 'string' ? row.teamLeadId : '';
      if (!allowed.has(teamLeadId)) throw new ForbiddenException('Every row must be a team in your reporting tree');
      const values: Partial<Record<PlanMetricKey, number | null>> = {};
      for (const k of PLAN_METRICS) {
        const v = parseCount(row[k], k);
        if (v !== undefined) values[k] = v;
      }
      return { teamLeadId, values };
    });
    const outside = await this.loadState(this.prisma, year, month, now);
    const groupKey = outside.teams.find((t) => t.id === parsed[0].teamLeadId)?.groupKey ?? NO_MANAGER;
    const groupLeadIds = outside.teams.filter((t) => t.groupKey === groupKey).map((t) => t.id);
    const achieved = await this.achievedFor(outside.agents.filter((a) => groupLeadIds.includes(a.teamLeadId)), year, month, now);
    return this.locked(year, month, async (tx) => {
      const state = await this.loadState(tx, year, month, now, outside.workingDays);
      const company = state.company ? valuesOf(state.company) : null;
      const touched = new Set<PlanMetricKey>();
      const next = new Map<string, { values: PlanValues; hand: Set<string>; changed: PlanMetricKey[] }>();
      for (const row of parsed) {
        const team = state.teams.find((t) => t.id === row.teamLeadId);
        const before = valuesOf(team?.plan);
        const values = { ...before };
        const hand = new Set(team?.plan?.handSetFields ?? []);
        const changed: PlanMetricKey[] = [];
        for (const [k, v] of Object.entries(row.values) as [PlanMetricKey, number | null][]) {
          if (v === null) {
            // Empty: back to automatic (or no number when the CEO set none).
            if (hand.has(k)) hand.delete(k);
            if (company?.[k] === null || company === null) values[k] = null;
          } else if (v !== before[k] || hand.has(k)) {
            values[k] = v;
            hand.add(k);
          }
          if (values[k] !== before[k] || hand.has(k) !== Boolean(team?.plan?.handSetFields.includes(k))) {
            changed.push(k);
            touched.add(k);
          }
        }
        next.set(row.teamLeadId, { values, hand, changed });
      }
      // Hand-set numbers may not add up to more than the Manager's share.
      const shares: Partial<Record<PlanMetricKey, number | null>> = {};
      for (const k of touched) {
        shares[k] = this.groupShare(state, groupKey, k);
        if (!company || company[k] === null) continue;
        const group = state.teams.filter((t) => t.groupKey === groupKey);
        const share = shares[k] ?? 0;
        const handSum = group.reduce((sum, t) => {
          const n = next.get(t.id);
          if (n) return sum + (n.hand.has(k) ? (n.values[k] ?? 0) : 0);
          return sum + (t.plan?.handSetFields.includes(k) ? (numberOrNull(t.plan?.[k]) ?? 0) : 0);
        }, 0);
        if (handSum > share) {
          throw new BadRequestException(`${PLAN_METRIC_LABEL[k]}: the teams' numbers set by hand add up to ${handSum}, more than your share of the CEO's plan (${share}). Lower one, or reset it to automatic.`);
        }
      }
      let created = 0;
      let updated = 0;
      let unchanged = 0;
      for (const row of parsed) {
        const team = state.teams.find((t) => t.id === row.teamLeadId)!;
        const n = next.get(row.teamLeadId)!;
        if (!n.changed.length) {
          unchanged += 1;
          continue;
        }
        const before = valuesOf(team.plan);
        const v = n.values;
        const handList = [...n.hand].filter(isPlanMetric);
        if (team.plan) {
          await tx.teamPlan.update({
            where: { id: team.plan.id },
            data: {
              registered: v.registered,
              paid: v.paid,
              businessesSignedUp: v.businessesSignedUp,
              vacancies: v.vacancies,
              interviewsDone: v.interviewsDone,
              placed: v.placed,
              leftWithin30: v.leftWithin30,
              repeatBusinesses: v.repeatBusinesses,
              handSetFields: handList,
              setByStaffId: actor.id,
            },
          });
          updated += 1;
        } else {
          await tx.teamPlan.create({
            data: {
              teamLeadId: team.id,
              year,
              month,
              registered: v.registered,
              paid: v.paid,
              businessesSignedUp: v.businessesSignedUp,
              vacancies: v.vacancies,
              interviewsDone: v.interviewsDone,
              placed: v.placed,
              leftWithin30: v.leftWithin30,
              repeatBusinesses: v.repeatBusinesses,
              handSetFields: handList,
              setByStaffId: actor.id,
            },
          });
          created += 1;
        }
        await this.audit.log(
          {
            actorId: actor.id,
            action: team.plan ? 'team_plan.updated' : 'team_plan.set',
            entityType: 'team_plan',
            entityCode: `${team.code}:${monthKey(year, month)}`,
            before: team.plan ? { ...before, handSet: team.plan.handSetFields } : null,
            after: { ...v, handSet: [...n.hand] },
            changedFields: n.changed,
          },
          tx,
        );
      }
      // Without a CEO plan there is nothing automatic: the numbers typed stay as they are.
      if (touched.size && state.company) {
        const reloaded = await this.loadState(tx, year, month, now, outside.workingDays);
        await this.respreadGroupIn(tx, reloaded, groupKey, [...touched], achieved, actor.id, 'team_hand_set', shares);
      }
      return { created, updated, unchanged };
    });
  }

  /**
   * Agents' numbers set by hand (PUT /manager/targets, PUT /team-lead/targets).
   * A number that changes becomes "set by hand"; empty = back to automatic.
   * The hand-set numbers of a team's agents may not add up to more than the
   * team's number; the rest is spread over the team's other agents.
   */
  async saveAgentValues(actor: Actor, year: number, month: number, rows: unknown, allowedAgentIds: string[], now: Date = new Date()): Promise<{ created: number; updated: number; skipped: number }> {
    this.assertNotPast(year, month, now);
    if (!Array.isArray(rows) || rows.length === 0) throw new BadRequestException('rows must list the targets to save');
    if (rows.length > 200) throw new BadRequestException('At most 200 rows at a time');
    const allowed = new Set(allowedAgentIds);
    const parsed = (rows as Array<Record<string, unknown>>).map((r) => {
      const staffId = typeof r?.staffId === 'string' ? r.staffId : '';
      if (!allowed.has(staffId)) throw new ForbiddenException(actor.role === 'team_lead' ? 'Every row must be an agent in your team' : 'Every row must be an agent in your teams');
      const values: Partial<Record<AgentField, number | null>> = {};
      for (const f of SPLIT_AGENT_FIELDS) {
        const v = parseCount(r[f], f);
        if (v !== undefined) values[f] = v;
      }
      return { staffId, values };
    });
    const outside = await this.loadState(this.prisma, year, month, now);
    const leadIds = [...new Set(parsed.map((p) => outside.agents.find((a) => a.id === p.staffId)?.teamLeadId).filter((x): x is string => Boolean(x)))];
    const achieved = await this.achievedFor(outside.agents.filter((a) => leadIds.includes(a.teamLeadId)), year, month, now);
    return this.locked(year, month, async (tx) => {
      const state = await this.loadState(tx, year, month, now, outside.workingDays);
      const next = new Map<string, { values: Record<AgentField, number | null>; hand: Set<string>; changed: AgentField[] }>();
      for (const row of parsed) {
        const agent = state.agents.find((a) => a.id === row.staffId);
        if (!agent) throw new BadRequestException('Targets are set only for active call and field agents in a team (not owner accounts)');
        const team = state.teams.find((t) => t.id === agent.teamLeadId);
        const before = agentValues(agent.target);
        const values = { ...before };
        const hand = new Set(agent.target?.handSetFields ?? []);
        const changed: AgentField[] = [];
        for (const [f, v] of Object.entries(row.values) as [AgentField, number | null][]) {
          const splitField = FIELD_WORK_TYPE[f] === agent.workType;
          if (v === null) {
            hand.delete(f);
            if (!splitField || numberOrNull(team?.plan?.[METRIC_OF_FIELD[f]]) === null) values[f] = null;
          } else if (v !== before[f] || hand.has(f)) {
            values[f] = v;
            if (splitField) hand.add(f);
          }
          if (values[f] !== before[f] || hand.has(f) !== Boolean(agent.target?.handSetFields.includes(f))) changed.push(f);
        }
        next.set(agent.id, { values, hand, changed });
      }
      // Per team and field: the hand-set agents may not add up to more than the team's number.
      for (const leadId of leadIds) {
        const team = state.teams.find((t) => t.id === leadId);
        const credit = creditOf(team?.plan ?? null);
        for (const f of SPLIT_AGENT_FIELDS) {
          const metric = METRIC_OF_FIELD[f];
          const teamValue = numberOrNull(team?.plan?.[metric]);
          if (teamValue === null) continue;
          const members = state.agents.filter((a) => a.teamLeadId === leadId && a.workType === FIELD_WORK_TYPE[f]);
          if (!members.some((a) => next.get(a.id)?.changed.includes(f))) continue;
          const handSum = members.reduce((sum, a) => {
            const n = next.get(a.id);
            if (n) return sum + (n.hand.has(f) ? (n.values[f] ?? 0) : 0);
            return sum + (a.target?.handSetFields.includes(f) ? (a.target[f] ?? 0) : 0);
          }, 0);
          const room = teamValue - (credit[metric] ?? 0);
          if (handSum > room) {
            const name = team?.teamName ?? `${team?.name ?? 'the'}'s team`;
            throw new BadRequestException(`${AGENT_FIELD_LABEL[f]}: the agents' numbers set by hand add up to ${handSum}, more than ${name}'s ${room}. Lower one, or reset it to automatic.`);
          }
        }
      }
      let created = 0;
      let updated = 0;
      let skipped = 0;
      for (const row of parsed) {
        const agent = state.agents.find((a) => a.id === row.staffId)!;
        const n = next.get(agent.id)!;
        if (!n.changed.length) continue;
        const v = n.values;
        const handList = [...n.hand].filter(isAgentField);
        if (SPLIT_AGENT_FIELDS.every((f) => v[f] === null) && !agent.target) {
          skipped += 1;
          continue;
        }
        if (agent.target) {
          await tx.target.update({
            where: { id: agent.target.id },
            data: {
              candidatesActivated: v.candidatesActivated,
              vacanciesCaptured: v.vacanciesCaptured,
              placementsClosed: v.placementsClosed,
              repeatBusinesses: v.repeatBusinesses,
              handSetFields: handList,
              updatedById: actor.id,
            },
          });
          updated += 1;
        } else {
          await tx.target.create({
            data: {
              staffId: agent.id,
              year,
              month,
              candidatesActivated: v.candidatesActivated,
              vacanciesCaptured: v.vacanciesCaptured,
              placementsClosed: v.placementsClosed,
              repeatBusinesses: v.repeatBusinesses,
              handSetFields: handList,
              createdById: actor.id,
            },
          });
          created += 1;
        }
        await this.audit.log(
          {
            actorId: actor.id,
            action: agent.target ? 'target.update' : 'target.create',
            entityType: 'target',
            entityCode: agent.target?.id ?? `${agent.code}:${monthKey(year, month)}`,
            before: agent.target ? { ...agentValues(agent.target), handSet: agent.target.handSetFields } : null,
            after: { staffCode: agent.code, year, month, ...v, handSet: handList, by: actor.role },
            changedFields: n.changed,
          },
          tx,
        );
      }
      const reloaded = await this.loadState(tx, year, month, now, outside.workingDays);
      if (state.company) await this.respreadTeamsIn(tx, reloaded, leadIds, achieved, actor.id, 'agent_hand_set');
      return { created, updated, skipped };
    });
  }

  /**
   * "Reset to automatic": clears the hand-set mark of one value (or a whole
   * row) and splits it again. kind 'team' (Manager only) or 'agent'.
   */
  async reset(
    actor: Actor,
    input: { year: number; month: number; kind: unknown; id: unknown; key?: unknown },
    scope: { leadIds: string[]; agentIds: string[] },
    now: Date = new Date(),
  ): Promise<{ reset: string[] }> {
    const { year, month } = input;
    this.assertNotPast(year, month, now);
    const id = typeof input.id === 'string' ? input.id : '';
    const kind = input.kind;
    if (kind !== 'team' && kind !== 'agent') throw new BadRequestException("kind must be 'team' or 'agent'");
    if (kind === 'team' && actor.role !== 'manager') throw new ForbiddenException("Only the Manager resets a team's numbers");
    if (kind === 'team' && !scope.leadIds.includes(id)) throw new ForbiddenException('That team is not in your reporting tree');
    if (kind === 'agent' && !scope.agentIds.includes(id)) throw new ForbiddenException(actor.role === 'team_lead' ? 'Not an agent in your team' : 'Not an agent in your teams');
    const key = input.key === undefined || input.key === null || input.key === '' ? null : input.key;
    if (key !== null && !(kind === 'team' ? isPlanMetric(key) : isAgentField(key))) throw new BadRequestException(`key must be one of: ${(kind === 'team' ? PLAN_METRICS : SPLIT_AGENT_FIELDS).join(', ')}`);
    const outside = await this.loadState(this.prisma, year, month, now);
    const leadId = kind === 'team' ? id : outside.agents.find((a) => a.id === id)?.teamLeadId;
    if (!leadId) throw new NotFoundException('Not an agent in a team this month');
    const groupKey = outside.teams.find((t) => t.id === leadId)?.groupKey ?? NO_MANAGER;
    const lookAt = kind === 'team' ? outside.teams.filter((t) => t.groupKey === groupKey).map((t) => t.id) : [leadId];
    const achieved = await this.achievedFor(outside.agents.filter((a) => lookAt.includes(a.teamLeadId)), year, month, now);
    return this.locked(year, month, async (tx) => {
      const state = await this.loadState(tx, year, month, now, outside.workingDays);
      let cleared: string[] = [];
      if (kind === 'team') {
        const team = state.teams.find((t) => t.id === id);
        if (!team?.plan) return { reset: [] };
        cleared = team.plan.handSetFields.filter((k) => key === null || k === key);
        if (!cleared.length) return { reset: [] };
        const noPlan = (k: string) => !state.company || state.company[k as PlanMetricKey] === null;
        await tx.teamPlan.update({
          where: { id: team.plan.id },
          data: {
            handSetFields: team.plan.handSetFields.filter((k) => !cleared.includes(k)),
            // A metric the CEO set no number for has no automatic number: it is emptied.
            registered: cleared.includes('registered') && noPlan('registered') ? null : team.plan.registered,
            paid: cleared.includes('paid') && noPlan('paid') ? null : team.plan.paid,
            businessesSignedUp: cleared.includes('businessesSignedUp') && noPlan('businessesSignedUp') ? null : team.plan.businessesSignedUp,
            vacancies: cleared.includes('vacancies') && noPlan('vacancies') ? null : team.plan.vacancies,
            interviewsDone: cleared.includes('interviewsDone') && noPlan('interviewsDone') ? null : team.plan.interviewsDone,
            placed: cleared.includes('placed') && noPlan('placed') ? null : team.plan.placed,
            leftWithin30: cleared.includes('leftWithin30') && noPlan('leftWithin30') ? null : team.plan.leftWithin30,
            repeatBusinesses: cleared.includes('repeatBusinesses') && noPlan('repeatBusinesses') ? null : team.plan.repeatBusinesses,
          },
        });
        await this.audit.log(
          { actorId: actor.id, action: 'target_split.reset', entityType: 'team_plan', entityCode: `${team.code}:${monthKey(year, month)}`, before: { handSet: team.plan.handSetFields }, after: { reset: cleared }, changedFields: cleared },
          tx,
        );
        const reloaded = await this.loadState(tx, year, month, now, outside.workingDays);
        await this.respreadGroupIn(tx, reloaded, groupKey, cleared.filter(isPlanMetric), achieved, actor.id, 'reset');
      } else {
        const agent = state.agents.find((a) => a.id === id);
        if (!agent?.target) return { reset: [] };
        cleared = agent.target.handSetFields.filter((k) => key === null || k === key);
        if (!cleared.length) return { reset: [] };
        const team = state.teams.find((t) => t.id === agent.teamLeadId);
        const noTeamNumber = (f: string) => !isAgentField(f) || FIELD_WORK_TYPE[f] !== agent.workType || numberOrNull(team?.plan?.[METRIC_OF_FIELD[f]]) === null;
        const t = agent.target;
        await tx.target.update({
          where: { id: t.id },
          data: {
            handSetFields: t.handSetFields.filter((k) => !cleared.includes(k)),
            candidatesActivated: cleared.includes('candidatesActivated') && noTeamNumber('candidatesActivated') ? null : t.candidatesActivated,
            vacanciesCaptured: cleared.includes('vacanciesCaptured') && noTeamNumber('vacanciesCaptured') ? null : t.vacanciesCaptured,
            placementsClosed: cleared.includes('placementsClosed') && noTeamNumber('placementsClosed') ? null : t.placementsClosed,
            repeatBusinesses: cleared.includes('repeatBusinesses') && noTeamNumber('repeatBusinesses') ? null : t.repeatBusinesses,
            updatedById: actor.id,
          },
        });
        await this.audit.log(
          { actorId: actor.id, action: 'target_split.reset', entityType: 'target', entityCode: t.id, before: { staffCode: agent.code, handSet: t.handSetFields }, after: { reset: cleared }, changedFields: cleared },
          tx,
        );
        const reloaded = await this.loadState(tx, year, month, now, outside.workingDays);
        await this.respreadTeamsIn(tx, reloaded, [agent.teamLeadId], achieved, actor.id, 'reset');
      }
      return { reset: cleared };
    });
  }

  /**
   * "Transfer target" (spec 4): moves what `from` has not reached yet (target
   * − done, per field of their work type) to `to` (same work type, in the
   * actor's scope). Both values become hand-set. Between two teams of the
   * same Manager the teams' numbers move too (and become hand-set).
   */
  async transfer(
    actor: Actor,
    input: { year: number; month: number; fromStaffId: unknown; toStaffId: unknown },
    inScope: (staffId: string, opts: { allowLeft: boolean }) => Promise<boolean>,
    now: Date = new Date(),
  ): Promise<{ moved: Partial<Record<AgentField, number>>; from: string; to: string }> {
    const { year, month } = input;
    this.assertNotPast(year, month, now);
    const fromId = typeof input.fromStaffId === 'string' ? input.fromStaffId : '';
    const toId = typeof input.toStaffId === 'string' ? input.toStaffId : '';
    if (!fromId || !toId) throw new BadRequestException('Pick the agent to transfer from and the agent who receives it');
    if (fromId === toId) throw new BadRequestException('Pick two different agents');
    const [from, to] = await Promise.all([
      this.prisma.staff.findUnique({ where: { id: fromId }, select: { id: true, code: true, name: true, role: true, status: true, isOwnerAccount: true, teamLeadId: true, reportsToId: true, reportsTo: { select: { role: true } } } }),
      this.prisma.staff.findUnique({ where: { id: toId }, select: { id: true, code: true, name: true, role: true, status: true, isOwnerAccount: true } }),
    ]);
    if (!from || !to) throw new NotFoundException('Staff account not found');
    const type = workTypeOf(from.role);
    if (!type) throw new BadRequestException('Targets move only between call or field agents');
    if (!(await inScope(from.id, { allowLeft: true }))) throw new ForbiddenException(actor.role === 'team_lead' ? 'Not an agent in your team' : 'Not an agent in your teams');
    if (!(await inScope(to.id, { allowLeft: false }))) throw new ForbiddenException(actor.role === 'team_lead' ? 'The receiving agent must be in your team' : 'The receiving agent must be in your teams');
    if (workTypeOf(to.role) !== type) throw new BadRequestException(`The receiving agent must be a ${type} agent too`);
    if (to.status === 'deactivated' || to.isOwnerAccount) throw new BadRequestException('The receiving agent must be active and not an owner account');
    const outside = await this.loadState(this.prisma, year, month, now);
    const receiver = outside.agents.find((a) => a.id === to.id);
    if (!receiver) throw new BadRequestException('The receiving agent is not in a team this month');
    const achieved = await this.achievedFor([{ id: from.id, workType: type }], year, month, now);
    const fromLead = outside.agents.find((a) => a.id === from.id)?.teamLeadId ?? teamLeadOf(from);
    const affected = [...new Set([fromLead, receiver.teamLeadId].filter((x): x is string => Boolean(x)))];
    const teamAchieved = await this.achievedFor(outside.agents.filter((a) => affected.includes(a.teamLeadId)), year, month, now);
    return this.locked(year, month, async (tx) => {
      const state = await this.loadState(tx, year, month, now, outside.workingDays);
      const fromTarget = (await tx.target.findMany({ where: { year, month, staffId: { in: [from.id] } } }))[0] ?? null;
      const moved = unreached(agentValues(fromTarget), achieved.get(from.id) ?? {}, type);
      if (!fromTarget || !Object.keys(moved).length) throw new BadRequestException(`Nothing left to transfer: ${from.name} has no target still to reach this month`);
      const recv = state.agents.find((a) => a.id === to.id)!;
      const fv = agentValues(fromTarget);
      const tv = agentValues(recv.target);
      const fields = Object.keys(moved) as AgentField[];
      for (const f of fields) {
        fv[f] = (fv[f] ?? 0) - moved[f]!;
        tv[f] = (tv[f] ?? 0) + moved[f]!;
      }
      const fromHand = [...new Set([...fromTarget.handSetFields, ...fields])];
      const toHand = [...new Set([...(recv.target?.handSetFields ?? []), ...fields])];
      await tx.target.update({
        where: { id: fromTarget.id },
        data: { candidatesActivated: fv.candidatesActivated, vacanciesCaptured: fv.vacanciesCaptured, placementsClosed: fv.placementsClosed, repeatBusinesses: fv.repeatBusinesses, handSetFields: fromHand, updatedById: actor.id },
      });
      if (recv.target) {
        await tx.target.update({
          where: { id: recv.target.id },
          data: { candidatesActivated: tv.candidatesActivated, vacanciesCaptured: tv.vacanciesCaptured, placementsClosed: tv.placementsClosed, repeatBusinesses: tv.repeatBusinesses, handSetFields: toHand, updatedById: actor.id },
        });
      } else {
        await tx.target.create({
          data: { staffId: to.id, year, month, candidatesActivated: tv.candidatesActivated, vacanciesCaptured: tv.vacanciesCaptured, placementsClosed: tv.placementsClosed, repeatBusinesses: tv.repeatBusinesses, handSetFields: toHand, createdById: actor.id },
        });
      }
      // Between two teams: the teams' numbers move with it.
      if (fromLead && fromLead !== recv.teamLeadId) {
        const fromTeam = state.teams.find((t) => t.id === fromLead)?.plan ?? null;
        const toTeam = state.teams.find((t) => t.id === recv.teamLeadId)?.plan ?? null;
        for (const [plan, sign] of [
          [fromTeam, -1],
          [toTeam, 1],
        ] as const) {
          if (!plan) continue;
          const v = valuesOf(plan);
          const metrics = fields.map((f) => METRIC_OF_FIELD[f]).filter((m) => v[m] !== null);
          if (!metrics.length) continue;
          for (const f of fields) {
            const m = METRIC_OF_FIELD[f];
            if (v[m] !== null) v[m] = Math.max(0, (v[m] as number) + sign * moved[f]!);
          }
          const planHand = Array.from(new Set(plan.handSetFields.concat(metrics)));
          await tx.teamPlan.update({
            where: { id: plan.id },
            data: { paid: v.paid, vacancies: v.vacancies, placed: v.placed, repeatBusinesses: v.repeatBusinesses, handSetFields: planHand },
          });
        }
      }
      await this.audit.log(
        {
          actorId: actor.id,
          action: 'target.transferred',
          entityType: 'target',
          entityCode: fromTarget.id,
          before: { from: from.code, to: to.code, fromValues: agentValues(fromTarget), toValues: agentValues(recv.target) },
          after: { from: from.code, to: to.code, moved, fromValues: fv, toValues: tv, by: actor.role },
          changedFields: fields,
        },
        tx,
      );
      const reloaded = await this.loadState(tx, year, month, now, outside.workingDays);
      if (reloaded.company) await this.respreadTeamsIn(tx, reloaded, affected, teamAchieved, actor.id, 'transfer');
      return { moved, from: from.id, to: to.id };
    });
  }

  // ------------------------------------------------------------- backfill

  /**
   * One-off (spec 7): every current or future month with a CEO plan and no
   * automatic split yet is split once, as the CEO who set the plan. Numbers
   * typed before (marked hand-set by the migration) are kept.
   */
  async backfill(now: Date = new Date()): Promise<SplitRunSummary[]> {
    const c = this.currentMonth(now);
    const plans = await this.prisma.companyPlan.findMany({
      where: { OR: [{ year: { gt: c.year } }, { year: c.year, month: { gte: c.month } }] },
      orderBy: [{ year: 'asc' }, { month: 'asc' }],
    });
    const out: SplitRunSummary[] = [];
    for (const p of plans) {
      const done = await this.prisma.auditLog.count({ where: { action: 'target_split.run', entityType: 'target_split', entityCode: monthKey(p.year, p.month) } });
      if (done) continue;
      const run = await this.splitMonth(p.year, p.month, p.setByStaffId, 'backfill', now);
      if (run) {
        out.push(run);
        this.logger.log(`Target split backfill ${monthKey(p.year, p.month)}: ${run.teamRowsChanged} team and ${run.agentRowsChanged} agent rows`);
      }
    }
    return out;
  }

  // ------------------------------------------------------------- reading

  /**
   * What MG-Targets and T-Targets show next to the numbers: per team its
   * hand-set metrics, what its leavers reached, and the flags ("No field
   * agents in Team X for placements", hand-set over the total); per agent its
   * hand-set fields. Reads only.
   */
  async readMarks(year: number, month: number, leadIds: string[], now: Date = new Date()) {
    const state = await this.loadState(this.prisma, year, month, now);
    const nameOf = (id: string) => {
      const t = state.teams.find((x) => x.id === id);
      return t?.teamName ?? (t ? `${t.name}'s team` : 'the team');
    };
    const teams = state.teams
      .filter((t) => leadIds.includes(t.id))
      .map((t) => {
        const flags: string[] = [];
        const agents = state.agents.filter((a) => a.teamLeadId === t.id);
        const credit = creditOf(t.plan);
        for (const metric of PLAN_METRICS) {
          const field = AGENT_TARGET_FIELD[metric];
          const value = numberOrNull(t.plan?.[metric]);
          if (!field || value === null) continue;
          const eligible = agents.filter((a) => a.workType === FIELD_WORK_TYPE[field]);
          if (!eligible.length) {
            if (value > 0) flags.push(flagText({ kind: 'no_agents', teamId: t.id, metric, workType: FIELD_WORK_TYPE[field], amount: value }, nameOf));
            continue;
          }
          const sum = eligible.reduce((s, a) => s + (a.target?.[field] ?? 0), 0) + (credit[metric] ?? 0);
          if (sum > value) flags.push(flagText({ kind: 'over', level: 'team', teamId: t.id, metric }, nameOf));
        }
        return { teamLeadId: t.id, groupKey: t.groupKey, handSet: (t.plan?.handSetFields ?? []).filter(isPlanMetric), leaverCredit: credit, flags };
      });
    const agents = state.agents
      .filter((a) => leadIds.includes(a.teamLeadId))
      .map((a) => ({ staffId: a.id, teamLeadId: a.teamLeadId, workType: a.workType, handSet: (a.target?.handSetFields ?? []).filter(isAgentField), splitFromDay: a.target?.splitFromDay ?? null }));
    return { automatic: Boolean(state.company), teams, agents };
  }
}
