import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.service';
import { AuditService } from '../../common/audit/audit.service';
import { IdService } from '../../common/id/id.service';
import { AttendanceReportsService } from '../attendance/attendance-reports.service';
import { AttendanceRequestsService } from '../attendance/attendance-requests.service';
import { LeaveService, monthOf } from '../attendance/leave.service';
import { RefundPriorityService } from '../refund-priority/refund-priority.service';
import { ReviewFlagService } from '../review-flag/review-flag.service';
import { NotificationService } from '../notification/notification.service';
import { MONEY_FLAG_KINDS, flagTitle } from '../notification/notification.constants';
import { DAY_MS, DateRange, average, countBy, istDayKey, istStartOfDay, percent } from '../ceo-portal/ceo-common';
import { FOLLOW_UP_GROUPS } from '../ceo-portal/ceo-ops.service';
import { ManagerTree, ManagerTreeService } from './manager-tree.service';
import { dbDate } from './manager-plan.service';

type Actor = { id: string; role: string };

/** Flags a Manager may not close: anything about money or bypass goes to the CEO (MG-Flags). */
export const CEO_FLAG_KINDS: readonly string[] = [...MONEY_FLAG_KINDS, 'bypass_suspected'];

export const STUCK_KINDS = ['registrations', 'vacancies', 'interview_results', 'offers', 'no_vacancy'] as const;
export type StuckKind = (typeof STUCK_KINDS)[number];

const STUCK_TEXT: Record<StuckKind, string> = {
  registrations: 'Registration links not finished for over 24 hours — please follow up today',
  vacancies: 'Vacancies open for more than 15 days — find matches or revisit the business',
  interview_results: "Interview results are overdue — call the owner for the result",
  offers: "Offers are waiting for the candidate's reply — call them",
  no_vacancy: 'Businesses with no vacancy since onboarding — plan a follow-up visit',
};

const BUSY = ['on_call', 'after_call_notes', 'on_visit', 'travelling'];

/**
 * Work screens of the Manager portal: Pipeline (MG-Pipeline), Call center
 * (MG-CallCenter), Field ops (MG-FieldOps), Flags (MG-Flags) and Leave
 * (MG-Leave). Counts and work lists for the Manager's own tree only, phone
 * numbers masked by the interceptor, no rupee figure anywhere.
 */
