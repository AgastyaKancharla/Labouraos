import { AGENT_TARGET_FIELD, PLAN_METRICS, PlanMetricKey, PlanValues, emptyPlan } from './company-plan.service';

/**
 * The maths of the automatic target split (Master Guide rev 195, "Targets
 * split automatically", 17 Nov). Pure functions, no database: the service
 * (target-split.service.ts) loads the people and numbers and writes the result.
 *
 *   CEO plan (CompanyPlan) → each Manager's share, by the agents in their tree
 *   Manager's share → each team (TeamPlan), by the agents in the team
 *   team → each agent (Target), by work type: paid and vacancies to call
 *   agents, placements and repeat businesses to field agents. The other four
 *   metrics stay team targets only.
 *
 * Whole numbers by the largest-remainder method, so every level adds up
 * exactly. A value set by hand is kept and only the rest is spread. What an
 * agent has already done this month is a floor: nobody's target is spread
 * below it. An agent counts by the working days they are in the month (a
 * joiner by the working days left), so weights are whole numbers of days.
 */

export type AgentField = 'candidatesActivated' | 'vacanciesCaptured' | 'placementsClosed' | 'repeatBusinesses';
export const SPLIT_AGENT_FIELDS: readonly AgentField[] = ['candidatesActivated', 'vacanciesCaptured', 'placementsClosed', 'repeatBusinesses'];
export type WorkType = 'call' | 'field';

/** Which agents carry each agent target (17 Nov): call agents paid + vacancies, field agents placements + repeat businesses. */
export const FIELD_WORK_TYPE: Record<AgentField, WorkType> = {
  candidatesActivated: 'call',
  vacanciesCaptured: 'call',
  placementsClosed: 'field',
  repeatBusinesses: 'field',
};

/** The plan metric each agent field adds up to. */
export const METRIC_OF_FIELD: Record<AgentField, PlanMetricKey> = {
  candidatesActivated: 'paid',
  vacanciesCaptured: 'vacancies',
  placementsClosed: 'placed',
  repeatBusinesses: 'repeatBusinesses',
};

export const AGENT_FIELD_LABEL: Record<AgentField, string> = {
  candidatesActivated: 'Paid registrations',
  vacanciesCaptured: 'Vacancies',
  placementsClosed: 'Placements',
  repeatBusinesses: 'Repeat businesses',
};

/** Money-free names of the plan metrics, for flags and messages (a Manager's answers have rupee text stripped). */
export const SPLIT_METRIC_LABEL: Record<PlanMetricKey, string> = {
  registered: 'Registrations',
  paid: 'Paid registrations',
  businessesSignedUp: 'Businesses signed up',
  vacancies: 'Vacancies',
  interviewsDone: 'Interviews',
  placed: 'Placements',
  leftWithin30: 'Left within 30 days',
  repeatBusinesses: 'Repeat businesses',
};

export function workTypeOf(role: string): WorkType | null {
  return role === 'call_agent' ? 'call' : role === 'field_agent' ? 'field' : null;
}

/** The agent fields an agent of this work type carries. */
export function fieldsFor(type: WorkType): AgentField[] {
  return SPLIT_AGENT_FIELDS.filter((f) => FIELD_WORK_TYPE[f] === type);
}

export function isAgentField(value: unknown): value is AgentField {
  return typeof value === 'string' && (SPLIT_AGENT_FIELDS as readonly string[]).includes(value);
}

export function isPlanMetric(value: unknown): value is PlanMetricKey {
  return typeof value === 'string' && (PLAN_METRICS as readonly string[]).includes(value);
}

// ------------------------------------------------------------- allocation

export interface AllocItem {
  /** Whole number (working days); items with a bigger weight get more. */
  weight: number;
  /** The least this item may get (what it has already done). */
  floor?: number;
  /** Set by hand: kept as it is, never spread. */
  fixed?: number;
}

export interface Allocation {
  values: number[];
  /** The hand-set values and floors add up to more than the total: free items get their floor only, and the level adds up to more than its parent. */
  over: boolean;
  /** Every item is set by hand and they add up to less than the total: this much is given to nobody. */
  left: number;
}

