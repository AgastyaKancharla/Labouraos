import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, SignupTracker } from '@prisma/client';
import { PrismaService } from '../../common/prisma/prisma.service';
import { AuditService } from '../../common/audit/audit.service';
import { maskPhoneLast4 } from '../../common/rbac/pii-masking.interceptor';
import { CALL_TASK_KIND_SIGNUP_HELP } from '../../common/customer-auth/customer-app.constants';
import { PricingService } from '../pricing/pricing.service';
import { SignupFactsService } from './signup-facts.service';
import { SignupTrackerClock } from './signup-tracker-clock';
import { REENGAGE_OUTCOMES } from './signup-tracker.service';
import { STAGE_ORDER, scriptHintKey } from './signup-stage';
import { missingSettingColumns, signupSettingsFrom } from './signup-settings';
import { DAY_MS } from './signup-timing';
import { OwnTeam } from '../../common/rbac/own-team';

/** Languages a staff member can be marked as speaking (the same list as the job seeker form). */
export const STAFF_LANGUAGES = [
  'Kannada', 'Hindi', 'English', 'Tamil', 'Telugu', 'Malayalam', 'Urdu', 'Marathi', 'Bengali', 'Odia', 'Assamese', 'Nepali',
] as const;

const KINDS = ['job_seeker', 'business', 'referral'] as const;
const ROW_LIMIT = 200;
/** A sign-up help task this long past due, still open, is overdue on the Team Lead's page. */
const OVERDUE_MS = 60 * 60 * 1000;
/** The office screens' default period: the last month (a view setting, not a rule). */
const DEFAULT_VIEW_DAYS = 30;
/** Finished sign-ups sampled for the typical time to finish. */
const MEDIAN_SAMPLE = 2000;
/** Most recent sign-ups read for the area tables. */
const AREA_SAMPLE = 2000;

export interface Actor {
  id: string;
  role: string;
}

export interface Brief {
  id: string;
  code: string;
  name: string;
}

export interface SignupRow {
  id: string;
  kind: string;
  code: string | null;
  name: string;
  maskedPhone: string | null;
  area: string | null;
  stage: string;
  stageReachedAt: string;
  step: string;
  missing: string[];
  stuckReason: string | null;
  scriptHint: string;
  source: string | null;
  contactConsent: boolean;
  assignedTo: Brief | null;
  assignmentReason: string | null;
  callTries: number;
  remindersSent: number;
  nextActionAt: string | null;
  openTask: { id: string; dueAt: string; overdue: boolean } | null;
  outcome: string;
  startedAt: string;
  finishedAt: string | null;
}

type Funnel = Record<string, Record<string, number>>;

function emptyFunnel(): Funnel {
  return Object.fromEntries(KINDS.map((k) => [k, Object.fromEntries(STAGE_ORDER.map((s) => [s, 0]))]));
}

/**
 * Reads for the App sign-ups screens: Team Lead (own team, reassign), Manager
 * (counts and funnels, no money, no names), CEO (funnels by stage, kind and
 * area, and the list). Phone numbers are the last 4 digits only. There is no
 * rupee figure anywhere in these answers.
 */
