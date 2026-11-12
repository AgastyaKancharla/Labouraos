import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.service';
import { AttendanceDaysService, DayRow } from '../attendance/attendance-days.service';
import { AttendanceReportsService } from '../attendance/attendance-reports.service';
import { DAY_MS, DateRange, istDayKey, percent, weekBuckets } from '../ceo-portal/ceo-common';
import { paceFor } from '../ceo-portal/ceo-team.service';
import { Forecast, MonthWindow, forecast, monthWeeks, monthWindow, outOfHundred, outOfTen } from './manager-common';
import { ManagerTree, ManagerTreeService, WorkCounts } from './manager-tree.service';

/** IST calendar day of an instant, as the Date value an @db.Date column holds. */
export function dbDate(instant: Date): Date {
  return new Date(`${istDayKey(instant)}T00:00:00.000Z`);
}

/** The plan metrics on Home and Plan vs actual. Only three have a stored target (guide, Monthly targets). */
export type PlanMetric = 'placed' | 'paid' | 'leftWithin30' | 'businessesSignedUp' | 'vacancies' | 'interviewsDone' | 'registered';

export const PLAN_LABELS: Record<PlanMetric, { label: string; hint: string }> = {
  placed: { label: 'People placed in jobs', hint: 'Joined the job · each one earns a placement fee' },
  paid: { label: 'Paid the registration fee', hint: 'Job seekers who paid on their own phone' },
  leftWithin30: { label: 'Placed people who left within 30 days', hint: 'Each one can mean a free replacement or a refund' },
  businessesSignedUp: { label: 'Businesses signed up', hint: 'Owner confirmed by OTP' },
  vacancies: { label: 'New job openings added', hint: 'Vacancies businesses gave us' },
  interviewsDone: { label: 'Interviews done', hint: 'Job seeker met the owner' },
  registered: { label: 'Job seekers registered', hint: 'Profile made by an agent' },
};

export interface PlanTargets {
  placed: number | null;
  paid: number | null;
  vacancies: number | null;
}

export interface PlanRow extends Forecast {
  metric: PlanMetric;
  label: string;
  hint: string;
  lowerIsBetter: boolean;
}

export interface AttendanceTotals {
  people: number;
  workedDays: number;
  expectedDays: number;
  percent: number | null;
  lateLogins: number;
  lateMinutes: number;
  lostSeconds: number;
  productionSeconds: number;
}

function sumOrNull(values: (number | null)[]): number | null {
  const present = values.filter((v): v is number => typeof v === 'number');
  return present.length ? present.reduce((a, b) => a + b, 0) : null;
}

/** Hours lost on a day: shortfall not made up, plus idle time. */
export function lostSeconds(d: Pick<DayRow, 'shortfallSeconds' | 'makeUpSeconds' | 'idleSeconds'>): number {
  return Math.max(0, d.shortfallSeconds - d.makeUpSeconds) + d.idleSeconds;
}

/**
 * Plan vs actual for a Manager's tree (designs MG-Home, MG-Plan, MG-Reports):
 * the month's targets, done so far, still to do, per day, where we end at
 * this speed and "Will we make it?" — in counts, never rupees (guide,
 * "Manager home — Key numbers"). The plan is the sum of the agents' monthly
 * targets the CEO and Managers set (the Target table); metrics without a
 * stored target show what was done with no target.
 */