/**
 * Split `total` (a whole number) over the items. Fixed items keep their
 * value; the rest is shared by weight with the largest-remainder method,
 * never below an item's floor (an item whose share would be below its floor
 * gets the floor and the others share what is left). All weights zero: equal
 * shares. Exact: the values add up to `total` unless `over`.
 */
export function allocate(total: number, items: AllocItem[]): Allocation {
  const values = items.map((item) => (item.fixed !== undefined ? item.fixed : 0));
  const free = items.map((item, i) => (item.fixed === undefined ? i : -1)).filter((i) => i >= 0);
  const fixedSum = items.reduce((sum, item) => sum + (item.fixed ?? 0), 0);
  const floors = items.map((item) => Math.max(0, Math.floor(item.floor ?? 0)));
  const rest = total - fixedSum;
  const floorSum = free.reduce((sum, i) => sum + floors[i], 0);
  if (rest < floorSum) {
    for (const i of free) values[i] = floors[i];
    return { values, over: true, left: 0 };
  }
  if (!free.length) return { values, over: false, left: rest };
  const allZero = free.every((i) => !(items[i].weight > 0));
  const weight = (i: number) => (allZero ? 1 : Math.max(0, Math.floor(items[i].weight)));
  // Pin every item whose share falls below its floor at the floor; share the rest again.
  let active = [...free];
  let pinnedSum = 0;
  for (;;) {
    const w = active.reduce((sum, i) => sum + weight(i), 0);
    const left = rest - pinnedSum;
    const below = w > 0 ? active.filter((i) => left * weight(i) < floors[i] * w) : active.filter((i) => floors[i] > 0);
    if (!below.length) break;
    for (const i of below) {
      values[i] = floors[i];
      pinnedSum += floors[i];
    }
    active = active.filter((i) => !below.includes(i));
    if (!active.length) break;
  }
  const left = rest - pinnedSum;
  if (!active.length) {
    // Only reachable when every free item sits exactly at its floor: give what is left by weight.
    const extra = largestRemainder(left, free.map(weight));
    free.forEach((i, k) => (values[i] += extra[k]));
    return { values, over: false, left: 0 };
  }
  const shares = largestRemainder(left, active.map(weight));
  active.forEach((i, k) => (values[i] = shares[k]));
  return { values, over: false, left: 0 };
}

/**
 * Whole-number shares of `total` by whole-number weights: each gets the whole
 * part of its share and the units left go to the biggest remainders (the
 * earlier item on a tie). All weights zero: equal weights.
 */
export function largestRemainder(total: number, weights: number[]): number[] {
  if (!weights.length) return [];
  const w = weights.every((x) => !(x > 0)) ? weights.map(() => 1) : weights.map((x) => Math.max(0, Math.floor(x)));
  const sum = w.reduce((a, b) => a + b, 0);
  const t = Math.max(0, total);
  const base = w.map((x) => Math.floor((t * x) / sum));
  const remainders = w.map((x, i) => ({ i, r: (t * x) % sum }));
  let left = t - base.reduce((a, b) => a + b, 0);
  remainders.sort((a, b) => b.r - a.r || a.i - b.i);
  for (const { i } of remainders) {
    if (left <= 0) break;
    base[i] += 1;
    left -= 1;
  }
  return base;
}

// ------------------------------------------------------------- the levels

export interface SplitAgent {
  id: string;
  workType: WorkType;
  /** Working days this agent is in the team this month. */
  weight: number;
  /** Fields set by hand, with their value. */
  handSet: Partial<Record<AgentField, number>>;
  /** Done so far this month (a floor); empty for a month that has not started. */
  achieved: Partial<Record<AgentField, number>>;
}

export interface SplitTeam {
  id: string;
  /** The Manager the team is under, or NO_MANAGER. */
  groupKey: string;
  handSet: Partial<Record<PlanMetricKey, number>>;
  /** What agents who left this month had reached, per agent metric. */
  credit: Partial<Record<PlanMetricKey, number>>;
  agents: SplitAgent[];
}

export const NO_MANAGER = 'no_manager';