@Injectable()
export class SignupViewsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly pricing: PricingService,
    private readonly audit: AuditService,
    private readonly facts: SignupFactsService,
    private readonly clock: SignupTrackerClock,
  ) {}

  // ------------------------------------------------------------ rows

  async rows(trackers: SignupTracker[], now: Date): Promise<SignupRow[]> {
    if (trackers.length === 0) return [];
    const ids = trackers.map((t) => t.id);
    const ofType = (type: string) => [...new Set(trackers.filter((t) => t.subjectType === type && t.subjectId).map((t) => t.subjectId!))];
    const accountIds = [...new Set(trackers.map((t) => t.accountId).filter((a): a is string => Boolean(a)))];
    const staffIds = [...new Set(trackers.map((t) => t.assignedStaffId).filter((a): a is string => Boolean(a)))];
    const [seekers, businesses, referrals, accounts, staff, tasks] = await Promise.all([
      this.prisma.jobSeeker.findMany({ where: { id: { in: ofType('job_seeker') } }, select: { id: true, code: true, name: true, phone: true, locality: true } }),
      this.prisma.business.findMany({ where: { id: { in: ofType('business') } }, select: { id: true, code: true, name: true, phone: true, locality: true } }),
      this.prisma.referral.findMany({ where: { id: { in: ofType('referral') } }, select: { id: true, code: true, name: true, phone: true, locality: true } }),
      this.prisma.customerAccount.findMany({ where: { id: { in: accountIds } }, select: { id: true, displayName: true, phone: true } }),
      this.prisma.staff.findMany({ where: { id: { in: staffIds } }, select: { id: true, code: true, name: true } }),
      this.prisma.callTask.findMany({
        where: { signupTrackerId: { in: ids }, kind: CALL_TASK_KIND_SIGNUP_HELP, status: 'open' },
        select: { id: true, signupTrackerId: true, dueAt: true },
      }),
    ]);
    const subjects = new Map<string, { code: string; name: string; phone: string; locality: string | null }>();
    for (const s of [...seekers, ...businesses, ...referrals]) subjects.set(s.id, s);
    const accountBy = new Map(accounts.map((a) => [a.id, a]));
    const staffBy = new Map(staff.map((s) => [s.id, s]));
    const taskBy = new Map(tasks.map((t) => [t.signupTrackerId!, t]));
    const out: SignupRow[] = [];
    for (const t of trackers) {
      const subject = t.subjectId ? subjects.get(t.subjectId) : undefined;
      const account = t.accountId ? accountBy.get(t.accountId) : undefined;
      const stage = t.outcome === 'open' ? await this.facts.stageOf(t.profileKind, t) : null;
      const phone = subject?.phone ?? account?.phone ?? null;
      const task = taskBy.get(t.id);
      out.push({
        id: t.id,
        kind: t.profileKind,
        code: subject?.code ?? null,
        name: subject?.name ?? account?.displayName ?? 'Not given yet',
        maskedPhone: phone ? maskPhoneLast4(phone) : null,
        area: subject?.locality ?? null,
        stage: t.stage,
        stageReachedAt: t.stageReachedAt.toISOString(),
        step: stage?.step ?? 'complete',
        missing: stage?.missing ?? [],
        stuckReason: t.stuckReason,
        scriptHint: scriptHintKey(t.profileKind, stage?.step ?? 'complete'),
        source: t.source,
        contactConsent: t.contactConsent,
        assignedTo: t.assignedStaffId ? staffBy.get(t.assignedStaffId) ?? null : null,
        assignmentReason: t.assignmentReason,
        callTries: t.callTries,
        remindersSent: t.remindersSent,
        nextActionAt: t.nextActionAt?.toISOString() ?? null,
        openTask: task ? { id: task.id, dueAt: task.dueAt.toISOString(), overdue: task.dueAt.getTime() < now.getTime() - OVERDUE_MS } : null,
        outcome: t.outcome,
        startedAt: t.createdAt.toISOString(),
        finishedAt: t.finishedAt?.toISOString() ?? null,
      });
    }
    return out;
  }

  // ------------------------------------------------------------ team

  /** The Team Lead's own team (OwnTeam, the shared definition), the Team Lead included. */
  private teamOf(teamLeadId: string): Promise<string[]> {
    return new OwnTeam(this.prisma).memberIds(teamLeadId);
  }

  /**
   * Of these sign-ups, the ones whose record was registered (or is held) by
   * someone in `teamIds`. A sign-up with no agent and no record owner belongs
   * to no team.
   */
  private async ownedByTeam<T extends Pick<SignupTracker, 'subjectType' | 'subjectId'>>(trackers: T[], teamIds: string[]): Promise<T[]> {
    const ids = (type: string) => trackers.filter((t) => t.subjectType === type && t.subjectId).map((t) => t.subjectId!);
    const [seekers, businesses, referrals] = await Promise.all([
      ids('job_seeker').length
        ? this.prisma.jobSeeker.findMany({ where: { id: { in: ids('job_seeker') }, OR: [{ registeredByStaffId: { in: teamIds } }, { assignedStaffId: { in: teamIds } }] }, select: { id: true } })
        : Promise.resolve([]),
      ids('business').length
        ? this.prisma.business.findMany({
            where: { id: { in: ids('business') }, OR: [{ leadCreatedByStaffId: { in: teamIds } }, { accountAgentId: { in: teamIds } }] },
            select: { id: true },
          })
        : Promise.resolve([]),
      ids('referral').length
        ? this.prisma.referral.findMany({ where: { id: { in: ids('referral') }, OR: [{ registeredByStaffId: { in: teamIds } }, { assignedStaffId: { in: teamIds } }] }, select: { id: true } })
        : Promise.resolve([]),
    ]);
    const owned = new Set([...seekers, ...businesses, ...referrals].map((r) => r.id));
    return trackers.filter((t) => t.subjectId && owned.has(t.subjectId));
  }

  // ------------------------------------------------------------ counts

  /** Counts with aggregate queries: nothing loads every tracker. */
  private async counts(where: Prisma.SignupTrackerWhereInput, since: Date) {
    const inWindow: Prisma.SignupTrackerWhereInput = { AND: [where, { OR: [{ createdAt: { gte: since } }, { outcome: 'open' }] }] };
    const [started, openStages, allStages, outcomesRows, sources, finishedRows] = await Promise.all([
      this.prisma.signupTracker.count({ where: inWindow }),
      this.prisma.signupTracker.groupBy({ by: ['profileKind', 'stage'], where: { AND: [where, { outcome: 'open' }] }, _count: { _all: true } }),
      this.prisma.signupTracker.groupBy({ by: ['profileKind', 'stage'], where: inWindow, _count: { _all: true } }),
      this.prisma.signupTracker.groupBy({ by: ['profileKind', 'outcome'], where: inWindow, _count: { _all: true } }),
      this.prisma.signupTracker.groupBy({ by: ['source'], where: inWindow, _count: { _all: true } }),
      this.prisma.signupTracker.findMany({
        where: { AND: [where, { outcome: { in: ['self', 'assisted'] }, finishedAt: { gte: since } }] },
        orderBy: { finishedAt: 'desc' },
        take: MEDIAN_SAMPLE,
        select: { createdAt: true, finishedAt: true },
      }),
    ]);
    const kindOf = (k: string) => ((KINDS as readonly string[]).includes(k) ? k : 'job_seeker');
    const funnel = emptyFunnel();
    for (const g of openStages) funnel[kindOf(g.profileKind)][g.stage] = (funnel[kindOf(g.profileKind)][g.stage] ?? 0) + g._count._all;
    const reached = emptyFunnel();
    for (const g of allStages) {
      const idx = STAGE_ORDER.indexOf(g.stage as (typeof STAGE_ORDER)[number]);
      for (let i = 0; i <= idx; i += 1) reached[kindOf(g.profileKind)][STAGE_ORDER[i]] += g._count._all;
    }
    const outcomes: Record<string, Record<string, number>> = Object.fromEntries(
      KINDS.map((k) => [k, { open: 0, self: 0, assisted: 0, no_response: 0, gave_up: 0 }]),
    );
    for (const g of outcomesRows) outcomes[kindOf(g.profileKind)][g.outcome] = (outcomes[kindOf(g.profileKind)][g.outcome] ?? 0) + g._count._all;
    const bySource: Record<string, number> = {};
    for (const g of sources) bySource[g.source ?? 'unknown'] = (bySource[g.source ?? 'unknown'] ?? 0) + g._count._all;
    const minutes = finishedRows.map((t) => Math.round((t.finishedAt!.getTime() - t.createdAt.getTime()) / 60000)).sort((a, b) => a - b);
    const finished = KINDS.reduce((n, k) => n + outcomes[k].self + outcomes[k].assisted, 0);
    const self = KINDS.reduce((n, k) => n + outcomes[k].self, 0);
    return {
      started,
      finished,
      finishedWithoutHelpPercent: finished ? Math.round((self / finished) * 100) : null,
      medianMinutesToFinish: minutes.length ? minutes[Math.floor(minutes.length / 2)] : null,
      openByStage: funnel,
      reachedStage: reached,
      outcomes,
      bySource,
    };
  }

  private sinceDays(days?: string | number): Date {
    const n = Number(days ?? DEFAULT_VIEW_DAYS);
    const safe = Number.isInteger(n) && n > 0 && n <= 366 ? n : DEFAULT_VIEW_DAYS;
    return new Date(this.clock.now().getTime() - safe * DAY_MS);
  }

  // ------------------------------------------------------------ Team Lead

  /**
   * The Team Lead's own team only (owner rule): sign-ups held by a team
   * member, and sign-ups with no agent yet whose record a team member
   * registered. Sign-ups that belong to no team go to Managers and the CEO.
   */
  async teamLead(actor: Actor, days?: string) {
    if (actor.role !== 'team_lead') throw new ForbiddenException('Team Leads only');
    const now = this.clock.now();
    const teamIds = await this.teamOf(actor.id);
    const team = await this.prisma.staff.findMany({
      where: { id: { in: teamIds }, role: 'call_agent', status: 'active' },
      select: { id: true, code: true, name: true, spokenLanguages: true },
      orderBy: { code: 'asc' },
    });
    const mine: Prisma.SignupTrackerWhereInput = { assignedStaffId: { in: teamIds } };
    const counts = await this.counts(mine, this.sinceDays(days));
    const [open, unassignedAll, closed] = await Promise.all([
      this.prisma.signupTracker.findMany({ where: { ...mine, outcome: 'open' }, orderBy: { lastActivityAt: 'asc' }, take: ROW_LIMIT }),
      this.prisma.signupTracker.findMany({
        where: { outcome: 'open', assignedStaffId: null, subjectId: { not: null } },
        orderBy: { lastActivityAt: 'asc' },
        take: ROW_LIMIT,
      }),
      this.prisma.signupTracker.findMany({ where: { ...mine, outcome: { in: REENGAGE_OUTCOMES } }, orderBy: { updatedAt: 'desc' }, take: 50 }),
    ]);
    const unassigned = await this.ownedByTeam(unassignedAll, teamIds);
    const rows = await this.rows(open, now);
    return {
      now: now.toISOString(),
      team: team.map((m) => ({ id: m.id, code: m.code, name: m.name, spokenLanguages: m.spokenLanguages })),
      summary: {
        open: rows.length,
        overdue: rows.filter((r) => r.openTask?.overdue).length,
        unassigned: unassigned.length,
        finished: counts.finished,
        finishedWithoutHelpPercent: counts.finishedWithoutHelpPercent,
      },
      funnel: counts.openByStage,
      rows,
      unassigned: await this.rows(unassigned, now),
      reengage: await this.rows(closed, now),
      seekerVisitRequests: await this.seekerVisitRequests(teamIds, now),
      areaTasks: await this.areaTasks(now, teamIds),
    };
  }

  /** Job seekers stuck at the ID step who asked for an agent to come (question 11). Team Leads: own team only. */
  private async seekerVisitRequests(teamIds: string[] | null, now: Date) {
    const events = await this.prisma.signupTrackerEvent.findMany({
      where: { kind: 'visit_request', tracker: { profileKind: 'job_seeker', outcome: 'open' } },
      orderBy: { createdAt: 'asc' },
      take: ROW_LIMIT,
      include: { tracker: true },
    });
    let visible = events;
    if (teamIds) {
      const unassignedOwned = new Set(
        (await this.ownedByTeam(events.filter((e) => !e.tracker.assignedStaffId).map((e) => e.tracker), teamIds)).map((t) => t.id),
      );
      visible = events.filter((e) => (e.tracker.assignedStaffId ? teamIds.includes(e.tracker.assignedStaffId) : unassignedOwned.has(e.tracker.id)));
    }
    const rows = await this.rows(visible.map((e) => e.tracker), now);
    return rows.map((r, i) => ({ ...r, askedAt: visible[i].createdAt.toISOString(), note: visible[i].note }));
  }

  /**
   * Several stuck job seeker sign-ups in one area: one area task to send an
   * agent there (question 11). Team Leads count only their own team's.
   */
  async areaTasks(now: Date, teamIds: string[] | null = null) {
    const policy = await this.pricing.current();
    const settings = signupSettingsFrom(policy);
    let stuck = await this.prisma.signupTracker.findMany({
      where: {
        profileKind: 'job_seeker',
        outcome: 'open',
        subjectType: 'job_seeker',
        subjectId: { not: null },
        lastActivityAt: { lt: new Date(now.getTime() - settings.stuckHours * 3600_000) },
      },
      select: { id: true, subjectType: true, subjectId: true, stage: true, assignedStaffId: true },
      take: AREA_SAMPLE,
    });
    if (teamIds) {
      const owned = new Set((await this.ownedByTeam(stuck.filter((s) => !s.assignedStaffId), teamIds)).map((s) => s.id));
      stuck = stuck.filter((s) => (s.assignedStaffId ? teamIds.includes(s.assignedStaffId) : owned.has(s.id)));
    }
    if (stuck.length === 0) return [];
    const seekers = await this.prisma.jobSeeker.findMany({
      where: { id: { in: stuck.map((s) => s.subjectId!) } },
      select: { id: true, locality: true },
    });
    const areaOf = new Map(seekers.map((s) => [s.id, s.locality?.trim() || null]));
    const groups = new Map<string, { area: string; count: number; stages: Record<string, number> }>();
    for (const s of stuck) {
      const area = areaOf.get(s.subjectId!);
      if (!area) continue;
      const key = area.toLowerCase();
      const g = groups.get(key) ?? { area, count: 0, stages: {} };
      g.count += 1;
      g.stages[s.stage] = (g.stages[s.stage] ?? 0) + 1;
      groups.set(key, g);
    }
    return [...groups.values()].filter((g) => g.count >= settings.areaClusterMin).sort((a, b) => b.count - a.count);
  }

  // ------------------------------------------------------------ Manager

  /** Counts and funnels only: no names, no phone numbers, no money. Includes sign-ups no team holds yet. */
  async manager(actor: Actor, days?: string) {
    if (actor.role !== 'manager') throw new ForbiddenException('Managers only');
    const [counts, noTeam] = await Promise.all([
      this.counts({}, this.sinceDays(days)),
      this.prisma.signupTracker.count({ where: { outcome: 'open', assignedStaffId: null } }),
    ]);
    return { now: this.clock.now().toISOString(), ...counts, unassigned: noTeam };
  }

  // ------------------------------------------------------------ CEO

  async ceo(actor: Actor, query: { days?: string; kind?: string; stage?: string; outcome?: string }) {
    if (actor.role !== 'ceo') throw new ForbiddenException('CEO only');
    const now = this.clock.now();
    const since = this.sinceDays(query.days);
    const counts = await this.counts({}, since);
    const recent = await this.prisma.signupTracker.findMany({
      where: { OR: [{ createdAt: { gte: since } }, { outcome: 'open' }] },
      orderBy: { createdAt: 'desc' },
      take: AREA_SAMPLE,
      select: { subjectType: true, subjectId: true, outcome: true },
    });
    const areaOf = await this.areas(recent);
    const byArea: Record<string, { started: number; finished: number }> = {};
    for (const t of recent) {
      const area = (t.subjectId && areaOf.get(t.subjectId)) || 'Not known yet';
      byArea[area] ??= { started: 0, finished: 0 };
      byArea[area].started += 1;
      if (t.outcome === 'self' || t.outcome === 'assisted') byArea[area].finished += 1;
    }
    const where: Prisma.SignupTrackerWhereInput = {
      OR: [{ createdAt: { gte: since } }, { outcome: 'open' }],
      ...(query.kind && (KINDS as readonly string[]).includes(query.kind) ? { profileKind: query.kind } : {}),
      ...(query.stage && (STAGE_ORDER as readonly string[]).includes(query.stage) ? { stage: query.stage } : {}),
      ...(query.outcome ? { outcome: query.outcome } : {}),
    };
    const list = await this.prisma.signupTracker.findMany({ where, orderBy: { createdAt: 'desc' }, take: ROW_LIMIT });
    const policy = await this.pricing.current();
    return {
      now: now.toISOString(),
      ...counts,
      byArea: Object.entries(byArea)
        .map(([area, v]) => ({ area, ...v }))
        .sort((a, b) => b.started - a.started)
        .slice(0, 20),
      areaTasks: await this.areaTasks(now),
      seekerVisitRequests: await this.seekerVisitRequests(null, now),
      rows: await this.rows(list, now),
      settings: { ...signupSettingsFrom(policy), notYetInSettings: missingSettingColumns(policy) },
    };
  }

  private async areas(trackers: Array<{ subjectType: string | null; subjectId: string | null }>) {
    const ids = (type: string) => trackers.filter((t) => t.subjectType === type && t.subjectId).map((t) => t.subjectId!);
    const [a, b, c] = await Promise.all([
      this.prisma.jobSeeker.findMany({ where: { id: { in: ids('job_seeker') } }, select: { id: true, locality: true } }),
      this.prisma.business.findMany({ where: { id: { in: ids('business') } }, select: { id: true, locality: true } }),
      this.prisma.referral.findMany({ where: { id: { in: ids('referral') } }, select: { id: true, locality: true } }),
    ]);
    return new Map([...a, ...b, ...c].map((r) => [r.id, r.locality?.trim() || null]));
  }

  // ------------------------------------------------------------ labels

  /**
   * "Registered in the app" on the Job Seekers, Businesses and Referrals lists
   * and profiles: which of these records were self-registered in the app,
   * which are linked to an app account at all, and whether a push can reach it.
   * Answers only for records the caller may see: a Team Lead gets labels only
   * for their own team's records; the other office roles read these lists in full.
   */
  async appLabels(actor: Actor, type: string, rawIds: string | undefined) {
    if (!(KINDS as readonly string[]).includes(type)) throw new BadRequestException('type is job_seeker, business or referral');
    let ids = [...new Set((rawIds ?? '').split(',').map((s) => s.trim()).filter(Boolean))].slice(0, 500);
    if (actor.role === 'team_lead' && ids.length) {
      const teamIds = await this.teamOf(actor.id);
      ids = (await this.ownedByTeam(ids.map((id) => ({ subjectType: type, subjectId: id })), teamIds)).map((r) => r.subjectId!);
    }
    if (ids.length === 0) return {};
    const column = type === 'job_seeker' ? 'jobSeekerId' : type === 'business' ? 'businessId' : 'referralId';
    const profiles = await this.prisma.customerProfile.findMany({
      where: { [column]: { in: ids }, status: 'active' },
      select: { jobSeekerId: true, businessId: true, referralId: true, linkedVia: true, accountId: true },
    });
    const accountIds = [...new Set(profiles.map((p) => p.accountId))];
    const devices = accountIds.length
      ? await this.prisma.customerDevice.findMany({
          where: { accountId: { in: accountIds }, revokedAt: null, pushToken: { not: null }, pushPermission: 'granted' },
          select: { accountId: true },
        })
      : [];
    const push = new Set(devices.map((d) => d.accountId));
    const out: Record<string, { registeredInApp: boolean; hasApp: boolean; pushOn: boolean }> = {};
    for (const p of profiles) {
      const id = p.jobSeekerId ?? p.businessId ?? p.referralId;
      if (!id) continue;
      const prev = out[id] ?? { registeredInApp: false, hasApp: false, pushOn: false };
      out[id] = {
        registeredInApp: prev.registeredInApp || p.linkedVia === 'self_registered',
        hasApp: true,
        pushOn: prev.pushOn || push.has(p.accountId),
      };
    }
    return out;
  }

  // ------------------------------------------------------------ staff languages

  async staffLanguages() {
    const rows = await this.prisma.staff.findMany({
      select: { id: true, code: true, spokenLanguages: true },
      orderBy: { code: 'asc' },
    });
    return { languages: STAFF_LANGUAGES, staff: rows };
  }

  async setStaffLanguages(actor: Actor, staffId: string, body: { languages?: unknown }) {
    if (actor.role !== 'ceo') throw new ForbiddenException('Only the CEO edits staff records here');
    const list = Array.isArray(body?.languages) ? body.languages : null;
    if (!list || list.some((l) => typeof l !== 'string')) throw new BadRequestException('languages must be a list of language names');
    const clean = [...new Set((list as string[]).map((l) => l.trim()))].filter(Boolean);
    const unknown = clean.filter((l) => !(STAFF_LANGUAGES as readonly string[]).includes(l));
    if (unknown.length) throw new BadRequestException(`Not in the language list: ${unknown.join(', ')}`);
    const staff = await this.prisma.staff.findUnique({ where: { id: staffId }, select: { id: true, code: true, city: true, spokenLanguages: true } });
    if (!staff) throw new NotFoundException('Staff member not found');
    const updated = await this.prisma.staff.update({ where: { id: staffId }, data: { spokenLanguages: clean }, select: { id: true, code: true, spokenLanguages: true } });
    await this.audit.log({
      actorId: actor.id,
      action: 'staff.spoken_languages_changed',
      entityType: 'staff',
      entityCode: staff.code,
      before: { spokenLanguages: staff.spokenLanguages },
      after: { spokenLanguages: clean },
      changedFields: ['spokenLanguages'],
      city: staff.city,
    });
    return updated;
  }
}