@Injectable()
export class ManagerPlanService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tree: ManagerTreeService,
    private readonly days: AttendanceDaysService,
    private readonly reports: AttendanceReportsService,
  ) {}

  async targetsFor(ids: string[], m: Pick<MonthWindow, 'year' | 'month'>): Promise<PlanTargets> {
    if (!ids.length) return { placed: null, paid: null, vacancies: null };
    const rows = await this.prisma.target.findMany({ where: { staffId: { in: ids }, year: m.year, month: m.month } });
    return {
      placed: sumOrNull(rows.map((r) => r.placementsClosed)),
      paid: sumOrNull(rows.map((r) => r.candidatesActivated)),
      vacancies: sumOrNull(rows.map((r) => r.vacanciesCaptured)),
    };
  }

  planRows(counts: WorkCounts, targets: PlanTargets, m: MonthWindow): { bringMoney: PlanRow[]; leadToMoney: PlanRow[] } {
    const row = (metric: PlanMetric, done: number, target: number | null, lowerIsBetter = false): PlanRow => ({
      metric,
      ...PLAN_LABELS[metric],
      lowerIsBetter,
      ...forecast(done, target, m, lowerIsBetter),
    });
    return {
      bringMoney: [row('placed', counts.placed, targets.placed), row('paid', counts.paid, targets.paid), row('leftWithin30', counts.leftWithin30, null, true)],
      leadToMoney: [
        row('businessesSignedUp', counts.businessesSignedUp, null),
        row('vacancies', counts.vacancies, targets.vacancies),
        row('interviewsDone', counts.interviewsDone, null),
        row('registered', counts.registered, null),
      ],
    };
  }

  async attendanceTotals(ids: string[], from: Date, to: Date, now: Date): Promise<AttendanceTotals> {
    const today = dbDate(now);
    const end = dbDate(to).getTime() > today.getTime() ? today : dbDate(to);
    const totals: AttendanceTotals = { people: ids.length, workedDays: 0, expectedDays: 0, percent: null, lateLogins: 0, lateMinutes: 0, lostSeconds: 0, productionSeconds: 0 };
    if (dbDate(from).getTime() > end.getTime()) return totals;
    for (const id of ids) {
      const rows = await this.days.rowsBetween(id, dbDate(from), end);
      for (const d of rows) {
        if (!['holiday', 'weekly_off', 'leave'].includes(d.dayType)) totals.expectedDays += 1;
        if (d.loginAt) totals.workedDays += 1;
        if (d.lateMinutes > 0) {
          totals.lateLogins += 1;
          totals.lateMinutes += d.lateMinutes;
        }
        totals.lostSeconds += lostSeconds(d);
        totals.productionSeconds += d.productionSeconds;
      }
    }
    totals.percent = totals.expectedDays ? Math.min(100, percent(totals.workedDays, totals.expectedDays)) : null;
    return totals;
  }

  /** MG-Home and MG-Plan: plan vs actual for the whole tree, each team and each week, plus where people are lost. */
  async overview(actor: { id: string; role: string }, range: DateRange, now: Date) {
    const tree = await this.tree.load(actor.id);
    const m = monthWindow(range.to, now);
    const monthRange = { from: m.from, to: now.getTime() < m.to.getTime() ? now : m.to };
    const [counts, targets, periodCounts] = await Promise.all([
      this.tree.counts(tree.ids, monthRange),
      this.targetsFor(tree.ids, m),
      this.tree.counts(tree.ids, range),
    ]);
    const { bringMoney, leadToMoney } = this.planRows(counts, targets, m);
    const withTarget = [...bringMoney, ...leadToMoney].filter((r) => r.verdict !== 'no_target');
    const shortRows = withTarget.filter((r) => r.verdict === 'short').sort((a, b) => (a.extra ?? 0) / (a.target || 1) - (b.extra ?? 0) / (b.target || 1));
    const gap = shortRows[0] ?? null;

    const byTeam = [];
    const live = await this.reports.liveBoard(actor);
    const liveById = new Map(live.people.map((p) => [p.staff.id, p]));
    for (const lead of tree.leads) {
      const ids = this.tree.teamIds(tree, lead.id);
      const [c, t] = await Promise.all([this.tree.counts(ids, monthRange), this.targetsFor(ids, m)]);
      const atWork = ids.filter((id) => {
        const s = liveById.get(id)?.status;
        return s && !['not_logged_in', 'logged_out', 'on_leave'].includes(s);
      }).length;
      byTeam.push({
        teamLeadId: lead.id,
        team: lead.team,
        teamLead: lead.name,
        people: ids.length,
        atWork,
        rows: [
          { metric: 'placed' as const, label: 'People placed', ...forecast(c.placed, t.placed, m) },
          { metric: 'paid' as const, label: 'Paid the registration fee', ...forecast(c.paid, t.paid, m) },
          { metric: 'businessesSignedUp' as const, label: 'Businesses signed up', ...forecast(c.businessesSignedUp, null, m) },
        ],
      });
    }

    const byWeek = [];
    for (const w of monthWeeks(m, now)) {
      const c = await this.tree.counts(tree.ids, { from: w.from, to: w.to });
      const share = (target: number | null) => (target === null ? null : Math.round((target * (Math.min(7, m.daysInMonth - Math.round((w.from.getTime() - m.from.getTime()) / DAY_MS)))) / m.daysInMonth));
      byWeek.push({
        label: w.label,
        soFar: w.soFar,
        registered: { done: c.registered, target: null },
        paid: { done: c.paid, target: share(targets.paid) },
        businessesSignedUp: { done: c.businessesSignedUp, target: null },
        placed: { done: c.placed, target: share(targets.placed) },
      });
    }

    // Where we lose people: each step "out of 100", over the selected period.
    const paidIds = await this.prisma.jobSeeker.findMany({
      where: { registeredByStaffId: { in: tree.ids.length ? tree.ids : ['-'] }, paymentReceivedAt: { gte: range.from, lte: range.to } },
      select: { id: true },
    });
    const withInterview = paidIds.length
      ? await this.prisma.interview.findMany({ where: { jobSeekerId: { in: paidIds.map((p) => p.id) } }, distinct: ['jobSeekerId'], select: { jobSeekerId: true } })
      : [];
    const joinedLongAgo = await this.prisma.placement.findMany({
      where: {
        OR: [{ createdByStaffId: { in: tree.ids } }, { jobSeeker: { registeredByStaffId: { in: tree.ids } } }],
        joinedDate: { gte: new Date(range.from.getTime() - 30 * DAY_MS), lte: new Date(now.getTime() - 30 * DAY_MS) },
      },
      select: { joinedDate: true, dropoutReportedAt: true },
    });
    const stayed = joinedLongAgo.filter((p) => !p.dropoutReportedAt || (p.joinedDate && p.dropoutReportedAt.getTime() - p.joinedDate.getTime() > 30 * DAY_MS)).length;
    const stuckLinks = await this.prisma.jobSeeker.count({
      where: { registeredByStaffId: { in: tree.ids.length ? tree.ids : ['-'] }, status: { in: ['lead', 'consented'] }, paymentReceivedAt: null, anonymisedAt: null, createdAt: { lte: new Date(now.getTime() - DAY_MS), gte: new Date(now.getTime() - 30 * DAY_MS) } },
    });
    const losses = [
      { step: 'Registered → paid the registration fee', now: outOfHundred(periodCounts.paid, periodCounts.registered), why: stuckLinks ? `${stuckLinks} registration links stuck over 24 h` : null },
      { step: 'Paid → had an interview', now: outOfHundred(withInterview.length, paidIds.length), why: null },
      { step: 'Interview → got the job', now: outOfHundred(periodCounts.offered, periodCounts.interviewsDone), why: null },
      { step: 'Got the job → still working after 30 days', now: outOfHundred(stayed, joinedLongAgo.length), why: null },
    ];

    const rates = [
      { key: 'registerToPay', label: 'Out of every 10 who register, how many pay', now: outOfTen(periodCounts.paid, periodCounts.registered), unit: 'out_of_10' },
      { key: 'interviewToJob', label: 'Out of every 10 interviews, how many get the job', now: outOfTen(periodCounts.offered, periodCounts.interviewsDone), unit: 'out_of_10' },
      { key: 'openingsFilled', label: 'Out of every 10 job openings we closed, how many we filled', now: outOfTen(periodCounts.vacanciesFilled, periodCounts.vacanciesClosed), unit: 'out_of_10' },
      { key: 'daysToFill', label: 'Days to fill a job opening', now: periodCounts.daysToFill, unit: 'days' },
    ];

    // Attendance today, for the Home tiles.
    const todayTotals = await this.attendanceTotals(tree.ids, now, now, now);
    const statuses = live.people.map((p) => p.status);
    const attendanceToday = {
      people: live.people.length,
      atWork: statuses.filter((s) => !['not_logged_in', 'logged_out', 'on_leave'].includes(s)).length,
      lateLogins: live.people.filter((p) => p.lateMinutes > 0).length,
      onLeave: statuses.filter((s) => s === 'on_leave').length,
      missing: statuses.filter((s) => s === 'not_logged_in').length,
      lostSeconds: todayTotals.lostSeconds,
    };

    // Watch list: agents behind pace, open quality flags.
    const behind = await this.agentsBehind(tree, m, now);
    const openFlags = tree.ids.length ? await this.prisma.reviewFlag.count({ where: { status: 'open', raisedForStaffId: { in: tree.ids } } }) : 0;

    return {
      manager: tree.manager,
      teams: tree.leads.map((l) => l.team),
      month: { year: m.year, month: m.month, key: m.key, dayOfMonth: m.dayOfMonth, daysInMonth: m.daysInMonth, daysLeft: m.daysLeft },
      period: { from: range.from.toISOString(), to: range.to.toISOString() },
      headline: {
        withTarget: withTarget.length,
        reached: withTarget.filter((r) => r.verdict === 'yes').length,
        short: shortRows.length,
        biggestGap: gap
          ? { metric: gap.metric, label: gap.label, atThisSpeed: gap.atThisSpeed, target: gap.target, needPerDay: gap.needPerDay, doingPerDay: gap.doingPerDay }
          : null,
      },
      bringMoney,
      leadToMoney,
      rates,
      byTeam,
      byWeek,
      losses,
      attendanceToday,
      watch: {
        agentsBehind: behind,
        openFlags,
      },
    };
  }

  /** Agents whose main target is behind pace (after the 10th, under 80% of pace). */
  async agentsBehind(tree: ManagerTree, m: MonthWindow, now: Date) {
    if (!tree.agents.length) return [];
    const targets = await this.prisma.target.findMany({ where: { staffId: { in: tree.agents.map((a) => a.id) }, year: m.year, month: m.month } });
    const out = [];
    const range = { from: m.from, to: now.getTime() < m.to.getTime() ? now : m.to };
    for (const agent of tree.agents) {
      const t = targets.find((x) => x.staffId === agent.id);
      const goal = agent.role === 'field_agent' ? (t?.placementsClosed ?? null) : (t?.candidatesActivated ?? null);
      if (!goal) continue;
      const c = await this.tree.counts([agent.id], range);
      const done = agent.role === 'field_agent' ? c.placed : c.paid;
      if (paceFor(done, goal, m.dayOfMonth, m.daysInMonth) === 'behind') {
        out.push({ staff: { id: agent.id, code: agent.code, name: agent.name, role: agent.role, isIntern: agent.isIntern }, team: agent.team, done, target: goal });
      }
    }
    return out;
  }

  /** MG-Reports: one row per week (counts only), and each team's last week. */
  async weekly(actor: { id: string; role: string }, range: DateRange, now: Date) {
    const tree = await this.tree.load(actor.id);
    const end = range.to.getTime() > now.getTime() ? now : range.to;
    const weeksWanted = Math.min(12, Math.max(1, Math.ceil((end.getTime() - range.from.getTime() + 1) / (7 * DAY_MS))));
    const buckets = weekBuckets(end, weeksWanted).reverse();
    const rows = [];
    for (const b of buckets) {
      const m = monthWindow(b.to, now);
      const [c, att, targets] = await Promise.all([
        this.tree.counts(tree.ids, b),
        this.attendanceTotals(tree.ids, b.from, b.to, now),
        this.targetsFor(tree.ids, m),
      ]);
      const weeklyPlacements = targets.placed === null ? null : Math.round((targets.placed * 7) / m.daysInMonth);
      rows.push({
        from: b.from.toISOString(),
        to: b.to.toISOString(),
        startDay: b.start,
        registered: c.registered,
        paid: c.paid,
        businessesSignedUp: c.businessesSignedUp,
        interviewsDone: c.interviewsDone,
        placed: c.placed,
        attendancePercent: att.percent,
        lostSeconds: att.lostSeconds,
        placementTarget: weeklyPlacements,
        reached: weeklyPlacements === null ? null : c.placed >= weeklyPlacements,
      });
    }
    const last = weekBuckets(now, 2)[0];
    const teams = [];
    for (const lead of tree.leads) {
      const ids = this.tree.teamIds(tree, lead.id);
      const m = monthWindow(last.to, now);
      const [c, att, targets] = await Promise.all([this.tree.counts(ids, last), this.attendanceTotals(ids, last.from, last.to, now), this.targetsFor(ids, m)]);
      const agents = tree.agents.filter((a) => a.teamLeadId === lead.id);
      const scored = [];
      for (const a of agents) {
        const ac = await this.tree.counts([a.id], last);
        scored.push({ staff: { id: a.id, name: a.name, role: a.role }, placed: ac.placed, paid: ac.paid, score: ac.placed * 10 + ac.paid });
      }
      scored.sort((x, y) => y.score - x.score);
      teams.push({
        teamLeadId: lead.id,
        team: lead.team,
        teamLead: lead.name,
        placed: c.placed,
        placementPlan: targets.placed === null ? null : Math.round((targets.placed * 7) / m.daysInMonth),
        paid: c.paid,
        attendancePercent: att.percent,
        lateLogins: att.lateLogins,
        best: scored[0] && scored[0].score > 0 ? scored[0] : null,
        needsHelp: scored.length > 1 ? scored[scored.length - 1] : null,
      });
    }
    return { rows, lastWeek: { from: last.from.toISOString(), to: last.to.toISOString() }, teams };
  }
}