export type SplitFlag =
  | { kind: 'no_agents'; teamId: string; metric: PlanMetricKey; workType: WorkType; amount: number }
  | { kind: 'over'; level: 'team'; teamId: string; metric: PlanMetricKey }
  | { kind: 'over'; level: 'group'; groupKey: string; metric: PlanMetricKey }
  | { kind: 'over'; level: 'company'; metric: PlanMetricKey }
  | { kind: 'unassigned'; level: 'team'; teamId: string; metric: PlanMetricKey; amount: number }
  | { kind: 'unassigned'; level: 'group'; groupKey: string; metric: PlanMetricKey; amount: number };

export interface SplitResult {
  /** Each Manager's (or NO_MANAGER's) share per metric. */
  groups: Record<string, PlanValues>;
  teams: Record<string, PlanValues>;
  /** The agent fields of each agent's work type (null: no number). */
  agents: Record<string, Partial<Record<AgentField, number | null>>>;
  flags: SplitFlag[];
}

const teamWeight = (team: SplitTeam) => team.agents.reduce((sum, a) => sum + Math.max(0, a.weight), 0);

function eligible(team: SplitTeam, field: AgentField): SplitAgent[] {
  return team.agents.filter((a) => a.workType === FIELD_WORK_TYPE[field]);
}

/** The least a team can get for a metric: its hand-set value, else what its leavers reached plus its agents' hand-set values and what they have done. */
export function teamFloor(team: SplitTeam, metric: PlanMetricKey): number {
  const hand = team.handSet[metric];
  if (hand !== undefined) return hand;
  const field = AGENT_TARGET_FIELD[metric];
  if (!field) return 0;
  return (team.credit[metric] ?? 0) + eligible(team, field).reduce((sum, a) => sum + (a.handSet[field] ?? a.achieved[field] ?? 0), 0);
}

/**
 * A team's number for one agent metric spread over its agents of the right
 * work type (minus what its leavers reached). No such agent: the number stays
 * with the team and is flagged.
 */
export function spreadTeamMetric(team: SplitTeam, metric: PlanMetricKey, value: number | null, out: SplitResult): void {
  const field = AGENT_TARGET_FIELD[metric];
  if (!field) return;
  const agents = eligible(team, field);
  if (value === null) {
    for (const a of agents) (out.agents[a.id] ??= {})[field] = a.handSet[field] ?? null;
    return;
  }
  if (!agents.length) {
    if (value > 0) out.flags.push({ kind: 'no_agents', teamId: team.id, metric, workType: FIELD_WORK_TYPE[field], amount: value });
    return;
  }
  const alloc = allocate(
    value - (team.credit[metric] ?? 0),
    agents.map((a) => (a.handSet[field] !== undefined ? { weight: a.weight, fixed: a.handSet[field] } : { weight: a.weight, floor: a.achieved[field] ?? 0 })),
  );
  if (alloc.over) out.flags.push({ kind: 'over', level: 'team', teamId: team.id, metric });
  if (alloc.left > 0) out.flags.push({ kind: 'unassigned', level: 'team', teamId: team.id, metric, amount: alloc.left });
  agents.forEach((a, i) => ((out.agents[a.id] ??= {})[field] = alloc.values[i]));
}

/** A Manager's share of one metric spread over their teams (hand-set teams kept), then each team over its agents. */
export function spreadGroupMetric(groupKey: string, total: number | null, teams: SplitTeam[], metric: PlanMetricKey, out: SplitResult): void {
  if (total === null) {
    for (const t of teams) {
      (out.teams[t.id] ??= emptyPlan())[metric] = t.handSet[metric] ?? null;
      spreadTeamMetric(t, metric, out.teams[t.id][metric], out);
    }
    return;
  }
  const alloc = allocate(
    total,
    teams.map((t) => (t.handSet[metric] !== undefined ? { weight: teamWeight(t), fixed: t.handSet[metric] } : { weight: teamWeight(t), floor: teamFloor(t, metric) })),
  );
  if (alloc.over) out.flags.push({ kind: 'over', level: 'group', groupKey, metric });
  if (alloc.left > 0) out.flags.push({ kind: 'unassigned', level: 'group', groupKey, metric, amount: alloc.left });
  teams.forEach((t, i) => {
    (out.teams[t.id] ??= emptyPlan())[metric] = alloc.values[i];
    spreadTeamMetric(t, metric, alloc.values[i], out);
  });
}

