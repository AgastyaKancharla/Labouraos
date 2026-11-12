import { BadRequestException, ForbiddenException, Injectable } from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.service';
import { AuditService } from '../../common/audit/audit.service';
import { AttendanceDaysService } from '../attendance/attendance-days.service';
import { LeaveService } from '../attendance/leave.service';
import { DAY_MS, DateRange, average, istDayKey, istStartOfDay, percent, weekBuckets } from '../ceo-portal/ceo-common';
import { countsAs } from '../ceo-portal/ceo-ops.service';
import { paceFor, staffState } from '../ceo-portal/ceo-team.service';
import { forecast, monthWindow, outOfHundred } from './manager-common';
import { ManagerPlanService, dbDate, lostSeconds } from './manager-plan.service';
import { ManagerTree, ManagerTreeService, TreePerson } from './manager-tree.service';

type Actor = { id: string; role: string };

export const NOTE_KINDS = ['note', 'written_warning'] as const;
const MAX_NOTE_LENGTH = 1000;

/**
 * People screens of the Manager portal: Teams (MG-Teams), one Team Lead's
 * scorecard (MG-TL), Agents (MG-Agents), one agent (MG-Agent), Staff &
 * access (MG-Staff), Attendance (MG-Attendance) and coaching notes. A
 * Manager sees only their own reporting tree; no salaries and no money.
 */
