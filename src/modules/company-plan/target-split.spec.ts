import { PlanValues, emptyPlan } from './company-plan.service';
import {
  NO_MANAGER,
  SplitAgent,
  SplitTeam,
  addCredit,
  allocate,
  emptyResult,
  largestRemainder,
  leaverCredit,
  spreadGroupMetric,
  spreadTeamMetric,
  splitPlan,
  unreached,
  workingDaysFrom,
} from './target-split';

const DAYS = 26; // working days in a month
const call = (id: string, extra: Partial<SplitAgent> = {}): SplitAgent => ({ id, workType: 'call', weight: DAYS, handSet: {}, achieved: {}, ...extra });
const field = (id: string, extra: Partial<SplitAgent> = {}): SplitAgent => ({ id, workType: 'field', weight: DAYS, handSet: {}, achieved: {}, ...extra });
const team = (id: string, groupKey: string, agents: SplitAgent[], extra: Partial<SplitTeam> = {}): SplitTeam => ({ id, groupKey, handSet: {}, credit: {}, agents, ...extra });
const plan = (values: Partial<PlanValues>): PlanValues => ({ ...emptyPlan(), ...values });
const sum = (xs: Array<number | null | undefined>) => xs.reduce<number>((a, b) => a + (b ?? 0), 0);

