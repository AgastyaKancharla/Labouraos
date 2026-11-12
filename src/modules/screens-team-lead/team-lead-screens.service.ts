import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.service';
import { AttendanceClock } from '../attendance/attendance-clock';
import { AttendanceReportsService } from '../attendance/attendance-reports.service';
import { LeaveService } from '../attendance/leave.service';
import { placementOf } from '../attendance/request-routing';
import { ReportingScopeService } from '../staff/reporting-scope.service';
import { CallAgentMetricsService } from '../target/call-agent-metrics.service';
import { FieldAgentMetricsService } from '../target/field-agent-metrics.service';
import { istDayKey, istStartOfDay } from '../ceo-portal/ceo-common';
import { paceRow, PaceRow } from './pace';

export interface Actor {
  id: string;
  role: string;
}

export interface Member {
  id: string;
  code: string;
  name: string;
  role: string;
}

const AGENT_ROLES = ['call_agent', 'field_agent'];
const DAY_MS = 24 * 3600 * 1000;

/**
 * Read endpoints for the Team Lead portal (designs T-*): everything scoped to
 * the Team Lead's own team (the agents who report to them), counts only, no
 * rupees. Phone numbers are masked by the global PiiMaskingInterceptor.
 */
@Injectable()
export class TeamLeadScreensService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly scope: ReportingScopeService,
    private readonly clock: AttendanceClock,
    private readonly reports: AttendanceReportsService,
    private readonly leave: LeaveService,
    private readonly callMetrics: CallAgentMetricsService,
    private readonly fieldMetrics: FieldAgentMetricsService,
  ) {}

  // -------------------------------------------------------------- the team

  /** The Team Lead's agents (active, not deactivated), in code order. */
  async members(actor: Actor): Promise<Member[]> {
    this.assertTeamLead(actor);
    const under = await this.scope.peopleUnder(actor.id);
    return this.prisma.staff.findMany({
      where: { id: { in: under }, role: { in: AGENT_ROLES }, status: { not: 'deactivated' } },
      select: { id: true, code: true, name: true, role: true },
      orderBy: [{ role: 'asc' }, { name: 'asc' }],
    });
  }

  async requireMember(actor: Actor, staffId: string): Promise<Member> {
    const team = await this.members(actor);
    const member = team.find((row) => row.id === staffId);
    if (!member) throw new NotFoundException('Not an agent in your team');
    return member;
  }

  /** T-Agents "Who reports to you", the sidebar name and the greeting line. */
  async team(actor: Actor) {
    this.assertTeamLead(actor);
    const me = await this.prisma.staff.findUniqueOrThrow({ where: { id: actor.id }, select: { id: true, code: true, name: true, role: true, teamName: true } });
    const chain = await this.scope.chainOf(actor.id);
    return {
      lead: { id: me.id, code: me.code, name: me.name, role: me.role },
      teamName: me.teamName ?? null,
      manager: chain.manager,
      members: await this.members(actor),
    };
  }

  // --------------------------------------------------------------- today

  /** Today so far per agent and for the team (T-Home tiles and live board). */
  async today(actor: Actor) {
    const team = await this.members(actor);
    const now = this.clock.now();
    const from = istStartOfDay(istDayKey(now));
    const to = now;
    const ids = team.map((row) => row.id);
    const people = [...ids, actor.id];
    const [calls, registered, paid, visits, agreements, interviews] = await Promise.all([
      this.prisma.callRecord.groupBy({ by: ['staffId'], where: { staffId: { in: people }, createdAt: { gte: from, lte: to } }, _count: true }),
      this.prisma.jobSeeker.groupBy({ by: ['registeredByStaffId'], where: { registeredByStaffId: { in: people }, createdAt: { gte: from, lte: to } }, _count: true }),
      this.prisma.jobSeeker.groupBy({ by: ['registeredByStaffId'], where: { registeredByStaffId: { in: people }, paymentReceivedAt: { gte: from, lte: to } }, _count: true }),
      this.prisma.businessVisit.groupBy({ by: ['staffId'], where: { staffId: { in: people }, visitedAt: { gte: from, lte: to } }, _count: true }),
      this.prisma.businessAgreement.findMany({ where: { signedAt: { gte: from, lte: to }, business: { accountAgentId: { in: people } } }, select: { businessId: true, business: { select: { accountAgentId: true } } } }),
      this.prisma.interview.findMany({
        where: { slotStartsAt: { gte: from, lt: new Date(from.getTime() + DAY_MS) }, status: { notIn: ['cancelled', 'declined'] }, OR: [{ proposedByStaffId: { in: people } }, { business: { accountAgentId: { in: people } } }] },
        select: { id: true, proposedByStaffId: true, business: { select: { accountAgentId: true } } },
      }),
    ]);
    const count = (rows: Array<{ _count: number; [key: string]: unknown }>, key: string, id: string) =>
      rows.find((row) => row[key] === id)?._count ?? 0;
    const byAgent = team.map((member) => ({
      staff: member,
      calls: count(calls as never, 'staffId', member.id),
      registered: count(registered as never, 'registeredByStaffId', member.id),
      paid: count(paid as never, 'registeredByStaffId', member.id),
      visits: count(visits as never, 'staffId', member.id),
      businesses: new Set(agreements.filter((row) => row.business.accountAgentId === member.id).map((row) => row.businessId)).size,
      interviews: interviews.filter((row) => row.business.accountAgentId === member.id || row.proposedByStaffId === member.id).length,
    }));
    const sum = (key: 'calls' | 'registered' | 'paid' | 'visits' | 'businesses') => byAgent.reduce((total, row) => total + row[key], 0);
    return {
      asOf: now.toISOString(),
      totals: {
        calls: sum('calls'),
        registered: sum('registered'),
        paid: sum('paid'),
        visits: sum('visits'),
        businesses: sum('businesses'),
        interviews: interviews.length,
      },
      agents: byAgent,
    };
  }

  // ------------------------------------------------------------- targets

  /**
   * The team's month in the Manager's plain format (target, done, still to
   * do, per day, at this speed, will we make it?) and each agent's main target.
   */
  async targets(actor: Actor) {
    const team = await this.members(actor);
    const now = this.clock.now();
    const today = istDayKey(now);
    const year = Number(today.slice(0, 4));
    const month = Number(today.slice(5, 7));
    const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
    const dayOfMonth = Number(today.slice(8, 10));
    const monthFrom = istStartOfDay(`${today.slice(0, 8)}01`);
    const ids = team.map((row) => row.id);
    const people = [...ids, actor.id];
    const targets = await this.prisma.target.findMany({ where: { staffId: { in: ids }, year, month } });
    const agents: Array<{ staff: Member; mainLabel: string; target: number | null; done: number; second: { label: string; done: number; target: number | null } } & PaceRow> = [];
    let placedDone = 0;
    let placedTarget: number | null = null;
    let paidTarget: number | null = null;
    for (const member of team) {
      const target = targets.find((row) => row.staffId === member.id) ?? null;
      if (member.role === 'call_agent') {
        const metrics = await this.callMetrics.getCallAgentMetrics(member.id, year, month, undefined, now);
        const t = target?.candidatesActivated ?? null;
        if (t !== null) paidTarget = (paidTarget ?? 0) + t;
        agents.push({
          staff: member,
          mainLabel: 'Paid the ₹499 fee',
          second: { label: 'Vacancies added', done: metrics.metrics.vacanciesCaptured, target: target?.vacanciesCaptured ?? null },
          ...paceRow(t, metrics.metrics.candidatesActivated, dayOfMonth, daysInMonth),
        });
      } else {
        const metrics = await this.fieldMetrics.getFieldAgentMetrics(member.id, year, month, undefined, now);
        const t = target?.placementsClosed ?? null;
        if (t !== null) placedTarget = (placedTarget ?? 0) + t;
        placedDone += metrics.metrics.placementsClosed;
        agents.push({
          staff: member,
          mainLabel: 'People placed',
          second: { label: 'Repeat businesses', done: metrics.metrics.repeatBusinesses, target: target?.repeatBusinesses ?? null },
          ...paceRow(t, metrics.metrics.placementsClosed, dayOfMonth, daysInMonth),
        });
      }
    }
    const [paidDone, signedRows, interviewsDone, registeredDone] = await Promise.all([
      this.prisma.jobSeeker.count({ where: { registeredByStaffId: { in: people }, paymentReceivedAt: { gte: monthFrom, lte: now } } }),
      this.prisma.businessAgreement.findMany({ where: { signedAt: { gte: monthFrom, lte: now }, business: { accountAgentId: { in: people } } }, select: { businessId: true } }),
      this.prisma.interview.count({
        where: { status: 'completed', slotStartsAt: { gte: monthFrom, lte: now }, OR: [{ proposedByStaffId: { in: people } }, { business: { accountAgentId: { in: people } } }] },
      }),
      this.prisma.jobSeeker.count({ where: { registeredByStaffId: { in: people }, createdAt: { gte: monthFrom, lte: now } } }),
    ]);
    const teamRows = [
      { key: 'placed', label: 'People placed in jobs', hint: 'Each one earns a placement fee', ...paceRow(placedTarget, placedDone, dayOfMonth, daysInMonth) },
      { key: 'paid', label: 'Paid the ₹499 registration fee', hint: 'Job seekers who paid on their own phone', ...paceRow(paidTarget, paidDone, dayOfMonth, daysInMonth) },
      { key: 'businesses', label: 'Businesses signed up', hint: 'Owner confirmed by OTP', ...paceRow(null, new Set(signedRows.map((row) => row.businessId)).size, dayOfMonth, daysInMonth) },
      { key: 'interviews', label: 'Interviews done', hint: 'Job seeker met the owner', ...paceRow(null, interviewsDone, dayOfMonth, daysInMonth) },
      { key: 'registered', label: 'Job seekers registered', hint: 'Profile made by an agent', ...paceRow(null, registeredDone, dayOfMonth, daysInMonth) },
    ];
    return { year, month, dayOfMonth, daysInMonth, daysLeft: daysInMonth - dayOfMonth, team: teamRows, agents };
  }

  // -------------------------------------------------------------- agents

  /** T-Agents: one row per agent. */
  async agents(actor: Actor) {
    const board = await this.targets(actor);
    const now = this.clock.now();
    const today = istDayKey(now);
    const monthFrom = `${today.slice(0, 8)}01`;
    const monthStart = istStartOfDay(monthFrom);
    const rows = [];
    for (const row of board.agents) {
      const report = await this.reports.personReport(actor, row.staff.id, monthFrom, today);
      const workingDays = report.days.filter((day) => day.dayType !== 'off' && day.date <= today);
      const present = workingDays.filter((day) => ['full', 'half', 'open'].includes(day.dayType) || day.loginAt).length;
      const balance = await this.leave.balance(row.staff.id);
      const quality = await this.prisma.callQualityScore.aggregate({ where: { staffId: row.staff.id, createdAt: { gte: monthStart } }, _avg: { score: true }, _count: true });
      rows.push({
        staff: row.staff,
        main: { label: row.mainLabel, target: row.target, done: row.done, projection: row.projection, verdict: row.verdict, onTrack: row.onTrack },
        attendance: { present, workingDays: workingDays.length },
        lateLogins: { count: report.lateLogins.count, minutes: report.lateLogins.days.reduce((sum, day) => sum + day.minutes, 0) },
        leaveLeft: balance.casual.left + balance.emergency.left,
        callQuality: quality._count > 0 ? Math.round(quality._avg.score ?? 0) : null,
      });
    }
    return { dayOfMonth: board.dayOfMonth, daysInMonth: board.daysInMonth, rows };
  }

  /** T-Agent: one agent's month. */
  async agent(actor: Actor, staffId: string) {
    const member = await this.requireMember(actor, staffId);
    const board = await this.targets(actor);
    const row = board.agents.find((item) => item.staff.id === staffId)!;
    const now = this.clock.now();
    const today = istDayKey(now);
    const monthFrom = `${today.slice(0, 8)}01`;
    const monthStart = istStartOfDay(monthFrom);
    const report = await this.reports.personReport(actor, staffId, monthFrom, today);
    const balance = await this.leave.balance(staffId);
    const scores = await this.prisma.callQualityScore.findMany({ where: { staffId }, orderBy: { createdAt: 'desc' }, take: 20 });
    const calls = scores.length
      ? await this.prisma.callRecord.findMany({ where: { id: { in: scores.map((s) => s.callRecordId) } }, select: { id: true, code: true, startedAt: true, createdAt: true, durationSec: true, subjectType: true, subjectId: true } })
      : [];
    const subjects = await this.subjectNames(calls);
    const monthScores = scores.filter((s) => s.createdAt.getTime() >= monthStart.getTime());
    const notes = await this.prisma.staffCoachingNote.findMany({ where: { staffId }, orderBy: { createdAt: 'desc' }, take: 30 });
    const authors = await this.briefs(notes.map((note) => note.authorStaffId));
    const pendingTargetChanges = await this.prisma.staffRequest.findMany({ where: { kind: 'target_change', staffId, status: 'pending' }, select: { id: true, details: true, createdAt: true } });
    const metricRows =
      member.role === 'call_agent'
        ? [
            { metric: 'candidatesActivated', label: row.mainLabel, ...paceRow(row.target, row.done, board.dayOfMonth, board.daysInMonth) },
            { metric: 'vacanciesCaptured', label: row.second.label, ...paceRow(row.second.target, row.second.done, board.dayOfMonth, board.daysInMonth) },
          ]
        : [
            { metric: 'placementsClosed', label: row.mainLabel, ...paceRow(row.target, row.done, board.dayOfMonth, board.daysInMonth) },
            { metric: 'repeatBusinesses', label: row.second.label, ...paceRow(row.second.target, row.second.done, board.dayOfMonth, board.daysInMonth) },
          ];
    return {
      staff: member,
      main: { label: row.mainLabel, target: row.target, done: row.done, projection: row.projection, verdict: row.verdict },
      lateLogins: { count: report.lateLogins.count, minutes: report.lateLogins.days.reduce((sum, day) => sum + day.minutes, 0) },
      leaveLeft: { casual: balance.casual.left, emergency: balance.emergency.left, total: balance.casual.left + balance.emergency.left },
      callQuality: monthScores.length ? Math.round(monthScores.reduce((sum, s) => sum + s.score, 0) / monthScores.length) : null,
      targets: metricRows,
      pendingTargetChanges: pendingTargetChanges.map((item) => ({ id: item.id, ref: `target_change.${item.id}`, details: item.details, createdAt: item.createdAt.toISOString() })),
      attendance: report.days.map((day) => ({
        id: day.id,
        date: day.date,
        dayType: day.dayType,
        loginAt: day.loginAt,
        lateMinutes: day.lateMinutes,
        productionSeconds: day.productionSeconds,
        changed: Boolean(day.change),
        leaveKind: day.leaveKind,
      })),
      scoredCalls: scores.map((score) => {
        const call = calls.find((item) => item.id === score.callRecordId);
        return {
          callId: score.callRecordId,
          at: (call?.startedAt ?? call?.createdAt ?? score.createdAt).toISOString(),
          with: call ? subjects.get(`${call.subjectType}:${call.subjectId}`) ?? null : null,
          durationSec: call?.durationSec ?? null,
          score: score.score,
          note: score.note,
        };
      }),
      notes: notes.map((note) => ({ id: note.id, kind: note.kind, text: note.text, at: note.createdAt.toISOString(), author: authors.get(note.authorStaffId) ?? null, byYou: note.authorStaffId === actor.id })),
    };
  }

  // ---------------------------------------------------------- attendance

  /** T-Attendance: the team's day (today with the live status, or any past day). */
  async attendance(actor: Actor, dateText?: string) {
    const team = await this.members(actor);
    const now = this.clock.now();
    const today = istDayKey(now);
    const date = dateText && /^\d{4}-\d{2}-\d{2}$/.test(dateText) ? dateText : today;
    if (date > today) throw new BadRequestException('Pick today or an earlier day');
    const days = await this.prisma.attendanceDay.findMany({
      where: { staffId: { in: team.map((row) => row.id) }, date: new Date(`${date}T00:00:00.000Z`) },
    });
    const live = date === today ? await this.reports.liveBoard(actor) : null;
    const month = date.slice(0, 7);
    const changes = await this.prisma.attendanceDay.groupBy({
      by: ['staffId'],
      where: { staffId: { in: team.map((row) => row.id) }, date: { gte: new Date(`${month}-01T00:00:00.000Z`), lte: new Date(`${date}T00:00:00.000Z`) }, dayTypeChangedAt: { not: null } },
      _count: true,
    });
    const rows = team.map((member) => {
      const day = days.find((row) => row.staffId === member.id) ?? null;
      const now2 = live?.people.find((row) => row.staff.id === member.id) ?? null;
      return {
        staff: member,
        dayId: day?.id ?? null,
        dayType: day?.dayType ?? null,
        loginAt: day?.loginAt?.toISOString() ?? null,
        logoutAt: day?.logoutAt?.toISOString() ?? null,
        lateMinutes: day?.lateMinutes ?? 0,
        productionSeconds: now2 ? now2.productionSeconds : (day?.productionSeconds ?? 0),
        breakSeconds: now2 ? now2.breakSeconds : (day?.breakSeconds ?? 0),
        overBreak: now2?.overBreak ?? false,
        shortfallSeconds: day?.shortfallSeconds ?? 0,
        idleSeconds: now2 ? now2.idleSeconds : (day?.idleSeconds ?? 0),
        status: now2?.status ?? null,
        since: now2?.since ?? null,
        changesThisMonth: changes.find((row) => row.staffId === member.id)?._count ?? 0,
      };
    });
    const lost = rows.reduce((sum, row) => sum + row.shortfallSeconds + row.idleSeconds, 0);
    return {
      date,
      isToday: date === today,
      summary: {
        atWork: rows.filter((row) => row.loginAt).length,
        people: rows.length,
        late: rows.filter((row) => row.lateMinutes > 0).length,
        overBreak: rows.filter((row) => row.overBreak).length,
        secondsLost: lost,
      },
      rows,
    };
  }

  // --------------------------------------------------------------- leave

  /** T-Leave: who is off in the next two weeks, every request and where it is, and balances. */
  async leaveBoard(actor: Actor) {
    const team = await this.members(actor);
    const now = this.clock.now();
    const today = istDayKey(now);
    const todayDate = new Date(`${today}T00:00:00.000Z`);
    const until = new Date(todayDate.getTime() + 14 * DAY_MS);
    const people = [...team.map((row) => row.id), actor.id];
    const requests = await this.prisma.leaveRequest.findMany({
      where: { staffId: { in: people }, toDate: { gte: todayDate }, fromDate: { lte: until }, status: { in: ['pending', 'approved'] } },
      include: { staff: { select: { id: true, code: true, name: true, role: true } } },
      orderBy: { fromDate: 'asc' },
    });
    const deciders = await this.briefs(requests.map((row) => row.decidedByStaffId).filter((x): x is string => Boolean(x)));
    const chain = await this.scope.chainOf(actor.id);
    const schedule = requests.map((row) => {
      const placement = placementOf(row, now);
      let where: string;
      if (row.status === 'approved') {
        const by = row.decidedByStaffId ? deciders.get(row.decidedByStaffId) : null;
        where = by ? (by.id === actor.id ? 'Approved by you' : `Approved by ${by.name}`) : 'Approved';
      } else if (placement.withTeamLead && placement.withManager) {
        where = `Waiting · you and ${chain.manager?.name ?? 'the Manager'}`;
      } else if (placement.withTeamLead) {
        where = 'Waiting · you';
      } else {
        where = `With ${chain.manager?.name ?? 'the Manager'} (Manager)`;
      }
      return {
        id: row.id,
        ref: `leave.${row.id}`,
        staff: row.staff,
        isYou: row.staffId === actor.id,
        kind: row.kind,
        fromDate: row.fromDate.toISOString().slice(0, 10),
        toDate: row.toDate.toISOString().slice(0, 10),
        days: row.days,
        status: row.status,
        where,
        waitingForYou: row.status === 'pending' && placement.withTeamLead && row.staffId !== actor.id,
      };
    });
    const month = today.slice(0, 7);
    const monthFrom = new Date(`${month}-01T00:00:00.000Z`);
    const monthTo = new Date(Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5, 7)), 0));
    const balances = [];
    for (const member of team) {
      const balance = await this.leave.balance(member.id);
      const used = await this.prisma.attendanceDay.groupBy({
        by: ['leaveKind'],
        where: { staffId: member.id, dayType: 'leave', date: { gte: monthFrom, lte: monthTo } },
        _count: true,
      });
      const usedOf = (kind: string) => used.find((row) => (row.leaveKind ?? 'casual') === kind)?._count ?? 0;
      balances.push({ staff: member, plannedLeft: balance.casual.left, emergencyLeft: balance.emergency.left, plannedUsedThisMonth: usedOf('casual'), emergencyUsedThisMonth: usedOf('emergency') });
    }
    const offToday = schedule.filter((row) => row.status === 'approved' && row.fromDate <= today && row.toDate >= today).length;
    const week = istDayKey(new Date(now.getTime() + 7 * DAY_MS));
    return {
      today,
      manager: chain.manager,
      summary: {
        offToday,
        offNext7Days: new Set(schedule.filter((row) => row.status === 'approved' && row.fromDate <= week && row.toDate >= today).map((row) => row.staff.id)).size,
        waitingForYou: schedule.filter((row) => row.waitingForYou).length,
        pastThreePlanned: balances.filter((row) => row.plannedUsedThisMonth > 3).length,
      },
      schedule,
      balances,
    };
  }

  // ------------------------------------------------------------- reports

  /** T-Reports: one row per day in the range, and this week / last week. */
  async reportDays(actor: Actor, fromText?: string, toText?: string) {
    const team = await this.members(actor);
    const now = this.clock.now();
    const today = istDayKey(now);
    const to = toText && /^\d{4}-\d{2}-\d{2}$/.test(toText) ? (toText > today ? today : toText) : today;
    const from = fromText && /^\d{4}-\d{2}-\d{2}$/.test(fromText) ? fromText : to;
    if (from > to) throw new BadRequestException('from is after to');
    const span = (new Date(`${to}T00:00:00Z`).getTime() - new Date(`${from}T00:00:00Z`).getTime()) / DAY_MS;
    if (span > 92) throw new BadRequestException('A report covers at most three months');
    const ids = team.map((row) => row.id);
    const people = [...ids, actor.id];
    const rows = [];
    for (let t = new Date(`${to}T00:00:00Z`).getTime(); t >= new Date(`${from}T00:00:00Z`).getTime(); t -= DAY_MS) {
      const day = new Date(t).toISOString().slice(0, 10);
      rows.push(await this.dayCounts(people, ids, day, now));
    }
    const weekStart = (key: string) => {
      const d = new Date(`${key}T00:00:00Z`);
      return new Date(d.getTime() - ((d.getUTCDay() + 6) % 7) * DAY_MS).toISOString().slice(0, 10);
    };
    const thisWeek = await this.weekSummary(actor, people, ids, weekStart(today), today, now);
    const lastStart = new Date(new Date(`${weekStart(today)}T00:00:00Z`).getTime() - 7 * DAY_MS).toISOString().slice(0, 10);
    const lastEnd = new Date(new Date(`${weekStart(today)}T00:00:00Z`).getTime() - DAY_MS).toISOString().slice(0, 10);
    const lastWeek = await this.weekSummary(actor, people, ids, lastStart, lastEnd, now);
    return { from, to, today, rows, thisWeek, lastWeek };
  }

  private async dayCounts(people: string[], ids: string[], day: string, now: Date) {
    const start = istStartOfDay(day);
    const end = new Date(Math.min(start.getTime() + DAY_MS, now.getTime()));
    const [calls, registered, paid, visits, interviews, attendance] = await Promise.all([
      this.prisma.callRecord.count({ where: { staffId: { in: people }, createdAt: { gte: start, lt: end } } }),
      this.prisma.jobSeeker.count({ where: { registeredByStaffId: { in: people }, createdAt: { gte: start, lt: end } } }),
      this.prisma.jobSeeker.count({ where: { registeredByStaffId: { in: people }, paymentReceivedAt: { gte: start, lt: end } } }),
      this.prisma.businessVisit.count({ where: { staffId: { in: people }, visitedAt: { gte: start, lt: end } } }),
      this.prisma.interview.count({
        where: { slotStartsAt: { gte: start, lt: new Date(start.getTime() + DAY_MS) }, status: { notIn: ['cancelled', 'declined'] }, OR: [{ proposedByStaffId: { in: people } }, { business: { accountAgentId: { in: people } } }] },
      }),
      this.prisma.attendanceDay.findMany({ where: { staffId: { in: ids }, date: new Date(`${day}T00:00:00.000Z`) }, select: { loginAt: true, shortfallSeconds: true, idleSeconds: true } }),
    ]);
    return {
      date: day,
      soFar: day === istDayKey(now),
      calls,
      registered,
      paid,
      visits,
      interviews,
      atWork: attendance.filter((row) => row.loginAt).length,
      people: ids.length,
      secondsLost: attendance.reduce((sum, row) => sum + row.shortfallSeconds + row.idleSeconds, 0),
    };
  }

  private async weekSummary(actor: Actor, people: string[], ids: string[], from: string, to: string, now: Date) {
    const start = istStartOfDay(from);
    const end = new Date(Math.min(istStartOfDay(to).getTime() + DAY_MS, now.getTime()));
    const fieldAgents = (await this.members(actor)).filter((row) => row.role === 'field_agent').map((row) => row.id);
    const [placed, paid, days, perAgentPaid] = await Promise.all([
      this.prisma.placement.count({ where: { createdByStaffId: { in: fieldAgents.length ? fieldAgents : ['-'] }, joinedDate: { gte: start, lt: end }, paidAt: { not: null } } }),
      this.prisma.jobSeeker.count({ where: { registeredByStaffId: { in: people }, paymentReceivedAt: { gte: start, lt: end } } }),
      this.prisma.attendanceDay.findMany({ where: { staffId: { in: ids }, date: { gte: new Date(`${from}T00:00:00Z`), lte: new Date(`${to}T00:00:00Z`) } }, select: { staffId: true, dayType: true, lateMinutes: true } }),
      this.prisma.jobSeeker.groupBy({ by: ['registeredByStaffId'], where: { registeredByStaffId: { in: ids }, paymentReceivedAt: { gte: start, lt: end } }, _count: true }),
    ]);
    const working = days.filter((row) => row.dayType !== 'off' && row.dayType !== 'leave');
    const present = working.filter((row) => row.dayType !== 'absent').length;
    const best = [...perAgentPaid].sort((a, b) => b._count - a._count)[0];
    const bestStaff = best?.registeredByStaffId ? await this.prisma.staff.findUnique({ where: { id: best.registeredByStaffId }, select: { id: true, name: true } }) : null;
    return {
      from,
      to,
      placed,
      paid,
      attendancePercent: working.length ? Math.round((present / working.length) * 100) : null,
      lateLogins: days.filter((row) => row.lateMinutes > 0).length,
      best: bestStaff && best ? { staff: bestStaff, paid: best._count } : null,
    };
  }

  // --------------------------------------------------------- login codes

  /** T-LoginCodes: counts, locked accounts and invites waiting, in the team. */
  async access(actor: Actor) {
    const team = await this.members(actor);
    const ids = team.map((row) => row.id);
    const now = this.clock.now();
    const since = istStartOfDay(istDayKey(now));
    const [locked, invites, codesToday] = await Promise.all([
      this.prisma.staff.findMany({ where: { id: { in: ids }, lockedUntil: { gt: now } }, select: { id: true, code: true, name: true, role: true, lockedUntil: true, lockedReason: true, failedLoginCount: true } }),
      this.prisma.staff.findMany({ where: { id: { in: ids }, status: 'pending_invite' }, select: { id: true, code: true, name: true, role: true } }),
      this.prisma.loginCodeRequest.count({ where: { staffId: { in: ids }, revealedAt: { gte: since } } }),
    ]);
    return {
      codesToday,
      locked: locked.map((row) => ({ ...row, lockedUntil: row.lockedUntil?.toISOString() ?? null })),
      invites,
    };
  }

  // ------------------------------------------------------------- helpers

  assertTeamLead(actor: Actor) {
    if (actor.role !== 'team_lead') throw new ForbiddenException('This is the Team Lead portal');
  }

  async briefs(ids: string[]) {
    const unique = [...new Set(ids.filter(Boolean))];
    const rows = unique.length ? await this.prisma.staff.findMany({ where: { id: { in: unique } }, select: { id: true, code: true, name: true, role: true } }) : [];
    return new Map(rows.map((row) => [row.id, row]));
  }

  /** "JS-00244 · Ramesh" / "Metro Mart · owner" for a call's subject (first name only, never a number). */
  async subjectNames(calls: Array<{ subjectType: string | null; subjectId: string | null }>) {
    const seekers = calls.filter((c) => c.subjectType === 'job_seeker' && c.subjectId).map((c) => c.subjectId as string);
    const businesses = calls.filter((c) => c.subjectType === 'business' && c.subjectId).map((c) => c.subjectId as string);
    const out = new Map<string, string>();
    if (seekers.length) {
      for (const row of await this.prisma.jobSeeker.findMany({ where: { id: { in: seekers } }, select: { id: true, code: true, name: true } })) {
        out.set(`job_seeker:${row.id}`, `${row.code} · ${row.name.split(' ')[0]}`);
      }
    }
    if (businesses.length) {
      for (const row of await this.prisma.business.findMany({ where: { id: { in: businesses } }, select: { id: true, name: true } })) {
        out.set(`business:${row.id}`, `${row.name} · owner`);
      }
    }
    return out;
  }
}