@Injectable()
export class ManagerPeopleService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly tree: ManagerTreeService,
    private readonly plan: ManagerPlanService,
    private readonly days: AttendanceDaysService,
    private readonly leave: LeaveService,
  ) {}

  private monthRange(now: Date) {
    const m = monthWindow(now, now);
    return { m, range: { from: m.from, to: now } as DateRange };
  }

  /** Main target for an agent: placements for field agents, paid registrations for call agents. */
  private async mainTarget(agent: TreePerson, m: { year: number; month: number; dayOfMonth: number; daysInMonth: number; daysLeft: number }, range: DateRange) {
    const [t, c] = await Promise.all([
      this.prisma.target.findUnique({ where: { staffId_year_month: { staffId: agent.id, year: m.year, month: m.month } } }),
      this.tree.counts([agent.id], range),
    ]);
    const field = agent.role === 'field_agent';
    const target = field ? (t?.placementsClosed ?? null) : (t?.candidatesActivated ?? null);
    const done = field ? c.placed : c.paid;
    return {
      metric: field ? 'placed' : 'paid',
      done,
      target,
      percent: target ? percent(done, target) : null,
      pace: paceFor(done, target, m.dayOfMonth, m.daysInMonth),
      forecast: forecast(done, target, m),
      counts: c,
      targetRow: t,
    };
  }

  private async requestStats(leadId: string, now: Date) {
    const since = new Date(now.getTime() - 30 * DAY_MS);
    const [pendingLeave, pendingCorrections, decidedLeave, decidedCorrections, claims] = await Promise.all([
      this.prisma.leaveRequest.count({ where: { status: 'pending', routedToStaffId: leadId } }),
      this.prisma.attendanceCorrection.count({ where: { status: 'pending', routedToStaffId: leadId } }),
      this.prisma.leaveRequest.findMany({ where: { decidedByStaffId: leadId, decidedAt: { gte: since } }, select: { createdAt: true, decidedAt: true } }),
      this.prisma.attendanceCorrection.findMany({ where: { decidedByStaffId: leadId, decidedAt: { gte: since } }, select: { createdAt: true, decidedAt: true } }),
      this.prisma.replacementClaim.findMany({ where: { decidedByStaffId: leadId, decidedAt: { gte: since } }, select: { decidedAt: true, decisionDueAt: true, reportedAt: true } }),
    ]);
    const hours = [...decidedLeave, ...decidedCorrections].map((r) => Math.round(((r.decidedAt as Date).getTime() - r.createdAt.getTime()) / 3_600_000));
    const onTime = claims.filter((c) => (c.decidedAt as Date).getTime() <= c.decisionDueAt.getTime()).length;
    const late = claims.filter((c) => (c.decidedAt as Date).getTime() > c.decisionDueAt.getTime());
    return {
      waiting: pendingLeave + pendingCorrections,
      averageAnswerHours: average(hours),
      claimsDecided: claims.length,
      claimsOnTime: onTime,
      claimsLate: late.map((c) => Math.round(((c.decidedAt as Date).getTime() - c.reportedAt.getTime()) / 3_600_000)),
    };
  }

  /** MG-Teams: one scorecard per Team Lead, the reporting tree and the month's counts per team. */
  async teams(actor: Actor, now: Date) {
    const tree = await this.tree.load(actor.id);
    const { m, range } = this.monthRange(now);
    const week = weekBuckets(now, 1)[0];
    const cards = [];
    const table = [];
    for (const lead of tree.leads) {
      const ids = this.tree.teamIds(tree, lead.id);
      const agents = tree.agents.filter((a) => a.teamLeadId === lead.id);
      const [counts, targets, att, attWeek, req, flags] = await Promise.all([
        this.tree.counts(ids, range),
        this.plan.teamTargets(lead.id, ids, m),
        this.plan.attendanceTotals(ids, m.from, now, now),
        this.plan.attendanceTotals(ids, week.from, week.to, now),
        this.requestStats(lead.id, now),
        this.prisma.reviewFlag.count({ where: { status: 'open', raisedForStaffId: { in: ids } } }),
      ]);
      const placed = forecast(counts.placed, targets.placed, m);
      cards.push({
        teamLeadId: lead.id,
        team: lead.team,
        teamLead: { id: lead.id, name: lead.name, code: lead.code },
        callAgents: agents.filter((a) => a.role === 'call_agent').length,
        fieldAgents: agents.filter((a) => a.role === 'field_agent').length,
        placed,
        verdict: placed.verdict === 'no_target' ? 'no_target' : placed.verdict === 'yes' ? 'on_track' : 'behind',
        attendancePercent: att.percent,
        lostThisWeekSeconds: attWeek.lostSeconds,
        requestsWaiting: req.waiting,
        averageAnswerHours: req.averageAnswerHours,
        claimsDecided: req.claimsDecided,
        claimsOnTime: req.claimsOnTime,
      });
      table.push({
        teamLeadId: lead.id,
        team: lead.team,
        registered: counts.registered,
        paid: counts.paid,
        businessesSignedUp: counts.businessesSignedUp,
        interviewsDone: counts.interviewsDone,
        placed: counts.placed,
        lateLogins: att.lateLogins,
        openFlags: flags,
      });
    }
    return {
      manager: tree.manager,
      cards,
      reportingTree: tree.leads.map((lead) => ({
        teamLeadId: lead.id,
        team: lead.team,
        teamLead: lead.name,
        agents: tree.agents.filter((a) => a.teamLeadId === lead.id).map((a) => ({ id: a.id, name: a.name, role: a.role, isIntern: a.isIntern })),
      })),
      unassigned: tree.agents.filter((a) => !a.teamLeadId).map((a) => ({ id: a.id, name: a.name, role: a.role })),
      table,
    };
  }

  /** MG-TL: one Team Lead's scorecard — results, members, her own work and coaching notes. */
  async team(actor: Actor, leadId: string, now: Date) {
    const tree = await this.tree.load(actor.id);
    const lead = await this.tree.person(tree, leadId);
    if (lead.role !== 'team_lead') throw new BadRequestException('That person is not a Team Lead');
    const { m, range } = this.monthRange(now);
    const week = weekBuckets(now, 1)[0];
    const ids = this.tree.teamIds(tree, lead.id);
    const agents = tree.agents.filter((a) => a.teamLeadId === lead.id);
    const [counts, targets, att, attWeek, req, own, codes, visits, leaveRows, notes] = await Promise.all([
      this.tree.counts(ids, range),
      this.plan.teamTargets(lead.id, ids, m),
      this.plan.attendanceTotals(ids, m.from, now, now),
      this.plan.attendanceTotals(ids, week.from, week.to, now),
      this.requestStats(lead.id, now),
      this.plan.attendanceTotals([lead.id], m.from, now, now),
      this.prisma.loginCodeRequest.groupBy({ by: ['status'], where: { revealedByStaffId: lead.id, revealedAt: { gte: m.from, lte: now } }, _count: { _all: true } }),
      this.prisma.visitAssignment.groupBy({ by: ['status'], where: { assignedByStaffId: lead.id, createdAt: { gte: m.from, lte: now } }, _count: { _all: true } }),
      this.prisma.leaveRequest.findMany({ where: { staffId: lead.id, toDate: { gte: dbDate(m.from) } }, orderBy: { fromDate: 'asc' }, take: 5 }),
      this.notesFor(lead.id),
    ]);
    const members = [];
    for (const a of agents) {
      const main = await this.mainTarget(a, m, range);
      const aAtt = await this.plan.attendanceTotals([a.id], m.from, now, now);
      const bal = await this.leave.balance(a.id);
      members.push({
        staff: { id: a.id, code: a.code, name: a.name, role: a.role, isIntern: a.isIntern },
        percent: main.percent,
        pace: main.pace,
        lateLogins: aAtt.lateLogins,
        lateMinutes: aAtt.lateMinutes,
        leaveLeft: bal.casual.left,
      });
    }
    const deciders = leaveRows.map((l) => l.decidedByStaffId).filter((x): x is string => Boolean(x));
    const names = deciders.length ? await this.prisma.staff.findMany({ where: { id: { in: deciders } }, select: { id: true, name: true } }) : [];
    const codesGiven = codes.reduce((s, c) => s + c._count._all, 0);
    const visitTotal = visits.reduce((s, v) => s + v._count._all, 0);
    const visitOpen = visits.filter((v) => ['pending', 'assigned'].includes(v.status)).reduce((s, v) => s + v._count._all, 0);
    return {
      teamLead: { id: lead.id, code: lead.code, name: lead.name },
      team: lead.team,
      placed: forecast(counts.placed, targets.placed, m),
      attendancePercent: att.percent,
      lostThisWeekSeconds: attWeek.lostSeconds,
      averageAnswerHours: req.averageAnswerHours,
      requestsWaiting: req.waiting,
      claimsDecided: req.claimsDecided,
      claimsOnTime: req.claimsOnTime,
      members,
      ownWork: {
        workedDays: own.workedDays,
        expectedDays: own.expectedDays,
        lateLogins: own.lateLogins,
        loginCodesGiven: codesGiven,
        visitsAssigned: visitTotal,
        visitsOpen: visitOpen,
        claimsLateHours: req.claimsLate,
        leave: leaveRows.map((l) => ({
          id: l.id,
          from: istDayKey(l.fromDate),
          to: istDayKey(l.toDate),
          status: l.status,
          decidedBy: names.find((n) => n.id === l.decidedByStaffId)?.name ?? null,
          decidedByYou: l.decidedByStaffId === actor.id,
        })),
      },
      notes,
    };
  }

  /** MG-Agents: every call and field agent in the tree, with their main target, attendance, leave and flags. */
  async agents(actor: Actor, now: Date) {
    const tree = await this.tree.load(actor.id);
    const { m, range } = this.monthRange(now);
    const flags = tree.agents.length
      ? await this.prisma.reviewFlag.groupBy({ by: ['raisedForStaffId'], where: { status: 'open', raisedForStaffId: { in: tree.agents.map((a) => a.id) } }, _count: { _all: true } })
      : [];
    const rows = [];
    for (const a of tree.agents) {
      const [main, att, bal] = await Promise.all([this.mainTarget(a, m, range), this.plan.attendanceTotals([a.id], m.from, now, now), this.leave.balance(a.id)]);
      rows.push({
        staff: { id: a.id, code: a.code, name: a.name, role: a.role, isIntern: a.isIntern },
        team: a.team,
        teamLeadId: a.teamLeadId,
        main: { metric: main.metric, done: main.done, target: main.target, percent: main.percent, atThisSpeed: main.forecast.atThisSpeed },
        pace: main.pace,
        attendancePercent: att.percent,
        lateLogins: att.lateLogins,
        lateMinutes: att.lateMinutes,
        leaveLeft: bal.casual.left + bal.emergency.left,
        openFlags: flags.find((f) => f.raisedForStaffId === a.id)?._count._all ?? 0,
      });
    }
    return { month: { year: m.year, month: m.month, dayOfMonth: m.dayOfMonth, daysInMonth: m.daysInMonth }, teams: tree.leads.map((l) => ({ id: l.id, team: l.team })), rows };
  }

  /** MG-Agent: one agent's targets and pace, this month's attendance, work quality and coaching notes. */
  async agent(actor: Actor, staffId: string, now: Date) {
    const tree = await this.tree.load(actor.id);
    const a = await this.tree.person(tree, staffId);
    if (a.role !== 'call_agent' && a.role !== 'field_agent') throw new BadRequestException('That person is not an agent');
    const { m, range } = this.monthRange(now);
    const [main, att, bal, notes, dayRows, calls, flagRows, followUps, stuck] = await Promise.all([
      this.mainTarget(a, m, range),
      this.plan.attendanceTotals([a.id], m.from, now, now),
      this.leave.balance(a.id),
      this.notesFor(a.id),
      this.days.rowsBetween(a.id, dbDate(m.from), dbDate(now)),
      this.prisma.callRecord.findMany({ where: { staffId: a.id, createdAt: { gte: m.from, lte: now } }, select: { answered: true, durationSec: true } }),
      this.prisma.reviewFlag.findMany({ where: { raisedForStaffId: a.id, raisedAt: { gte: new Date(now.getTime() - 60 * DAY_MS) } }, select: { kind: true, status: true }, orderBy: { raisedAt: 'desc' } }),
      this.prisma.followUpTask.count({ where: { assignedStaffId: a.id, status: 'pending', dueAt: { lt: now } } }),
      this.prisma.jobSeeker.count({ where: { registeredByStaffId: a.id, status: { in: ['lead', 'consented', 'pending_activation'] }, paymentReceivedAt: null, anonymisedAt: null, createdAt: { lte: new Date(now.getTime() - DAY_MS), gte: new Date(now.getTime() - 30 * DAY_MS) } } }),
    ]);
    const c = main.counts;
    const t = main.targetRow;
    const answered = calls.filter((x) => x.answered);
    const targets =
      a.role === 'call_agent'
        ? [
            { key: 'paid', label: 'Paid the registration fee', ...forecast(c.paid, t?.candidatesActivated ?? null, m) },
            { key: 'vacancies', label: 'Vacancies captured', ...forecast(c.vacancies, t?.vacanciesCaptured ?? null, m) },
            { key: 'registered', label: 'Job seekers registered', ...forecast(c.registered, null, m) },
            { key: 'answered', label: 'Calls answered', ...forecast(answered.length, null, m) },
          ]
        : [
            { key: 'placed', label: 'Placements closed', ...forecast(c.placed, t?.placementsClosed ?? null, m) },
            { key: 'paid', label: 'Paid the registration fee', ...forecast(c.paid, t?.candidatesActivated ?? null, m) },
            { key: 'businesses', label: 'Businesses signed up', ...forecast(c.businessesSignedUp, null, m) },
            { key: 'vacancies', label: 'Vacancies captured', ...forecast(c.vacancies, t?.vacanciesCaptured ?? null, m) },
          ];
    const flagCounts = new Map<string, { open: number; resolved: number }>();
    for (const f of flagRows) {
      const e = flagCounts.get(f.kind) ?? { open: 0, resolved: 0 };
      if (f.status === 'open') e.open += 1;
      else e.resolved += 1;
      flagCounts.set(f.kind, e);
    }
    return {
      staff: { id: a.id, code: a.code, name: a.name, role: a.role, isIntern: a.isIntern },
      team: a.team,
      teamLeadId: a.teamLeadId,
      teams: tree.leads.map((l) => ({ id: l.id, team: l.team, name: l.name })),
      month: { year: m.year, month: m.month, dayOfMonth: m.dayOfMonth, daysInMonth: m.daysInMonth },
      main: { metric: main.metric, done: main.done, target: main.target, atThisSpeed: main.forecast.atThisSpeed, pace: main.pace },
      lateLogins: att.lateLogins,
      lateMinutes: att.lateMinutes,
      lostSeconds: att.lostSeconds,
      leaveLeft: { casual: bal.casual.left, emergency: bal.emergency.left },
      registerToPay: outOfHundred(c.paid, c.registered),
      targets,
      attendance: dayRows
        .filter((d) => !['weekly_off', 'holiday'].includes(d.dayType))
        .map((d) => ({ id: d.id, date: d.date, loginAt: d.loginAt, lateMinutes: d.lateMinutes, productionSeconds: d.productionSeconds, dayType: d.dayType, countsAs: countsAs(d), shortfallSeconds: Math.max(0, d.shortfallSeconds - d.makeUpSeconds) })),
      quality: {
        averageTalkSeconds: average(answered.map((x) => x.durationSec ?? 0)),
        callsThisMonth: calls.length,
        stuckRegistrations: stuck,
        followUpsOverdue: followUps,
        flags: [...flagCounts.entries()].map(([kind, n]) => ({ kind, ...n })),
      },
      notes,
    };
  }

  /** MG-Staff: everyone in the tree with role, team, who they report to and the account state. */
  async staff(actor: Actor, now: Date) {
    const tree = await this.tree.load(actor.id);
    const rows = tree.ids.length
      ? await this.prisma.staff.findMany({
          where: { id: { in: tree.ids } },
          select: {
            id: true,
            code: true,
            name: true,
            role: true,
            isIntern: true,
            status: true,
            lockedUntil: true,
            lockedByStaffId: true,
            lockedReason: true,
            failedLoginCount: true,
            reportsToId: true,
            teamLeadId: true,
            joinedOn: true,
            devices: { where: { status: { in: ['pending', 'approved'] } }, select: { id: true, label: true, platform: true, status: true, requestedAt: true } },
          },
        })
      : [];
    const bossIds = [...new Set(rows.map((r) => r.reportsToId).filter((x): x is string => Boolean(x)))];
    const bosses = bossIds.length ? await this.prisma.staff.findMany({ where: { id: { in: bossIds } }, select: { id: true, name: true, role: true } }) : [];
    const order = (p: TreePerson) => `${p.team ?? 'zz'}|${p.role === 'team_lead' ? 0 : 1}|${p.name}`;
    const people = [...tree.people].sort((x, y) => order(x).localeCompare(order(y)));
    return {
      manager: tree.manager,
      rows: people.map((p) => {
        const r = rows.find((x) => x.id === p.id);
        const boss = r?.reportsToId ? bosses.find((b) => b.id === r.reportsToId) : null;
        const lockedByManager = Boolean(r?.lockedByStaffId);
        const timedLock = Boolean(r?.lockedUntil && r.lockedUntil.getTime() > now.getTime());
        const pendingDevice = r?.devices.find((d) => d.status === 'pending') ?? null;
        let state: string = r ? staffState({ status: r.status, lockedUntil: r.lockedUntil }, now) : 'active';
        if (lockedByManager) state = 'locked';
        return {
          id: p.id,
          code: p.code,
          name: p.name,
          role: p.role,
          isIntern: p.isIntern,
          team: p.team,
          teamLeadId: p.teamLeadId,
          reportsTo: boss ? { id: boss.id, name: boss.name, role: boss.role, isYou: boss.id === actor.id } : null,
          state,
          locked: lockedByManager || timedLock
            ? { byManager: lockedByManager, until: timedLock ? (r?.lockedUntil as Date).toISOString() : null, reason: r?.lockedReason ?? (lockedByManager ? null : `${r?.failedLoginCount ?? 0} wrong passwords`) }
            : null,
          pendingDevice: pendingDevice ? { id: pendingDevice.id, label: pendingDevice.label, platform: pendingDevice.platform, requestedAt: pendingDevice.requestedAt?.toISOString() ?? null } : null,
          approvedDevices: (r?.devices ?? []).filter((d) => d.status === 'approved').map((d) => ({ id: d.id, label: d.label, platform: d.platform })),
          joinedOn: r?.joinedOn ? r.joinedOn.toISOString().slice(0, 10) : null,
        };
      }),
      /** Who a new person can report to: a Team Lead (for agents) or the Manager (for a new Team Lead). */
      reportsToOptions: [
        ...tree.leads.map((l) => ({ id: l.id, name: l.name, role: 'team_lead', team: l.team })),
        { id: tree.manager.id, name: tree.manager.name, role: 'manager', team: null },
      ],
      creatableRoles: ['team_lead', 'call_agent', 'field_agent'],
    };
  }

  /** MG-Attendance: everyone in the tree on one day (or totals for a longer period). */
  async attendance(actor: Actor, range: DateRange, now: Date) {
    const tree = await this.tree.load(actor.id);
    const from = dbDate(range.from);
    const to = dbDate(range.to);
    const single = from.getTime() === to.getTime();
    const today = dbDate(now);
    const rows = [];
    let lostToday = 0;
    for (const p of tree.people) {
      const d = await this.days.rowsBetween(p.id, from, to);
      const day = single ? (d[0] ?? null) : null;
      rows.push({
        staff: { id: p.id, code: p.code, name: p.name, role: p.role, isIntern: p.isIntern },
        team: p.team,
        dayId: day?.id ?? null,
        loginAt: day?.loginAt ?? null,
        logoutAt: day?.logoutAt ?? null,
        dayType: day?.dayType ?? null,
        countsAs: single ? (day ? countsAs(day) : from.getTime() <= today.getTime() ? 'Not logged in' : '—') : null,
        change: day?.change ?? null,
        productionSeconds: d.reduce((s, x) => s + x.productionSeconds, 0),
        lateMinutes: d.reduce((s, x) => s + x.lateMinutes, 0),
        lateDays: d.filter((x) => x.lateMinutes > 0).length,
        fullDays: d.filter((x) => x.dayType === 'full').length,
        halfDays: d.filter((x) => x.dayType === 'half').length,
        absentDays: d.filter((x) => x.dayType === 'absent').length,
        leaveDays: d.filter((x) => x.dayType === 'leave').length,
        lostSeconds: d.reduce((s, x) => s + lostSeconds(x), 0),
      });
    }
    const todayRange = { from: istStartOfDay(istDayKey(now)), to: now };
    const week = weekBuckets(now, 1)[0];
    const [todayTotals, weekTotals] = await Promise.all([
      this.plan.attendanceTotals(tree.ids, todayRange.from, todayRange.to, now),
      this.plan.attendanceTotals(tree.ids, week.from, week.to, now),
    ]);
    lostToday = todayTotals.lostSeconds;
    return {
      from: istDayKey(range.from),
      to: istDayKey(range.to),
      singleDay: single,
      teams: tree.leads.map((l) => ({ id: l.id, team: l.team })),
      rows,
      summary: {
        people: tree.people.length,
        atWork: single ? rows.filter((r) => r.loginAt).length : null,
        lateLogins: rows.reduce((s, r) => s + r.lateDays, 0),
        missing: single ? rows.filter((r) => r.countsAs === 'Not logged in' || r.dayType === 'absent').length : rows.reduce((s, r) => s + r.absentDays, 0),
        lostSeconds: rows.reduce((s, r) => s + r.lostSeconds, 0),
        lostTodaySeconds: lostToday,
        lostThisWeekSeconds: weekTotals.lostSeconds,
      },
    };
  }

  /** MG-LoginCodes: tiles and every code given to people in the tree in the period (the codes themselves are never stored). */
  async loginCodes(actor: Actor, range: DateRange, now: Date) {
    const tree = await this.tree.load(actor.id);
    const ids = tree.ids.length ? tree.ids : ['00000000-0000-0000-0000-000000000000'];
    const dayStart = istStartOfDay(istDayKey(now));
    const [waiting, codesToday, locked, given] = await Promise.all([
      this.prisma.loginCodeRequest.count({ where: { staffId: { in: ids }, status: 'pending', expiresAt: { gt: now } } }),
      this.prisma.loginCodeRequest.count({ where: { staffId: { in: ids }, revealedAt: { gte: dayStart, lte: now } } }),
      this.prisma.staff.count({ where: { id: { in: ids }, OR: [{ lockedUntil: { gt: now } }, { lockedByStaffId: { not: null } }] } }),
      this.prisma.loginCodeRequest.findMany({
        where: { staffId: { in: ids }, revealedAt: { gte: range.from, lte: range.to } },
        include: {
          staff: { select: { id: true, name: true, code: true } },
          revealedByStaff: { select: { id: true, name: true, role: true } },
          staffDevice: { select: { label: true } },
        },
        orderBy: { revealedAt: 'desc' },
        take: 500,
      }),
    ]);
    return {
      summary: { waiting, codesToday, locked },
      codes: given.map((r) => ({
        id: r.id,
        at: (r.revealedAt as Date).toISOString(),
        to: r.staff,
        givenBy: r.revealedByStaff ? { ...r.revealedByStaff, isYou: r.revealedByStaff.id === actor.id } : null,
        device: r.staffDevice.label,
        used: Boolean(r.usedAt),
      })),
    };
  }

  // ------------------------------------------------------------- notes

  async notesFor(staffId: string) {
    const rows = await this.prisma.staffCoachingNote.findMany({
      where: { staffId },
      include: { author: { select: { id: true, name: true, role: true } } },
      orderBy: { createdAt: 'desc' },
      take: 50,
    });
    return rows.map((r) => ({ id: r.id, kind: r.kind, text: r.text, createdAt: r.createdAt.toISOString(), author: r.author }));
  }

  /**
   * A coaching note or a written warning about someone in the Manager's tree
   * (guide, People: "coaching notes and warnings, seen by the agent's Team
   * Lead and Managers"; a Team Lead cannot give a written warning — the
   * Manager decides). Audit-logged without the note's text.
   */
  async addNote(actor: Actor, staffId: string, body: { kind?: unknown; text?: unknown }, now: Date) {
    const kind = body?.kind === undefined ? 'note' : body.kind;
    if (typeof kind !== 'string' || !(NOTE_KINDS as readonly string[]).includes(kind)) {
      throw new BadRequestException("kind is 'note' or 'written_warning'");
    }
    const text = typeof body?.text === 'string' ? body.text.trim() : '';
    if (!text) throw new BadRequestException(kind === 'written_warning' ? 'Write what the warning is for' : 'Write the note');
    if (text.length > MAX_NOTE_LENGTH) throw new BadRequestException(`A note is at most ${MAX_NOTE_LENGTH} characters`);
    const tree = await this.tree.load(actor.id);
    const person = await this.tree.person(tree, staffId);
    if (person.id === actor.id) throw new ForbiddenException('You cannot write a note about yourself');
    const note = await this.prisma.staffCoachingNote.create({
      data: { staffId: person.id, authorStaffId: actor.id, kind, text, createdAt: now },
    });
    await this.audit.log({
      actorId: actor.id,
      action: kind === 'written_warning' ? 'staff.written_warning_given' : 'staff.coaching_note_added',
      entityType: 'staff',
      entityCode: person.code,
      before: null,
      after: { coachingNoteId: note.id, kind },
    });
    return { id: note.id, kind: note.kind, text: note.text, createdAt: note.createdAt.toISOString() };
  }
}

export type { ManagerTree };