describe('Automatic target split: the maths', () => {
  describe('largest remainder', () => {
    it.each([
      [100, [1, 1, 1]],
      [7, [3, 2, 2]],
      [1, [5, 5]],
      [0, [1, 2]],
      [99, [13, 0, 26, 7]],
    ])('shares %p over %p as whole numbers that add up exactly', (total, weights) => {
      const out = largestRemainder(total, weights);
      expect(sum(out)).toBe(total);
      out.forEach((v) => expect(Number.isInteger(v)).toBe(true));
    });

    it('gives the units left to the biggest remainders, the earlier one on a tie', () => {
      expect(largestRemainder(100, [1, 1, 1])).toEqual([34, 33, 33]);
      expect(largestRemainder(10, [1, 2])).toEqual([3, 7]);
    });

    it('shares equally when every weight is zero', () => {
      expect(largestRemainder(9, [0, 0, 0])).toEqual([3, 3, 3]);
    });
  });

  describe('allocate', () => {
    it('keeps a hand-set value and spreads only the rest', () => {
      expect(allocate(100, [{ weight: 1, fixed: 40 }, { weight: 1 }, { weight: 1 }])).toEqual({ values: [40, 30, 30], over: false, left: 0 });
    });

    it('never goes below a floor (done so far); the others share what is left', () => {
      const a = allocate(100, [{ weight: 1, floor: 70 }, { weight: 1, floor: 0 }, { weight: 1, floor: 0 }]);
      expect(a.values).toEqual([70, 15, 15]);
      expect(sum(a.values)).toBe(100);
    });

    it('says "over" when the hand-set values and floors add up to more than the total', () => {
      const a = allocate(50, [{ weight: 1, fixed: 40 }, { weight: 1, floor: 20 }]);
      expect(a.over).toBe(true);
      expect(a.values).toEqual([40, 20]);
    });

    it('says how much is given to nobody when every item is hand-set and they add up to less', () => {
      expect(allocate(50, [{ weight: 1, fixed: 20 }, { weight: 1, fixed: 10 }])).toEqual({ values: [20, 10], over: false, left: 20 });
    });
  });

  describe('the whole split', () => {
    it('one Manager with one team gets the whole plan; the agents add up exactly', () => {
      const r = splitPlan(plan({ paid: 100, placed: 10, registered: 400, leftWithin30: 4 }), [team('T1', 'M1', [call('a'), call('b'), call('c'), field('f')])]);
      expect(r.groups.M1).toMatchObject({ paid: 100, placed: 10, registered: 400, leftWithin30: 4 });
      expect(r.teams.T1).toMatchObject({ paid: 100, placed: 10, registered: 400, leftWithin30: 4, vacancies: null });
      expect(sum(['a', 'b', 'c'].map((id) => r.agents[id].candidatesActivated))).toBe(100);
      expect(r.agents.f.placementsClosed).toBe(10);
    });

    it('shares the plan by active agents: Managers, then teams, every level adds up exactly', () => {
      const teams = [
        team('T1', 'M1', [call('a1'), call('a2'), field('a3')]),
        team('T2', 'M1', [call('b1')]),
        team('T3', 'M2', [call('c1'), field('c2'), field('c3'), call('c4'), call('c5'), field('c6')]),
      ];
      const r = splitPlan(plan({ paid: 101, placed: 17, businessesSignedUp: 33 }), teams);
      // 4 agents under M1, 6 under M2.
      expect(r.groups.M1.paid! + r.groups.M2.paid!).toBe(101);
      expect(r.groups.M1.paid).toBe(40);
      expect(r.groups.M2.paid).toBe(61);
      expect(r.teams.T1.paid! + r.teams.T2.paid!).toBe(r.groups.M1.paid);
      expect(r.teams.T1.paid).toBe(30);
      expect(r.teams.T2.paid).toBe(10);
      expect(r.teams.T3.paid).toBe(61);
      for (const metric of ['paid', 'placed', 'businessesSignedUp'] as const) {
        expect(sum(Object.values(r.teams).map((t) => t[metric]))).toBe(plan({ paid: 101, placed: 17, businessesSignedUp: 33 })[metric]);
      }
      expect(sum(['a1', 'a2'].map((id) => r.agents[id].candidatesActivated))).toBe(30);
      expect(sum(['c1', 'c4', 'c5'].map((id) => r.agents[id].candidatesActivated))).toBe(61);
      expect(sum(['c2', 'c3', 'c6'].map((id) => r.agents[id].placementsClosed))).toBe(r.teams.T3.placed);
    });

    it('routes by work type: paid and vacancies to call agents, placements and repeat businesses to field agents; the rest stay team targets', () => {
      const r = splitPlan(plan({ paid: 10, vacancies: 6, placed: 4, repeatBusinesses: 2, registered: 50, interviewsDone: 20, businessesSignedUp: 8, leftWithin30: 1 }), [team('T', 'M', [call('c'), field('f')])]);
      expect(r.agents.c).toEqual({ candidatesActivated: 10, vacanciesCaptured: 6 });
      expect(r.agents.f).toEqual({ placementsClosed: 4, repeatBusinesses: 2 });
      expect(r.teams.T).toMatchObject({ registered: 50, interviewsDone: 20, businessesSignedUp: 8, leftWithin30: 1 });
    });

    it('a team without field agents keeps its placements and is flagged', () => {
      const r = splitPlan(plan({ placed: 10, paid: 20 }), [team('T1', 'M', [call('c1')]), team('T2', 'M', [field('f1')])]);
      expect(r.teams.T1.placed).toBe(5);
      expect(r.agents.c1).toEqual({ candidatesActivated: 10, vacanciesCaptured: null });
      expect(r.flags).toContainEqual({ kind: 'no_agents', teamId: 'T1', metric: 'placed', workType: 'field', amount: 5 });
      expect(r.flags).toContainEqual({ kind: 'no_agents', teamId: 'T2', metric: 'paid', workType: 'call', amount: 10 });
    });

    it('teams with no Manager still get their share as one more group', () => {
      const r = splitPlan(plan({ paid: 30 }), [team('T1', 'M', [call('a')]), team('T2', NO_MANAGER, [call('b'), call('c')])]);
      expect(r.groups[NO_MANAGER].paid).toBe(20);
      expect(r.groups.M.paid).toBe(10);
    });

    it('keeps hand-set team and agent values and re-spreads the rest over the others', () => {
      const teams = [
        team('T1', 'M', [call('a'), call('b'), call('c', { handSet: { candidatesActivated: 20 } })]),
        team('T2', 'M', [call('d'), call('e'), call('f')], { handSet: { paid: 10 } }),
      ];
      const r = splitPlan(plan({ paid: 100 }), teams);
      expect(r.teams.T2.paid).toBe(10);
      expect(r.teams.T1.paid).toBe(90);
      expect(r.agents.c.candidatesActivated).toBe(20);
      expect(r.agents.a.candidatesActivated! + r.agents.b.candidatesActivated!).toBe(70);
      expect(sum(['d', 'e', 'f'].map((id) => r.agents[id].candidatesActivated))).toBe(10);
    });

    it('a metric the CEO left empty: hand-set values stay, the rest is empty', () => {
      const r = splitPlan(plan({ paid: 10 }), [team('T', 'M', [call('a', { handSet: { vacanciesCaptured: 4 } }), call('b')], { handSet: { registered: 30 } })]);
      expect(r.teams.T.registered).toBe(30);
      expect(r.teams.T.vacancies).toBeNull();
      expect(r.agents.a.vacanciesCaptured).toBe(4);
      expect(r.agents.b.vacanciesCaptured).toBeNull();
    });

    it('a joiner counts by the working days left', () => {
      // b joined with 13 of 26 working days left: half a share.
      const r = splitPlan(plan({ paid: 50 }), [team('T', 'M', [call('a'), call('b', { weight: workingDaysFrom(Array.from({ length: 26 }, (_, i) => i + 1), 14) })])]);
      expect(r.agents.a.candidatesActivated).toBe(33);
      expect(r.agents.b.candidatesActivated).toBe(17);
    });

    it('what an agent has done is a floor', () => {
      const r = splitPlan(plan({ paid: 60 }), [team('T', 'M', [call('a', { achieved: { candidatesActivated: 45 } }), call('b'), call('c')])]);
      expect(r.agents.a.candidatesActivated).toBe(45);
      expect(r.agents.b.candidatesActivated! + r.agents.c.candidatesActivated!).toBe(15);
    });
  });

  describe('mid-month re-split and transfer', () => {
    it('a leaver: what they reached stays with the team, only the unreached part is spread over the others', () => {
      // Team of 3 with 100 paid: 34/33/33. c leaves having done 10 of 33.
      const credit = leaverCredit({ candidatesActivated: 33, vacanciesCaptured: null }, { candidatesActivated: 10 });
      expect(credit).toEqual({ paid: 10 });
      const t = team('T', 'M', [call('a'), call('b')], { credit: addCredit({}, credit) });
      const out = emptyResult();
      spreadTeamMetric(t, 'paid', 100, out);
      // 23 unreached spread over a and b on top of their 34 and 33 → 45 and 45.
      expect(out.agents.a.candidatesActivated! + out.agents.b.candidatesActivated!).toBe(90);
      expect(out.agents.a.candidatesActivated).toBe(45);
    });

    it('a joiner mid-month gets a share by working days left; nobody drops below what they have done', () => {
      const t = team('T', 'M', [call('a', { achieved: { candidatesActivated: 30 } }), call('b', { achieved: { candidatesActivated: 5 } }), call('j', { weight: 13 })]);
      const out = emptyResult();
      spreadTeamMetric(t, 'paid', 100, out);
      expect(out.agents.a.candidatesActivated).toBe(40);
      expect(out.agents.b.candidatesActivated).toBe(40);
      expect(out.agents.j.candidatesActivated).toBe(20);
    });

    it("a Manager's hand change: the rest of their share is spread over the other teams", () => {
      const teams = [team('T1', 'M', [call('a')], { handSet: { paid: 70 } }), team('T2', 'M', [call('b')]), team('T3', 'M', [call('c')])];
      const out = emptyResult();
      spreadGroupMetric('M', 100, teams, 'paid', out);
      expect([out.teams.T1.paid, out.teams.T2.paid, out.teams.T3.paid]).toEqual([70, 15, 15]);
      expect(out.agents.b.candidatesActivated).toBe(15);
    });

    it('transfer moves only what is not reached yet, of the giver\'s work type', () => {
      expect(unreached({ candidatesActivated: 40, vacanciesCaptured: 10, placementsClosed: 3 }, { candidatesActivated: 12, vacanciesCaptured: 15 }, 'call')).toEqual({ candidatesActivated: 28 });
      expect(unreached({ placementsClosed: 5, repeatBusinesses: 1 }, { placementsClosed: 2 }, 'field')).toEqual({ placementsClosed: 3, repeatBusinesses: 1 });
    });
  });
});