export function emptyResult(): SplitResult {
  return { groups: {}, teams: {}, agents: {}, flags: [] };
}

/** Teams grouped by Manager, in a fixed order (Manager key, then team id) so the result never depends on load order. */
export function groupTeams(teams: SplitTeam[]): Map<string, SplitTeam[]> {
  const sorted = [...teams].sort((a, b) => (a.groupKey === b.groupKey ? a.id.localeCompare(b.id) : a.groupKey.localeCompare(b.groupKey)));
  const groups = new Map<string, SplitTeam[]>();
  for (const t of sorted) {
    const list = groups.get(t.groupKey) ?? [];
    list.push({ ...t, agents: [...t.agents].sort((a, b) => a.id.localeCompare(b.id)) });
    groups.set(t.groupKey, list);
  }
  return groups;
}

/**
 * The whole split of the CEO's plan: Managers' shares by the agents in their
 * trees (each agent by working days), teams' by their agents, agents' by work
 * type. A metric the CEO left empty: hand-set values stay, the rest is empty.
 */
export function splitPlan(plan: PlanValues, teams: SplitTeam[]): SplitResult {
  const out = emptyResult();
  const groups = groupTeams(teams);
  const keys = [...groups.keys()];
  for (const key of keys) out.groups[key] = emptyPlan();
  for (const metric of PLAN_METRICS) {
    const total = plan[metric];
    if (total === null) {
      for (const key of keys) spreadGroupMetric(key, null, groups.get(key)!, metric, out);
      continue;
    }
    if (!keys.length) continue;
    const alloc = allocate(
      total,
      keys.map((key) => {
        const list = groups.get(key)!;
        return { weight: list.reduce((sum, t) => sum + teamWeight(t), 0), floor: list.reduce((sum, t) => sum + teamFloor(t, metric), 0) };
      }),
    );
    if (alloc.over) out.flags.push({ kind: 'over', level: 'company', metric });
    keys.forEach((key, i) => {
      out.groups[key][metric] = alloc.values[i];
      spreadGroupMetric(key, alloc.values[i], groups.get(key)!, metric, out);
    });
  }
  return out;
}

// ------------------------------------------------------- leavers, transfer

/**
 * What a leaver had reached of each of their targets (kept with the team, so
 * only the unreached part is spread over the others): min(target, done).
 */
export function leaverCredit(values: Partial<Record<AgentField, number | null>>, achieved: Partial<Record<AgentField, number>>): Partial<Record<PlanMetricKey, number>> {
  const out: Partial<Record<PlanMetricKey, number>> = {};
  for (const field of SPLIT_AGENT_FIELDS) {
    const v = values[field];
    if (typeof v !== 'number') continue;
    out[METRIC_OF_FIELD[field]] = Math.min(v, Math.max(0, achieved[field] ?? 0));
  }
  return out;
}

export function addCredit(a: Partial<Record<PlanMetricKey, number>>, b: Partial<Record<PlanMetricKey, number>>): Partial<Record<PlanMetricKey, number>> {
  const out = { ...a };
  for (const [k, v] of Object.entries(b) as [PlanMetricKey, number][]) out[k] = (out[k] ?? 0) + v;
  return out;
}

/** The unreached part of each target (target − done, never below 0): what "Transfer target" moves. */
export function unreached(values: Partial<Record<AgentField, number | null>>, achieved: Partial<Record<AgentField, number>>, type: WorkType): Partial<Record<AgentField, number>> {
  const out: Partial<Record<AgentField, number>> = {};
  for (const field of fieldsFor(type)) {
    const v = values[field];
    if (typeof v !== 'number') continue;
    const left = Math.max(0, v - Math.max(0, achieved[field] ?? 0));
    if (left > 0) out[field] = left;
  }
  return out;
}

/** Working days from `fromDay` (day of month) to the end of the month. */
export function workingDaysFrom(workingDays: number[], fromDay: number): number {
  return workingDays.filter((d) => d >= fromDay).length;
}