@Injectable()
export class ManagerOpsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly ids: IdService,
    private readonly tree: ManagerTreeService,
    private readonly reports: AttendanceReportsService,
    private readonly requests: AttendanceRequestsService,
    private readonly leave: LeaveService,
    private readonly priority: RefundPriorityService,
    private readonly flags: ReviewFlagService,
    private readonly notifications: NotificationService,
  ) {}

  private some(ids: string[]): string[] {
    return ids.length ? ids : ['00000000-0000-0000-0000-000000000000'];
  }

  // ------------------------------------------------------------ pipeline

  private async stuckWork(tree: ManagerTree, now: Date) {
    const ids = this.some(tree.ids);
    const dayAgo = new Date(now.getTime() - DAY_MS);
    const [regs, oldVacancies, overdue, offers, businesses] = await Promise.all([
      this.prisma.jobSeeker.findMany({
        where: { registeredByStaffId: { in: ids }, status: { in: ['lead', 'consented', 'pending_activation'] }, paymentReceivedAt: null, anonymisedAt: null, createdAt: { lte: dayAgo, gte: new Date(now.getTime() - 30 * DAY_MS) } },
        select: { registeredByStaffId: true, status: true },
      }),
      this.prisma.vacancy.findMany({
        where: { status: 'open', createdAt: { lte: new Date(now.getTime() - 15 * DAY_MS) }, OR: [{ capturedByStaffId: { in: ids } }, { business: { accountAgentId: { in: ids } } }] },
        select: { tradeSkill: true, capturedByStaffId: true, business: { select: { accountAgentId: true } } },
      }),
      this.prisma.interview.findMany({
        where: { proposedByStaffId: { in: ids }, resultDueAt: { lt: now }, resultRecordedAt: null, status: { in: ['confirmed', 'completed', 'no_result'] } },
        select: { proposedByStaffId: true },
      }),
      this.prisma.interview.findMany({ where: { proposedByStaffId: { in: ids }, status: 'offered', replyDueAt: { gt: now } }, select: { proposedByStaffId: true, offerSentAt: true } }),
      this.prisma.business.findMany({
        where: { accountAgentId: { in: ids }, agreements: { some: {} }, vacancies: { none: {} }, anonymisedAt: null },
        select: { accountAgentId: true },
      }),
    ]);
    const statusWords: Record<string, string> = { lead: 'before consent', consented: 'after consent, before paying', pending_activation: 'at payment' };
    const commonStop = countBy(regs, (r) => statusWords[r.status] ?? r.status)[0];
    const trades = countBy(oldVacancies, (v) => v.tradeSkill)
      .slice(0, 3)
      .map((t) => (t.count > 1 ? `${t.name} ×${t.count}` : t.name))
      .join(', ');
    const uniq = (xs: (string | null | undefined)[]) => [...new Set(xs.filter((x): x is string => Boolean(x)))];
    return [
      { kind: 'registrations' as StuckKind, label: 'Registration links not finished > 24 h', count: regs.length, why: commonStop ? `Most stop ${commonStop.name}` : null, agentIds: uniq(regs.map((r) => r.registeredByStaffId)) },
      { kind: 'vacancies' as StuckKind, label: 'Vacancies open more than 15 days', count: oldVacancies.length, why: trades || null, agentIds: uniq(oldVacancies.map((v) => v.business.accountAgentId ?? v.capturedByStaffId)) },
      { kind: 'interview_results' as StuckKind, label: 'Interview results overdue (owner)', count: overdue.length, why: overdue.length ? 'Agent calling the owner' : null, agentIds: uniq(overdue.map((i) => i.proposedByStaffId)) },
      { kind: 'offers' as StuckKind, label: "Offers waiting for the candidate's reply", count: offers.length, why: offers.some((o) => now.getTime() - o.offerSentAt.getTime() > DAY_MS) ? 'Reminder sent after 24 h' : null, agentIds: uniq(offers.map((o) => o.proposedByStaffId)) },
      { kind: 'no_vacancy' as StuckKind, label: 'Businesses with no vacancy after onboarding', count: businesses.length, why: businesses.length ? 'Follow-up visit due' : null, agentIds: uniq(businesses.map((b) => b.accountAgentId)) },
    ];
  }

  /** MG-Pipeline: the funnel as counts, close to a refund (priority), stuck work and the oldest vacancies. */
  async pipeline(actor: Actor, range: DateRange, now: Date) {
    const tree = await this.tree.load(actor.id);
    const ids = this.some(tree.ids);
    const [counts, near, stuck, vacancies] = await Promise.all([
      this.tree.counts(tree.ids, range),
      this.priority.list({ id: actor.id, role: 'manager' }, {}, now),
      this.stuckWork(tree, now),
      this.prisma.vacancy.findMany({
        where: { status: 'open', OR: [{ capturedByStaffId: { in: ids } }, { business: { accountAgentId: { in: ids } } }] },
        orderBy: { createdAt: 'asc' },
        take: 10,
        select: {
          id: true,
          code: true,
          tradeSkill: true,
          locality: true,
          createdAt: true,
          headcount: true,
          business: { select: { id: true, name: true, locality: true, accountAgentId: true } },
          capturedByStaffId: true,
          _count: { select: { candidateIntroductions: true, placements: true } },
        },
      }),
    ]);
    const seekerIds = near.rows.filter((r) => r.kind === 'job_seeker').map((r) => r.id);
    const interviews = seekerIds.length
      ? await this.prisma.interview.findMany({ where: { jobSeekerId: { in: seekerIds } }, select: { jobSeekerId: true, status: true, slotStartsAt: true, offerSentAt: true }, orderBy: { offerSentAt: 'desc' } })
      : [];
    const today = istDayKey(now);
    const tomorrow = istDayKey(new Date(now.getTime() + DAY_MS));
    const standing = (id: string): string => {
      const mine = interviews.filter((i) => i.jobSeekerId === id);
      if (!mine.length) return 'No interview yet';
      const upcoming = mine.find((i) => ['offered', 'confirmed'].includes(i.status) && i.slotStartsAt.getTime() > now.getTime());
      if (upcoming) {
        const day = istDayKey(upcoming.slotStartsAt);
        if (upcoming.status === 'offered') return istDayKey(upcoming.offerSentAt) === today ? 'Offer sent today' : 'Offer waiting for reply';
        return day === today ? 'Interview today' : day === tomorrow ? 'Interview tomorrow' : `Interview on ${day}`;
      }
      const done = mine.filter((i) => ['completed', 'no_result'].includes(i.status)).length;
      return `${done || mine.length} interview${(done || mine.length) === 1 ? '' : 's'} so far`;
    };
    const teamOf = new Map(tree.people.map((p) => [p.id, p.team]));
    const nameOf = new Map(tree.people.map((p) => [p.id, p.name]));
    const agentName = (id: string | null) => (id ? { id, name: nameOf.get(id) ?? '—' } : null);
    return {
      funnel: {
        registered: counts.registered,
        paid: counts.paid,
        interviewed: counts.interviewsDone,
        offered: counts.offered,
        placed: counts.placed,
        daysToFill: counts.daysToFill,
      },
      closeToRefund: {
        windowDays: near.windowDays,
        total: near.totals.count,
        jobSeekers: near.totals.jobSeekers,
        businesses: near.totals.businesses,
        buckets: near.buckets.map((b) => ({ bucket: b.bucket, count: b.count })),
        rows: near.rows.map((r) => ({
          kind: r.kind,
          id: r.id,
          code: r.code,
          name: r.name,
          trade: r.trade,
          daysLeft: r.daysLeft,
          bucket: r.bucket,
          businessName: r.businessName,
          agent: r.agent,
          team: r.agent ? (teamOf.get(r.agent.id) ?? null) : null,
          standing: r.kind === 'job_seeker' ? standing(r.id) : 'Replacement not found yet',
        })),
      },
      stuck: stuck.map(({ agentIds, ...rest }) => ({ ...rest, agents: agentIds.length })),
      oldestVacancies: vacancies.map((v) => ({
        id: v.id,
        code: v.code,
        trade: v.tradeSkill,
        business: { id: v.business.id, name: v.business.name },
        area: v.locality ?? v.business.locality,
        openDays: Math.floor((now.getTime() - v.createdAt.getTime()) / DAY_MS),
        shown: v._count.candidateIntroductions,
        selected: v._count.placements,
        headcount: v.headcount,
        accountAgent: agentName(v.business.accountAgentId ?? v.capturedByStaffId),
      })),
    };
  }

  /**
   * "Remind the agent" on a close-to-refund row: the same follow-up task the
   * CEO's Close to a refund list creates (kind refund_priority_call, one open
   * task per record), for records whose agent is in the Manager's tree.
   */
  async remindRefund(actor: Actor, body: { kind?: string; id?: string }, now: Date) {
    const kind = body?.kind;
    const id = body?.id;
    if ((kind !== 'job_seeker' && kind !== 'placement' && kind !== 'business') || !id) {
      throw new BadRequestException('kind (job_seeker or placement) and id are required');
    }
    let subjectType: 'job_seeker' | 'business';
    let subjectId: string;
    let subjectCode: string;
    let agentId: string | null;
    let relatedId: string | null = null;
    if (kind === 'job_seeker') {
      const seeker = await this.prisma.jobSeeker.findUnique({ where: { id }, select: { id: true, code: true, registeredByStaffId: true } });
      if (!seeker) throw new NotFoundException(`Job seeker '${id}' not found`);
      subjectType = 'job_seeker';
      subjectId = seeker.id;
      subjectCode = seeker.code;
      agentId = seeker.registeredByStaffId;
    } else {
      const placement = await this.prisma.placement.findUnique({ where: { id }, select: { id: true, code: true, business: { select: { id: true, accountAgentId: true } } } });
      if (!placement) throw new NotFoundException(`Placement '${id}' not found`);
      subjectType = 'business';
      subjectId = placement.business.id;
      subjectCode = placement.code;
      agentId = placement.business.accountAgentId;
      relatedId = placement.id;
    }
    if (!agentId) throw new BadRequestException('Nobody is assigned to this record yet, so there is no agent to remind');
    const tree = await this.tree.load(actor.id);
    if (!tree.ids.includes(agentId)) throw new ForbiddenException('That agent is not in your teams');

    const existing = await this.prisma.followUpTask.findFirst({ where: { kind: 'refund_priority_call', subjectType, subjectId, status: 'pending' } });
    if (existing) return { created: false, taskCode: existing.code };
    const code = await this.ids.generateCode('follow_up_task');
    await this.prisma.followUpTask.create({
      data: { code, kind: 'refund_priority_call', subjectType, subjectId, relatedType: relatedId ? 'placement' : null, relatedId, dueAt: now, assignedStaffId: agentId },
    });
    await this.audit.log({
      actorId: actor.id,
      action: 'refund_priority_reminder_sent',
      entityType: subjectType,
      entityCode: subjectCode,
      after: { followUpTaskCode: code, assignedStaffId: agentId },
      changedFields: ['followUpTask'],
    });
    return { created: true, taskCode: code };
  }

  /** "Remind the agents" on a stuck-work row: a bell for each agent with that work (one a day per kind). */
  async remindStuck(actor: Actor, kind: string, now: Date) {
    if (!(STUCK_KINDS as readonly string[]).includes(kind)) {
      throw new BadRequestException(`kind is one of ${STUCK_KINDS.join(', ')}`);
    }
    const tree = await this.tree.load(actor.id);
    const row = (await this.stuckWork(tree, now)).find((r) => r.kind === kind);
    const agentIds = (row?.agentIds ?? []).filter((id) => tree.ids.includes(id));
    if (!agentIds.length) return { reminded: 0 };
    const roles = new Map(tree.people.map((p) => [p.id, p.role]));
    let reminded = 0;
    for (const recipientStaffId of agentIds) {
      const role = roles.get(recipientStaffId) ?? 'call_agent';
      const opened = await this.notifications.open(
        {
          recipientStaffId,
          kind: 'stuck_work_reminder',
          title: STUCK_TEXT[kind as StuckKind],
          body: `From your Manager, ${tree.manager.name}`,
          link: role === 'call_agent' ? '/call-agent' : role === 'team_lead' ? '/team-lead/work' : null,
          subjectType: 'stuck_work',
          subjectId: `${kind}:${istDayKey(now)}`,
          once: true,
        },
        now,
      );
      if (opened) reminded += 1;
    }
    await this.audit.log({
      actorId: actor.id,
      action: 'manager.stuck_work_reminded',
      entityType: 'stuck_work',
      entityCode: kind,
      after: { agents: agentIds.length, reminded },
    });
    return { reminded };
  }

  // ---------------------------------------------------------- call center

  /** MG-CallCenter: every call agent in the tree today (or the period), live. */
  async callCenter(actor: Actor, range: DateRange, now: Date) {
    const tree = await this.tree.load(actor.id);
    const agents = tree.agents.filter((a) => a.role === 'call_agent');
    const ids = this.some(agents.map((a) => a.id));
    const [live, calls, registered, paid, followUps, missed] = await Promise.all([
      this.reports.liveBoard(actor),
      this.prisma.callRecord.findMany({ where: { staffId: { in: ids }, createdAt: { gte: range.from, lte: range.to } }, select: { staffId: true, answered: true, durationSec: true } }),
      this.prisma.jobSeeker.groupBy({ by: ['registeredByStaffId'], where: { registeredByStaffId: { in: ids }, createdAt: { gte: range.from, lte: range.to } }, _count: { _all: true } }),
      this.prisma.jobSeeker.groupBy({ by: ['registeredByStaffId'], where: { registeredByStaffId: { in: ids }, paymentReceivedAt: { gte: range.from, lte: range.to } }, _count: { _all: true } }),
      this.prisma.followUpTask.findMany({ where: { assignedStaffId: { in: ids }, status: 'pending', dueAt: { lt: now } }, select: { kind: true, assignedStaffId: true, dueAt: true } }),
      this.prisma.callbackTask.findMany({
        where: { status: { in: ['pending', 'assigned'] }, OR: [{ assignedToStaffId: { in: ids } }, { assignedToStaffId: null }] },
        select: { id: true, createdAt: true, status: true, callerName: true, phone: true, assignedToStaff: { select: { id: true, name: true } } },
        orderBy: { createdAt: 'desc' },
        take: 50,
      }),
    ]);
    const liveById = new Map(live.people.map((p) => [p.staff.id, p]));
    const rows = agents.map((a) => {
      const mine = calls.filter((c) => c.staffId === a.id);
      const answered = mine.filter((c) => c.answered);
      const lv = liveById.get(a.id);
      return {
        staff: { id: a.id, code: a.code, name: a.name, role: a.role, isIntern: a.isIntern },
        team: a.team,
        now: lv ? { status: lv.status, since: lv.since, overBreak: lv.overBreak, idleSeconds: lv.idleSeconds } : null,
        calls: mine.length,
        answered: answered.length,
        connectPercent: percent(answered.length, mine.length),
        talkSeconds: answered.reduce((s, c) => s + (c.durationSec ?? 0), 0),
        registered: registered.find((r) => r.registeredByStaffId === a.id)?._count._all ?? 0,
        paid: paid.find((r) => r.registeredByStaffId === a.id)?._count._all ?? 0,
        followUpsOverdue: followUps.filter((f) => f.assignedStaffId === a.id).length,
      };
    });
    const answeredAll = calls.filter((c) => c.answered);
    return {
      summary: {
        onCallsNow: rows.filter((r) => r.now && BUSY.includes(r.now.status)).length,
        calls: calls.length,
        connectPercent: percent(answeredAll.length, calls.length),
        registrations: rows.reduce((s, r) => s + r.registered, 0),
        followUpsOverdue: followUps.length,
        missedIncoming: missed.filter((m) => m.status === 'pending').length,
        averageTalkSeconds: average(answeredAll.map((c) => c.durationSec ?? 0)),
      },
      rows,
      overdueFollowUps: FOLLOW_UP_GROUPS.map((g) => ({ key: g.key, label: g.label, overdue: followUps.filter((f) => g.kinds.includes(f.kind)).length })).concat([
        { key: 'refund_priority', label: 'Close to a refund · called first', overdue: followUps.filter((f) => f.kind === 'refund_priority_call').length },
      ]),
      missed: missed.map((m) => ({ id: m.id, at: m.createdAt.toISOString(), callerName: m.callerName, phone: m.phone, status: m.status, assignedTo: m.assignedToStaff })),
    };
  }

  // ------------------------------------------------------------ field ops

  /** MG-FieldOps: visits, proof checks, onboarding and visit requests to assign, for field agents in the tree. */
  async fieldOps(actor: Actor, range: DateRange, now: Date) {
    const tree = await this.tree.load(actor.id);
    const agents = tree.agents.filter((a) => a.role === 'field_agent');
    const ids = this.some(agents.map((a) => a.id));
    const weekStart = istStartOfDay(istDayKey(new Date(now.getTime() - 6 * DAY_MS)));
    const [live, visits, weekVisits, onboarded, flags, assignments] = await Promise.all([
      this.reports.liveBoard(actor),
      this.prisma.businessVisit.findMany({
        where: { staffId: { in: ids }, visitedAt: { gte: range.from, lte: range.to } },
        select: { id: true, staffId: true, boardPhotoPath: true, selfieUrl: true, photoLive: true, geofenceFlag: true, gpsSuspect: true, durationSeconds: true, outcome: true },
      }),
      this.prisma.businessVisit.groupBy({ by: ['staffId'], where: { staffId: { in: ids }, visitedAt: { gte: weekStart, lte: now } }, _count: { _all: true } }),
      this.prisma.businessAgreement.findMany({
        where: { signedAt: { gte: range.from, lte: range.to }, business: { OR: [{ accountAgentId: { in: ids } }, { leadCreatedByStaffId: { in: ids } }] } },
        distinct: ['businessId'],
        select: { business: { select: { accountAgentId: true, leadCreatedByStaffId: true } } },
      }),
      this.prisma.reviewFlag.findMany({ where: { status: 'open', raisedForStaffId: { in: ids } }, select: { kind: true, raisedForStaffId: true } }),
      this.prisma.visitAssignment.findMany({
        where: { status: { in: ['pending', 'assigned'] }, assignedStaffId: null, OR: [{ suggestedStaffId: { in: ids } }, { suggestedStaffId: null }] },
        include: { business: { select: { id: true, code: true, name: true, locality: true } }, suggestedStaff: { select: { id: true, name: true } } },
        orderBy: { createdAt: 'asc' },
        take: 50,
      }),
    ]);
    const liveById = new Map(live.people.map((p) => [p.staff.id, p]));
    const rows = agents.map((a) => {
      const mine = visits.filter((v) => v.staffId === a.id);
      const proofed = mine.filter((v) => v.boardPhotoPath && v.selfieUrl && !v.geofenceFlag).length;
      const myFlags = flags.filter((f) => f.raisedForStaffId === a.id);
      return {
        staff: { id: a.id, code: a.code, name: a.name, role: a.role, isIntern: a.isIntern },
        team: a.team,
        now: liveById.get(a.id)?.status ?? 'not_logged_in',
        visits: mine.length,
        withProof: proofed,
        onboarded: onboarded.filter((b) => (b.business.accountAgentId ?? b.business.leadCreatedByStaffId) === a.id).length,
        shortVisits: myFlags.filter((f) => f.kind === 'visit_short').length,
        flags: myFlags.map((f) => flagTitle(f.kind)),
      };
    });
    const visitsByTeam = tree.leads.map((l) => ({
      teamLeadId: l.id,
      team: l.team,
      visitsThisWeek: weekVisits.filter((w) => agents.find((a) => a.id === w.staffId)?.teamLeadId === l.id).reduce((s, w) => s + w._count._all, 0),
    }));
    return {
      summary: {
        visits: visits.length,
        onboarded: onboarded.length,
        requestsToAssign: assignments.length,
        shortVisitsFlagged: flags.filter((f) => f.kind === 'visit_short').length,
        proofProblems: visits.filter((v) => v.geofenceFlag || v.gpsSuspect || v.photoLive === false).length,
      },
      visitsByTeam,
      rows,
      requests: assignments.map((a) => ({
        id: a.id,
        business: a.business,
        purpose: a.purpose,
        createdAt: a.createdAt.toISOString(),
        suggested: a.suggestedStaff,
      })),
      agents: agents.map((a) => ({ id: a.id, name: a.name, onLeave: liveById.get(a.id)?.status === 'on_leave' })),
    };
  }

  // ---------------------------------------------------------------- flags

  async flagList(actor: Actor, now: Date) {
    const tree = await this.tree.load(actor.id);
    const ids = this.some(tree.ids);
    const monthStart = istStartOfDay(`${istDayKey(now).slice(0, 8)}01`);
    const [open, resolvedThisMonth] = await Promise.all([
      this.prisma.reviewFlag.findMany({
        where: { status: 'open', raisedForStaffId: { in: ids } },
        include: { raisedForStaff: { select: { id: true, code: true, name: true, role: true } } },
        orderBy: { raisedAt: 'desc' },
        take: 500,
      }),
      this.prisma.reviewFlag.count({ where: { status: { in: ['resolved', 'dismissed'] }, raisedForStaffId: { in: ids }, resolvedAt: { gte: monthStart } } }),
    ]);
    const teamOf = new Map(tree.people.map((p) => [p.id, p]));
    return {
      summary: {
        open: open.length,
        forCeo: open.filter((f) => CEO_FLAG_KINDS.includes(f.kind)).length,
        resolvedThisMonth,
      },
      rows: open.map((f) => {
        const person = f.raisedForStaffId ? teamOf.get(f.raisedForStaffId) : undefined;
        return {
          id: f.id,
          code: f.code,
          kind: f.kind,
          title: flagTitle(f.kind),
          subjectType: f.subjectType,
          subjectId: f.subjectId,
          details: f.details,
          raisedAt: f.raisedAt.toISOString(),
          staff: f.raisedForStaff,
          team: person?.team ?? null,
          isIntern: person?.isIntern ?? false,
          goesToCeo: CEO_FLAG_KINDS.includes(f.kind),
        };
      }),
    };
  }

  /** Resolve a flag about someone in the tree; money and bypass flags are the CEO's. */
  async resolveFlag(actor: Actor, id: string, body: { resolution?: string; status?: string }) {
    const flag = await this.prisma.reviewFlag.findUnique({ where: { id }, select: { id: true, kind: true, raisedForStaffId: true } });
    if (!flag) throw new NotFoundException(`Review flag '${id}' not found`);
    if (CEO_FLAG_KINDS.includes(flag.kind)) {
      throw new ForbiddenException('Flags about money or bypass go to the CEO');
    }
    const tree = await this.tree.load(actor.id);
    if (!flag.raisedForStaffId || !tree.ids.includes(flag.raisedForStaffId)) {
      throw new ForbiddenException('This flag is not about anyone in your teams');
    }
    return this.flags.resolve(id, actor, { resolution: body?.resolution ?? '', status: (body?.status ?? 'resolved') as 'resolved' | 'dismissed' });
  }

  // ---------------------------------------------------------------- leave

  /** MG-Leave: who is off, every leave request in the tree and where it is, heavy planned leave, balances. */
  async leaveBoard(actor: Actor, now: Date) {
    const tree = await this.tree.load(actor.id);
    const ids = this.some(tree.ids);
    const today = dbDate(now);
    const in14 = new Date(today.getTime() + 14 * DAY_MS);
    const in7 = new Date(today.getTime() + 7 * DAY_MS);
    const month = monthOf(today);
    const [team, upcoming] = await Promise.all([
      this.requests.team(actor),
      this.prisma.leaveRequest.findMany({
        where: { staffId: { in: ids }, status: { in: ['pending', 'approved'] }, toDate: { gte: today }, fromDate: { lte: in14 } },
        select: { id: true, staffId: true, kind: true, fromDate: true, toDate: true, days: true, status: true },
        orderBy: { fromDate: 'asc' },
      }),
    ]);
    const leaveRequests = (team as Array<{ kind: string; id: string }>).filter((r) => r.kind === 'leave') as unknown as Array<{
      id: string;
      staff: { id: string } | null;
      status: string;
      where: string;
      withTeamLead: boolean;
      withManager: boolean;
      withCeo: boolean;
      decided: { by: { id: string; name: string; role: string } | null } | null;
      createdAt: string;
    }>;
    const view = new Map(leaveRequests.map((r) => [r.id, r]));
    const person = new Map(tree.people.map((p) => [p.id, p]));
    const offRows = upcoming.map((l) => {
      const v = view.get(l.id);
      const p = person.get(l.staffId);
      return {
        id: l.id,
        staff: p ? { id: p.id, name: p.name, role: p.role, isIntern: p.isIntern } : { id: l.staffId, name: '—', role: '', isIntern: false },
        team: p?.team ?? null,
        kind: l.kind,
        from: istDayKey(l.fromDate),
        to: istDayKey(l.toDate),
        days: l.days,
        status: l.status,
        where: v?.where ?? l.status,
        withTeamLead: v?.withTeamLead ?? false,
        withManager: v?.withManager ?? false,
        decidedBy: v?.decided?.by ? { name: v.decided.by.name, role: v.decided.by.role, isYou: v.decided.by.id === actor.id } : null,
        waitingHours: l.status === 'pending' && v ? Math.floor((now.getTime() - new Date(v.createdAt).getTime()) / 3_600_000) : null,
      };
    });
    const balances = [];
    const heavy = [];
    for (const p of tree.people) {
      const bal = await this.leave.balance(p.id);
      const used = await this.prisma.leaveRequest.findMany({
        where: { staffId: p.id, status: 'approved', fromDate: { lte: new Date(`${month}-31T00:00:00.000Z`) }, toDate: { gte: new Date(`${month}-01T00:00:00.000Z`) } },
        select: { kind: true, days: true, fromDate: true, toDate: true },
      });
      const casualUsed = used.filter((u) => u.kind === 'casual').reduce((s, u) => s + u.days, 0);
      const emergencyUsed = used.filter((u) => u.kind === 'emergency').reduce((s, u) => s + u.days, 0);
      balances.push({
        staff: { id: p.id, name: p.name, role: p.role, isIntern: p.isIntern },
        team: p.team,
        plannedLeft: bal.casual.left,
        emergencyLeft: bal.emergency.left,
        plannedUsedThisMonth: casualUsed,
        emergencyUsedThisMonth: emergencyUsed,
      });
      const casual = await this.leave.casualDaysInMonth(p.id, month);
      const pendingOver = upcoming.find((l) => l.staffId === p.id && l.status === 'pending' && l.kind === 'casual' && monthOf(l.fromDate) === month);
      if (casual.taken >= 3 || casual.taken + casual.pending > 3) {
        heavy.push({
          staff: { id: p.id, name: p.name, role: p.role, isIntern: p.isIntern },
          team: p.team,
          taken: casual.taken,
          takenDates: used.filter((u) => u.kind === 'casual').map((u) => ({ from: istDayKey(u.fromDate), to: istDayKey(u.toDate) })),
          pending: casual.pending,
          wouldBe: casual.taken + casual.pending,
          requestId: pendingOver?.id ?? null,
        });
      }
    }
    return {
      month,
      summary: {
        offToday: upcoming.filter((l) => l.status === 'approved' && l.fromDate.getTime() <= today.getTime() && l.toDate.getTime() >= today.getTime()).length,
        offNext7: new Set(upcoming.filter((l) => l.status === 'approved' && l.fromDate.getTime() <= in7.getTime()).map((l) => l.staffId)).size,
        withTeamLeads: leaveRequests.filter((r) => r.status === 'pending' && r.withTeamLead && !r.withManager).length,
        waitingForYou: leaveRequests.filter((r) => r.status === 'pending' && r.withManager).length,
        atOrOver3: heavy.length,
      },
      off: offRows,
      heavy,
      balances,
    };
  }
}
