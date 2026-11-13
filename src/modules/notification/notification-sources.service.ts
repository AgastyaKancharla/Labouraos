import { daysLabel } from '../attendance/leave-units';
import { Injectable, Logger } from '@nestjs/common';
import { AttendanceCorrection, LeaveRequest, Notification, ReviewFlag } from '@prisma/client';
import { PrismaService } from '../../common/prisma/prisma.service';
import { formatINR } from '../../common/money/money';
import { REASON_TEXT, placementOf } from '../attendance/request-routing';
import {
  FLAG_KIND_TO_NOTIFICATION,
  FLAG_NOTIFICATION_KINDS,
  IDLE_BELL_MINUTES,
  MONEY_FLAG_KINDS,
  NotificationKind,
  flagTitle,
  notificationLink,
} from './notification.constants';
import { ClearInfo, NotificationDraft, NotificationService } from './notification.service';
import { DirectoryRow, StaffDirectory } from './staff-directory';

export type RequestKind = 'leave' | 'correction';
type AnyRequest = LeaveRequest | AttendanceCorrection;

const AGENT_ROLES = ['call_agent', 'field_agent'];
const OUTGOING_PAYMENT_TYPES = ['refund', 'referral_payout', 'joining_reward', 'duplicate_refund'];
const DAY_MS = 24 * 3600 * 1000;
/** A system problem older than this without approval is left to the attendance reports. */
const SYSTEM_PROBLEM_LOOKBACK_DAYS = 31;
/** Reads refresh their sources at most this often per process. */
const READ_SYNC_THROTTLE_MS = 15_000;

/** The groups of sources a reader's role needs refreshed before reading the bell. */
const READ_GROUPS: Record<string, Array<'requests' | 'team' | 'ceoMoney' | 'financeMoney' | 'lines' | 'payroll'>> = {
  team_lead: ['requests', 'team'],
  manager: ['requests', 'lines'],
  ceo: ['requests', 'ceoMoney', 'lines', 'payroll'],
  finance: ['financeMoney', 'payroll'],
};

const IST_MS = 5.5 * 3600 * 1000;
function istMonthOf(date: Date): string {
  return new Date(date.getTime() + IST_MS).toISOString().slice(0, 7);
}
function monthBefore(month: string): string {
  const [y, m] = month.split('-').map(Number);
  return m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, '0')}`;
}
function monthWords(month: string): string {
  const [y, m] = month.split('-').map(Number);
  return `${new Date(Date.UTC(y, m - 1, 1)).toLocaleString('en-IN', { month: 'long', timeZone: 'UTC' })} ${y}`;
}

function istDateLabel(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/**
 * Works out, from the records themselves, which notifications should be open
 * right now, and makes the bells match. Because every kind is worked out from
 * the state of its record, a notification clears by itself when the work is
 * done, whichever screen or job did it, and the clearer is read back from the
 * record (who decided the request, resolved the flag, paid the refund).
 *
 * Event hooks call the one-subject versions for an immediate bell; the
 * notification sweep and reads call the kind-wide versions.
 */
/** "Deepa Nair asks for 2 days of casual leave"; a half day says which half (owner decision 12 Nov). */
export function leaveAsk(who: string, request: Pick<LeaveRequest, 'days' | 'kind' | 'half'>): string {
  if (request.half === 'first' || request.half === 'second') {
    return `${who} asks for a half day (${request.half} half) of ${request.kind} leave`;
  }
  return `${who} asks for ${daysLabel(request.days)} day${request.days === 1 ? '' : 's'} of ${request.kind} leave`;
}

@Injectable()
export class NotificationSourcesService {
  private readonly logger = new Logger(NotificationSourcesService.name);
  private readonly lastReadSync = new Map<string, number>();
  /** Sources other modules add (e.g. the requests module's StaffRequest bells), run with "requests". */
  private readonly extraSources: Array<{ label: string; run: (now: Date) => Promise<unknown> }> = [];

  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationService,
  ) {}

  async directory(): Promise<StaffDirectory> {
    const rows = await this.prisma.staff.findMany({
      select: {
        id: true,
        code: true,
        name: true,
        role: true,
        status: true,
        reportsToId: true,
        teamLeadId: true,
      },
    });
    return new StaffDirectory(rows);
  }

  /** One draft per active recipient (duplicates and inactive people dropped). */
  drafts(
    recipients: Array<DirectoryRow | null | undefined>,
    base: Omit<NotificationDraft, 'recipientStaffId' | 'link'>,
    linkParams: Record<string, string | null | undefined> = {},
  ): NotificationDraft[] {
    const seen = new Set<string>();
    const out: NotificationDraft[] = [];
    for (const person of recipients) {
      if (!person || person.status !== 'active' || seen.has(person.id)) continue;
      seen.add(person.id);
      out.push({
        ...base,
        recipientStaffId: person.id,
        link: notificationLink(person.role, base.kind, linkParams),
      });
    }
    return out;
  }

  /** Runs a source and logs instead of failing the caller: a bell never blocks the work itself. */
  async safely<T>(label: string, run: () => Promise<T>): Promise<T | null> {
    try {
      return await run();
    } catch (error) {
      this.logger.warn(`Notification source "${label}" failed: ${(error as Error).message}`);
      return null;
    }
  }

  /** Adds a source that is swept with the requests (24/48-hour escalation by the clock). */
  registerRequestSource(label: string, run: (now: Date) => Promise<unknown>): void {
    if (!this.extraSources.some((source) => source.label === label)) this.extraSources.push({ label, run });
  }

  private async syncExtraSources(now: Date): Promise<void> {
    for (const source of this.extraSources) await this.safely(source.label, () => source.run(now));
  }

  // ------------------------------------------------------------- everything

  /** The sweep: every state-derived kind. */
  async syncAll(now: Date = this.notifications.now()) {
    const dir = await this.directory();
    return {
      requests: await this.safely('requests', () => this.syncAllRequests(now, dir)),
      extra: await this.safely('extra sources', () => this.syncExtraSources(now)),
      flags: await this.safely('flags', () => this.syncAllFlags(now, dir)),
      idle: await this.safely('idle', () => this.syncIdle(now, dir)),
      systemProblems: await this.safely('system problems', () => this.syncSystemProblems(now, dir)),
      breaks: await this.safely('breaks', () => this.clearEndedBreaks(now)),
      money: await this.safely('money', () => this.syncMoney(now, dir, 'all')),
      lines: await this.safely('lines', () => this.syncNoReportingLine(now, dir)),
      shortage: await this.safely('shortage tasks', () => this.syncShortageTasks(now, dir)),
      payroll: await this.safely('payroll', () => this.syncPayroll(now, dir)),
    };
  }

  /**
   * Before a bell is read: refresh the cheap, time-based sources this role
   * sees (request escalation after 24/48 hours, idle agents, money waiting),
   * at most every 15 seconds per process.
   */
  async syncForReader(role: string, now: Date = this.notifications.now()): Promise<void> {
    const groups = READ_GROUPS[role] ?? [];
    if (groups.length === 0) return;
    const due = groups.filter((group) => {
      const last = this.lastReadSync.get(group) ?? 0;
      return Date.now() - last >= READ_SYNC_THROTTLE_MS;
    });
    if (due.length === 0) return;
    for (const group of due) this.lastReadSync.set(group, Date.now());
    const dir = await this.directory();
    for (const group of due) {
      if (group === 'requests') {
        await this.safely('requests', () => this.syncAllRequests(now, dir));
        await this.syncExtraSources(now);
      }
      if (group === 'team') {
        await this.safely('idle', () => this.syncIdle(now, dir));
        await this.safely('system problems', () => this.syncSystemProblems(now, dir));
      }
      if (group === 'ceoMoney') await this.safely('money', () => this.syncMoney(now, dir, 'ceo'));
      if (group === 'financeMoney') await this.safely('money', () => this.syncMoney(now, dir, 'finance'));
      if (group === 'lines') await this.safely('lines', () => this.syncNoReportingLine(now, dir));
      if (group === 'payroll') await this.safely('payroll', () => this.syncPayroll(now, dir));
    }
  }

  /** Forgets the read throttle (tests move the clock between reads). */
  resetReadThrottle(): void {
    this.lastReadSync.clear();
  }

  // --------------------------------------------------------------- requests

  private requestNotificationKind(kind: RequestKind): NotificationKind {
    return kind === 'leave' ? 'leave_request' : 'correction_request';
  }

  private requestSubjectType(kind: RequestKind): string {
    return kind === 'leave' ? 'leave_request' : 'attendance_correction';
  }

  private async loadRequest(kind: RequestKind, id: string): Promise<AnyRequest | null> {
    return kind === 'leave'
      ? this.prisma.leaveRequest.findUnique({ where: { id } })
      : this.prisma.attendanceCorrection.findUnique({ where: { id } });
  }

  /** Who a request is with right now, following request-routing.ts. */
  requestRecipients(request: AnyRequest, dir: StaffDirectory, now: Date): Array<{ person: DirectoryRow; why: string }> {
    const placement = placementOf(request, now);
    const out: Array<{ person: DirectoryRow; why: string }> = [];
    const add = (person: DirectoryRow | null | undefined, why: string | null) => {
      if (person && why) out.push({ person, why });
    };
    if (placement.withTeamLead) {
      add(dir.get(request.routedToStaffId), request.routeReason);
    }
    if (placement.withManager) {
      const manager =
        request.routedToRole === 'manager'
          ? dir.get(request.routedToStaffId)
          : dir.chainOf(request.staffId).manager;
      if (manager) add(manager, placement.managerReason);
      else for (const ceo of dir.ceos()) add(ceo, placement.managerReason);
    }
    if (placement.withCeo) {
      const routedCeo = request.routedToRole === 'ceo' ? dir.get(request.routedToStaffId) : null;
      if (routedCeo && routedCeo.status === 'active') add(routedCeo, placement.ceoReason);
      else for (const ceo of dir.ceos()) add(ceo, placement.ceoReason);
    }
    // Nobody decides their own request.
    return out.filter((entry) => entry.person.id !== request.staffId);
  }

  private requestDrafts(kind: RequestKind, request: AnyRequest, dir: StaffDirectory, now: Date): NotificationDraft[] {
    const person = dir.get(request.staffId);
    const who = person ? `${person.name} (${person.code})` : 'A staff member';
    const title =
      kind === 'leave'
        ? leaveAsk(who, request as LeaveRequest)
        : `${who} asks for a correction on ${istDateLabel((request as AttendanceCorrection).date)}`;
    const drafts: NotificationDraft[] = [];
    const seen = new Set<string>();
    for (const { person: recipient, why } of this.requestRecipients(request, dir, now)) {
      if (seen.has(recipient.id) || recipient.status !== 'active') continue;
      seen.add(recipient.id);
      drafts.push({
        recipientStaffId: recipient.id,
        kind: this.requestNotificationKind(kind),
        title,
        body: REASON_TEXT[why] ?? why,
        link: notificationLink(recipient.role, this.requestNotificationKind(kind), { id: request.id }),
        subjectType: this.requestSubjectType(kind),
        subjectId: request.id,
      });
    }
    return drafts;
  }

  private requestClearInfo(request: AnyRequest | null): ClearInfo {
    if (!request) return { byStaffId: null, reason: 'request_gone' };
    if (request.status !== 'pending') {
      return { byStaffId: request.decidedByStaffId, reason: `request_${request.status}` };
    }
    if (request.forwardedAt) {
      return { byStaffId: request.forwardedByStaffId, reason: 'forwarded' };
    }
    if (request.sentBackAt) {
      return { byStaffId: request.sentBackByStaffId, reason: 'sent_back' };
    }
    return { byStaffId: null, reason: 'moved' };
  }

  /**
   * A Manager sent a request back to the Team Lead: the Team Lead's bell rings
   * again as a new one (even when the old one was still open, after 24 hours),
   * and the Manager's clears with who sent it back.
   */
  async requestSentBack(kind: RequestKind, id: string, now: Date = this.notifications.now()): Promise<void> {
    const request = await this.loadRequest(kind, id);
    if (request?.routedToStaffId && request.sentBackAt) {
      await this.notifications.clear(
        {
          kind: this.requestNotificationKind(kind),
          subjectType: this.requestSubjectType(kind),
          subjectId: id,
          recipientStaffId: request.routedToStaffId,
        },
        { byStaffId: request.sentBackByStaffId, reason: 'sent_back' },
        now,
      );
    }
    await this.syncRequest(kind, id, now);
  }

  /** One request: the approvers' bells, and the requester's once it is decided. */
  async syncRequest(kind: RequestKind, id: string, now: Date = this.notifications.now()): Promise<void> {
    const request = await this.loadRequest(kind, id);
    const dir = await this.directory();
    const drafts = request && request.status === 'pending' ? this.requestDrafts(kind, request, dir, now) : [];
    await this.notifications.syncSubject(
      this.requestNotificationKind(kind),
      this.requestSubjectType(kind),
      id,
      drafts,
      this.requestClearInfo(request),
      now,
    );
    if (request && request.status !== 'pending') {
      await this.notifyRequester(kind, request, dir, now);
    }
  }

  private async notifyRequester(kind: RequestKind, request: AnyRequest, dir: StaffDirectory, now: Date) {
    const requester = dir.get(request.staffId);
    if (!requester || requester.status !== 'active') return;
    const decider = dir.get(request.decidedByStaffId);
    const what =
      kind === 'leave'
        ? `Your ${(request as LeaveRequest).kind} leave from ${istDateLabel((request as LeaveRequest).fromDate)}`
        : `Your correction for ${istDateLabel((request as AttendanceCorrection).date)}`;
    const overturned = kind === 'leave' && Boolean((request as LeaveRequest).overturnedAt);
    await this.notifications.open(
      {
        recipientStaffId: requester.id,
        kind: 'request_decided',
        title: `${what} was ${request.status}${overturned ? ' (decision changed)' : ''}`,
        body: decider ? `By ${decider.name} (${decider.code})` : null,
        link: notificationLink(requester.role, 'request_decided'),
        subjectType: this.requestSubjectType(kind),
        // A changed decision is a new thing to tell him about.
        subjectId: overturned ? `${request.id}:overturned` : request.id,
        once: true,
      },
      now,
    );
  }

  /** Every pending request (escalation moves them up by the clock alone). */
  async syncAllRequests(now: Date, dir?: StaffDirectory): Promise<void> {
    const directory = dir ?? (await this.directory());
    for (const kind of ['leave', 'correction'] as RequestKind[]) {
      const nkind = this.requestNotificationKind(kind);
      const pending: AnyRequest[] =
        kind === 'leave'
          ? await this.prisma.leaveRequest.findMany({ where: { status: 'pending' } })
          : await this.prisma.attendanceCorrection.findMany({ where: { status: 'pending' } });
      const drafts = pending.flatMap((request) => this.requestDrafts(kind, request, directory, now));
      const cache = new Map<string, AnyRequest | null>(pending.map((request) => [request.id, request]));
      await this.notifications.reconcileKind(
        nkind,
        drafts,
        async (row) => {
          if (!cache.has(row.subjectId)) cache.set(row.subjectId, await this.loadRequest(kind, row.subjectId));
          return this.requestClearInfo(cache.get(row.subjectId) ?? null);
        },
        now,
      );
    }
  }

  // ------------------------------------------------------------------ flags

  /** Which notification kind a review flag becomes, or null for none. */
  flagNotificationKind(flagKind: string): NotificationKind | null {
    if (flagKind in FLAG_KIND_TO_NOTIFICATION) return FLAG_KIND_TO_NOTIFICATION[flagKind];
    return 'review_flag';
  }

  /** Who hears about an open review flag. A Team Lead only ever hears about their own team. */
  flagRecipients(flag: ReviewFlag, dir: StaffDirectory): DirectoryRow[] {
    const nkind = this.flagNotificationKind(flag.kind);
    if (!nkind) return [];
    const ceos = dir.ceos();
    if (MONEY_FLAG_KINDS.includes(flag.kind)) {
      return [...ceos, ...dir.active('finance')];
    }
    const person = dir.get(flag.raisedForStaffId);
    const chain = person ? dir.chainOf(person.id) : null;
    // Escalated flags ("Send to Manager" / "Send to CEO") and the CEO's own
    // kinds (a business hiding a hire) go to their owner; the Manager over
    // the person still hears about a bypass (guide, Quality).
    if (flag.ownerRole === 'ceo') {
      const manager = flag.kind === 'bypass_suspected' ? (chain?.manager ?? null) : null;
      return [...ceos, manager].filter((row): row is DirectoryRow => Boolean(row && row.status === 'active'));
    }
    if (flag.ownerRole === 'manager') {
      const owner = dir.get(flag.ownerStaffId) ?? chain?.manager ?? null;
      return owner && owner.status === 'active' ? [owner] : ceos;
    }
    const orCeo = (list: Array<DirectoryRow | null>) => {
      const found = list.filter((row): row is DirectoryRow => Boolean(row && row.status === 'active'));
      return found.length > 0 ? found : ceos;
    };
    if (flag.kind === 'vacancy_captured_for_account_business') {
      // The account agent is told that a call agent added a vacancy to his business.
      return person ? [person] : [];
    }
    if (nkind === 'in_person_onboarding_review') {
      return orCeo([chain?.teamLead ?? chain?.manager ?? null]);
    }
    if (nkind === 'hit_reversal_needs_manager') {
      return orCeo([chain?.manager ?? null]);
    }
    if (nkind === 'hit_reversed') {
      // Master Guide: the CEO and the Manager are told. Not the person who did it.
      const manager = person?.role === 'manager' ? null : chain?.manager ?? null;
      return [manager, ...ceos].filter(
        (row): row is DirectoryRow => Boolean(row && row.status === 'active' && row.id !== person?.id),
      );
    }
    if (!person) {
      const managers = dir.active('manager');
      return managers.length > 0 ? managers : ceos;
    }
    if (AGENT_ROLES.includes(person.role)) return orCeo([chain?.teamLead ?? null, chain?.manager ?? null]);
    if (person.role === 'team_lead') return orCeo([chain?.manager ?? null]);
    if (person.role === 'manager' || person.role === 'finance') return ceos;
    return [];
  }

  private flagDrafts(flag: ReviewFlag, dir: StaffDirectory): NotificationDraft[] {
    const nkind = this.flagNotificationKind(flag.kind);
    if (!nkind || flag.status !== 'open') return [];
    const person = dir.get(flag.raisedForStaffId);
    const details = (flag.details ?? {}) as Record<string, unknown>;
    const ref =
      typeof details.jobSeekerCode === 'string'
        ? details.jobSeekerCode
        : typeof details.businessCode === 'string'
          ? details.businessCode
          : typeof details.vacancyCode === 'string'
            ? details.vacancyCode
            : null;
    return this.drafts(
      this.flagRecipients(flag, dir),
      {
        kind: nkind,
        title: `${flagTitle(flag.kind)} · ${flag.code}`,
        body: [ref, person ? `${person.name} (${person.code})` : null].filter(Boolean).join(' · ') || null,
        subjectType: 'review_flag',
        subjectId: flag.id,
        once: nkind === 'hit_reversed',
      },
      { id: flag.subjectType === 'business' ? flag.subjectId : null },
    );
  }

  private flagClearInfo(flag: ReviewFlag | null): ClearInfo {
    if (!flag) return { byStaffId: null, reason: 'flag_gone' };
    if (flag.status !== 'open') return { byStaffId: flag.resolvedByStaffId, reason: `flag_${flag.status}` };
    return { byStaffId: null, reason: 'moved' };
  }

  /** One flag, straight after it is raised or resolved. */
  async syncFlag(flagId: string, now: Date = this.notifications.now()): Promise<void> {
    const flag = await this.prisma.reviewFlag.findUnique({ where: { id: flagId } });
    const dir = await this.directory();
    const drafts = flag ? this.flagDrafts(flag, dir) : [];
    const info = this.flagClearInfo(flag);
    for (const kind of FLAG_NOTIFICATION_KINDS) {
      await this.notifications.syncSubject(
        kind,
        'review_flag',
        flagId,
        drafts.filter((draft) => draft.kind === kind),
        info,
        now,
      );
    }
  }

  /** Every open flag; also catches flags resolved by code that skips ReviewFlagService. */
  async syncAllFlags(now: Date, dir?: StaffDirectory): Promise<void> {
    const directory = dir ?? (await this.directory());
    const open = await this.prisma.reviewFlag.findMany({ where: { status: 'open' } });
    const drafts = open.flatMap((flag) => this.flagDrafts(flag, directory));
    const cache = new Map<string, ReviewFlag | null>(open.map((flag) => [flag.id, flag]));
    const clearInfo = async (row: Notification) => {
      if (!cache.has(row.subjectId)) {
        cache.set(row.subjectId, await this.prisma.reviewFlag.findUnique({ where: { id: row.subjectId } }));
      }
      return this.flagClearInfo(cache.get(row.subjectId) ?? null);
    };
    for (const kind of FLAG_NOTIFICATION_KINDS) {
      await this.notifications.reconcileKind(
        kind,
        drafts.filter((draft) => draft.kind === kind),
        clearInfo,
        now,
      );
    }
  }

  // ------------------------------------------------------------- attendance

  /** The Team Lead who approves for this person (as approveSystemProblem decides). */
  private leadOf(staffId: string, dir: StaffDirectory): DirectoryRow | null {
    const person = dir.get(staffId);
    if (!person) return null;
    return dir.get(person.reportsToId ?? person.teamLeadId);
  }

  /** Break overrun: opened by AttendanceService when the break runs over. */
  async openBreakOverrun(
    segment: { id: string; staffId: string; status: string; endedAt: Date | null },
    minutes: number,
    allowanceMinutes: number,
    now: Date = this.notifications.now(),
  ): Promise<void> {
    const dir = await this.directory();
    const person = dir.get(segment.staffId);
    const lead = this.leadOf(segment.staffId, dir);
    const label = segment.status === 'lunch' ? 'Lunch' : 'Short break';
    const drafts = this.drafts([lead], {
      kind: 'break_overrun',
      title: `${person ? `${person.name} (${person.code})` : 'A team member'}: ${label.toLowerCase()} over ${allowanceMinutes} minutes`,
      body: `${label} of ${minutes} minutes so far (allowed ${allowanceMinutes})`,
      subjectType: 'attendance_segment',
      subjectId: segment.id,
    });
    for (const draft of drafts) await this.notifications.open(draft, now);
    if (segment.endedAt) {
      // Seen only once the break was over: the alert is already done.
      await this.closeBreak(segment.id, segment.staffId, now);
    }
  }

  async closeBreak(segmentId: string, staffId: string, now: Date = this.notifications.now()): Promise<void> {
    await this.notifications.clear(
      { kind: 'break_overrun', subjectType: 'attendance_segment', subjectId: segmentId },
      { byStaffId: staffId, reason: 'break_ended' },
      now,
    );
  }

  /** Clears break alerts whose break has ended (safety net for the event hook). */
  async clearEndedBreaks(now: Date): Promise<number> {
    const open = await this.prisma.notification.findMany({
      where: { kind: 'break_overrun', clearedAt: null },
      select: { subjectId: true },
    });
    if (open.length === 0) return 0;
    const ended = await this.prisma.attendanceSegment.findMany({
      where: { id: { in: open.map((row) => row.subjectId) }, endedAt: { not: null } },
      select: { id: true, staffId: true },
    });
    const gone = new Set(open.map((row) => row.subjectId));
    for (const segment of ended) gone.delete(segment.id);
    let cleared = 0;
    for (const segment of ended) {
      await this.closeBreak(segment.id, segment.staffId, now);
      cleared += 1;
    }
    for (const id of gone) {
      const left = await this.prisma.attendanceSegment.findUnique({ where: { id }, select: { id: true } });
      if (!left) {
        await this.notifications.clear(
          { kind: 'break_overrun', subjectType: 'attendance_segment', subjectId: id },
          { byStaffId: null, reason: 'segment_gone' },
          now,
        );
        cleared += 1;
      }
    }
    return cleared;
  }

  /** System problem segments waiting for the Team Lead's approval. */
  async syncSystemProblems(now: Date, dir?: StaffDirectory): Promise<void> {
    const directory = dir ?? (await this.directory());
    const since = new Date(now.getTime() - SYSTEM_PROBLEM_LOOKBACK_DAYS * DAY_MS);
    const waiting = await this.prisma.attendanceSegment.findMany({
      where: { status: 'system_problem', approvedAt: null, startedAt: { gte: since } },
    });
    const drafts = waiting.flatMap((segment) => {
      const person = directory.get(segment.staffId);
      return this.drafts([this.leadOf(segment.staffId, directory)], {
        kind: 'system_problem',
        title: `${person ? `${person.name} (${person.code})` : 'A team member'} reported a system problem`,
        body: `Since ${segment.startedAt.toISOString()} · approve it so the time counts`,
        subjectType: 'attendance_segment',
        subjectId: segment.id,
      });
    });
    await this.notifications.reconcileKind(
      'system_problem',
      drafts,
      async (row) => {
        const segment = await this.prisma.attendanceSegment.findUnique({ where: { id: row.subjectId } });
        if (segment?.approvedAt) return { byStaffId: segment.approvedByStaffId, reason: 'approved' };
        return { byStaffId: null, reason: segment ? 'expired' : 'segment_gone' };
      },
      now,
    );
  }

  /** One system problem, straight after it is reported or approved. */
  async syncSystemProblem(segmentId: string, now: Date = this.notifications.now()): Promise<void> {
    const segment = await this.prisma.attendanceSegment.findUnique({ where: { id: segmentId } });
    const dir = await this.directory();
    const person = segment ? dir.get(segment.staffId) : null;
    const drafts =
      segment && segment.status === 'system_problem' && !segment.approvedAt
        ? this.drafts([this.leadOf(segment.staffId, dir)], {
            kind: 'system_problem',
            title: `${person ? `${person.name} (${person.code})` : 'A team member'} reported a system problem`,
            body: `Since ${segment.startedAt.toISOString()} · approve it so the time counts`,
            subjectType: 'attendance_segment',
            subjectId: segment.id,
          })
        : [];
    await this.notifications.syncSubject(
      'system_problem',
      'attendance_segment',
      segmentId,
      drafts,
      segment?.approvedAt
        ? { byStaffId: segment.approvedByStaffId, reason: 'approved' }
        : { byStaffId: null, reason: 'segment_gone' },
      now,
    );
  }

  /** Agents idle for more than 30 minutes, for their Team Lead. */
  async syncIdle(now: Date, dir?: StaffDirectory): Promise<void> {
    const directory = dir ?? (await this.directory());
    const before = new Date(now.getTime() - IDLE_BELL_MINUTES * 60 * 1000);
    const idle = await this.prisma.attendanceSegment.findMany({
      where: { status: 'idle', endedAt: null, startedAt: { lte: before }, day: { logoutAt: null } },
    });
    const drafts = idle.flatMap((segment) => {
      const person = directory.get(segment.staffId);
      if (!person || !AGENT_ROLES.includes(person.role)) return [];
      const minutes = Math.floor((now.getTime() - segment.startedAt.getTime()) / 60000);
      return this.drafts([directory.chainOf(person.id).teamLead], {
        kind: 'agent_idle',
        title: `${person.name} (${person.code}) idle over ${IDLE_BELL_MINUTES} minutes`,
        body: `Idle since ${segment.startedAt.toISOString()} (${minutes} minutes)`,
        subjectType: 'attendance_segment',
        subjectId: segment.id,
      });
    });
    await this.notifications.reconcileKind(
      'agent_idle',
      drafts,
      async (row) => {
        const segment = await this.prisma.attendanceSegment.findUnique({ where: { id: row.subjectId } });
        return { byStaffId: segment?.staffId ?? null, reason: segment?.endedAt ? 'idle_ended' : 'day_closed' };
      },
      now,
    );
  }

  /** An idle segment ended (the agent came back): clear the Team Lead's bell. */
  async closeIdle(segmentId: string, staffId: string, now: Date = this.notifications.now()): Promise<void> {
    await this.notifications.clear(
      { kind: 'agent_idle', subjectType: 'attendance_segment', subjectId: segmentId },
      { byStaffId: staffId, reason: 'idle_ended' },
      now,
    );
  }

  // ------------------------------------------------------------------ money

  /**
   * Refunds and payouts. Rupee amounts appear only here, and these kinds only
   * ever go to the CEO or Finance (Master Guide: Managers see no money).
   */
  async syncMoney(now: Date, dir?: StaffDirectory, who: 'ceo' | 'finance' | 'all' = 'all'): Promise<void> {
    const directory = dir ?? (await this.directory());
    const ceos = directory.ceos();
    const finance = directory.active('finance');
    const paymentClear = async (row: Notification): Promise<ClearInfo> => {
      const payment = await this.prisma.payment.findUnique({ where: { id: row.subjectId } });
      if (!payment) return { byStaffId: null, reason: 'payment_gone' };
      return {
        byStaffId: payment.paidByStaffId ?? payment.approvedByStaffId ?? null,
        reason: `payment_${payment.status}`,
      };
    };

    if (who === 'ceo' || who === 'all') {
      const withCeo = await this.prisma.payment.findMany({
        where: {
          type: 'refund',
          status: 'pending',
          OR: [{ ceoApprovalReason: { not: null } }, { outsideRules: true }],
        },
      });
      const drafts = withCeo.flatMap((payment) =>
        this.drafts(ceos, {
          kind: 'refund_needs_ceo',
          title: `Refund ${payment.code} needs your approval`,
          body: `${formatINR(payment.amount)} · ${(payment.ceoApprovalReason ?? 'outside_rules').replace(/_/g, ' ')}`,
          subjectType: 'payment',
          subjectId: payment.id,
        }, { id: payment.id }),
      );
      await this.notifications.reconcileKind('refund_needs_ceo', drafts, paymentClear, now);

      const expensesWithCeo = await this.prisma.expense.findMany({ where: { status: 'waiting_ceo' } });
      const expenseDrafts = expensesWithCeo.flatMap((expense) =>
        this.drafts(ceos, {
          kind: 'expense_needs_ceo',
          title: `Expense ${expense.code} needs your approval`,
          body: `${formatINR(expense.amountPaise)} · ${expense.supplier} · above Finance's limit`,
          subjectType: 'expense',
          subjectId: expense.id,
        }),
      );
      await this.notifications.reconcileKind('expense_needs_ceo', expenseDrafts, (row) => this.expenseClear(row), now);
    }

    if (who === 'finance' || who === 'all') {
      const ready = await this.prisma.payment.findMany({
        where: {
          type: 'refund',
          OR: [
            { status: 'pending', ceoApprovalReason: null, outsideRules: false },
            { status: 'approved' },
          ],
        },
      });
      const readyDrafts = ready.flatMap((payment) =>
        this.drafts(finance, {
          kind: 'refund_ready_to_pay',
          title:
            payment.status === 'approved'
              ? `Refund ${payment.code} approved — ready to pay`
              : `Refund ${payment.code} ready for you`,
          body: formatINR(payment.amount),
          subjectType: 'payment',
          subjectId: payment.id,
        }, { id: payment.id }),
      );
      await this.notifications.reconcileKind('refund_ready_to_pay', readyDrafts, paymentClear, now);

      const credits = await this.prisma.bankCredit.findMany({ where: { status: 'unmatched' } });
      const creditDrafts = credits.flatMap((credit) =>
        this.drafts(finance, {
          kind: 'bank_credit_unmatched',
          title: `Bank credit ${credit.bankUtr} not matched`,
          body: `${formatINR(credit.amountPaise)} received ${istDateLabel(credit.receivedAt)}`,
          subjectType: 'bank_credit',
          subjectId: credit.id,
        }, { id: credit.id }),
      );
      await this.notifications.reconcileKind(
        'bank_credit_unmatched',
        creditDrafts,
        async (row) => {
          const credit = await this.prisma.bankCredit.findUnique({ where: { id: row.subjectId } });
          return { byStaffId: null, reason: credit ? `credit_${credit.status}` : 'credit_gone' };
        },
        now,
      );

      const failed = await this.prisma.payment.findMany({
        where: { type: { in: OUTGOING_PAYMENT_TYPES }, status: 'failed' },
      });
      const failedDrafts = failed.flatMap((payment) =>
        this.drafts(finance, {
          kind: 'payout_failed',
          title: `Payout ${payment.code} failed`,
          body: `${formatINR(payment.amount)} · ${payment.type.replace(/_/g, ' ')} · retry it`,
          subjectType: 'payment',
          subjectId: payment.id,
        }),
      );
      await this.notifications.reconcileKind('payout_failed', failedDrafts, paymentClear, now);

      const toPay = await this.prisma.expense.findMany({ where: { status: { in: ['waiting_finance', 'approved'] } } });
      const toPayDrafts = toPay.flatMap((expense) =>
        this.drafts(finance, {
          kind: 'expense_to_pay',
          title: expense.status === 'approved' ? `Bill ${expense.code} approved — pay it` : `Bill ${expense.code} to approve and pay`,
          body: `${formatINR(expense.amountPaise)} · ${expense.supplier}`,
          subjectType: 'expense',
          subjectId: expense.id,
        }),
      );
      await this.notifications.reconcileKind('expense_to_pay', toPayDrafts, (row) => this.expenseClear(row), now);
    }
  }

  /**
   * Payroll and month-end bells (Phase 22 Part B):
   * - Finance: last month's salaries to prepare (once salaries are set up), a
   *   sheet the CEO sent back, and an approved month still to pay ("salaries
   *   ready to release") — cleared when the work moves on;
   * - CEO: a month's salary total waiting for approval;
   * - Finance and the CEO: last month (or a reopened month) not closed yet.
   */
  async syncPayroll(now: Date, dir?: StaffDirectory): Promise<void> {
    const directory = dir ?? (await this.directory());
    const ceos = directory.ceos();
    const finance = directory.active('finance');
    const lastMonth = monthBefore(istMonthOf(now));
    const runs = await this.prisma.payrollRun.findMany({
      where: { OR: [{ status: { in: ['with_ceo', 'returned', 'approved'] } }, { month: lastMonth }] },
      select: { month: true, status: true, netPaise: true, people: true, returnedReason: true },
    });
    const salariesSetUp = (await this.prisma.staffSalary.count()) > 0;
    const runClear = async (row: Notification): Promise<ClearInfo> => {
      const run = await this.prisma.payrollRun.findUnique({ where: { month: row.subjectId } });
      return { byStaffId: run?.approvedByStaffId ?? run?.preparedByStaffId ?? null, reason: run ? `payroll_${run.status}` : 'payroll_gone' };
    };

    const toRelease: NotificationDraft[] = [];
    for (const run of runs) {
      if (run.status === 'approved') {
        toRelease.push(
          ...this.drafts(finance, {
            kind: 'salaries_to_release',
            title: `${monthWords(run.month)} salaries ready to release`,
            body: `The CEO approved ${formatINR(run.netPaise)} for ${run.people} people · pay each one and record the UTR`,
            subjectType: 'payroll_month',
            subjectId: run.month,
          }, { month: run.month }),
        );
      } else if (run.status === 'returned') {
        toRelease.push(
          ...this.drafts(finance, {
            kind: 'salaries_to_release',
            title: `${monthWords(run.month)} salaries sent back by the CEO`,
            body: run.returnedReason ? `Check: ${run.returnedReason}` : 'Check the sheet and send it again',
            subjectType: 'payroll_month',
            subjectId: run.month,
          }, { month: run.month }),
        );
      }
    }
    if (salariesSetUp && !runs.some((r) => r.month === lastMonth)) {
      toRelease.push(
        ...this.drafts(finance, {
          kind: 'salaries_to_release',
          title: `Prepare ${monthWords(lastMonth)} salaries`,
          body: 'Check the sheet worked out from attendance and send the total to the CEO',
          subjectType: 'payroll_month',
          subjectId: lastMonth,
        }, { month: lastMonth }),
      );
    }
    await this.notifications.reconcileKind('salaries_to_release', toRelease, runClear, now);

    const needCeo = runs
      .filter((r) => r.status === 'with_ceo')
      .flatMap((run) =>
        this.drafts(ceos, {
          kind: 'salaries_need_ceo',
          title: `Approve ${monthWords(run.month)} salaries`,
          body: `${formatINR(run.netPaise)} net for ${run.people} people, worked out from attendance`,
          subjectType: 'payroll_month',
          subjectId: run.month,
        }, { month: run.month }),
      );
    await this.notifications.reconcileKind('salaries_need_ceo', needCeo, runClear, now);

    const closes = await this.prisma.monthClose.findMany({ where: { OR: [{ month: lastMonth }, { status: 'reopened' }] } });
    const open = new Set(closes.filter((c) => c.status === 'reopened').map((c) => c.month));
    if (!closes.some((c) => c.month === lastMonth)) open.add(lastMonth);
    const notClosed = [...open].sort().flatMap((month) =>
      this.drafts([...ceos, ...finance], {
        kind: 'month_not_closed',
        title: `${monthWords(month)} is not closed yet`,
        body: 'Check the month-end review: bank days, credits, payouts, salaries and bills — then the CEO closes it',
        subjectType: 'month',
        subjectId: month,
      }, { month }),
    );
    await this.notifications.reconcileKind(
      'month_not_closed',
      notClosed,
      async (row) => {
        const close = await this.prisma.monthClose.findUnique({ where: { month: row.subjectId } });
        return { byStaffId: close?.closedByStaffId ?? null, reason: close ? `month_${close.status}` : 'month_open' };
      },
      now,
    );
  }

  /** Who finished an expense bell's work: whoever paid, approved or rejected it. */
  private async expenseClear(row: Notification): Promise<ClearInfo> {
    const expense = await this.prisma.expense.findUnique({ where: { id: row.subjectId } });
    if (!expense) return { byStaffId: null, reason: 'expense_gone' };
    return {
      byStaffId: expense.paidByStaffId ?? expense.rejectedByStaffId ?? expense.approvedByStaffId ?? null,
      reason: `expense_${expense.status}`,
    };
  }

  // ------------------------------------------------------------ staff lines

  /** People without the reporting line the Master Guide requires: the CEO and Managers fix them. */
  async syncNoReportingLine(now: Date, dir?: StaffDirectory): Promise<void> {
    const directory = dir ?? (await this.directory());
    const missing = directory.rows.filter((row) => row.status === 'active' && !directory.hasLine(row));
    const drafts = missing.flatMap((row) => {
      const fixers = [
        ...directory.ceos(),
        ...(AGENT_ROLES.includes(row.role) || row.role === 'team_lead' ? directory.active('manager') : []),
      ];
      return this.drafts(fixers.filter((person) => person.id !== row.id), {
        kind: 'no_reporting_line',
        title: `${row.name} (${row.code}) has no reporting line`,
        body: `${row.role.replace(/_/g, ' ')} · requests go to the CEO until a line is set`,
        subjectType: 'staff',
        subjectId: row.id,
      });
    });
    await this.notifications.reconcileKind(
      'no_reporting_line',
      drafts,
      (row) => {
        const person = directory.get(row.subjectId);
        return { byStaffId: null, reason: person && person.status !== 'active' ? 'deactivated' : 'line_set' };
      },
      now,
    );
  }

  // ----------------------------------------------------------------- growth

  /** N3: an open shortage task is on its Team Lead's bell until it closes. */
  async syncShortageTasks(now: Date, dir?: StaffDirectory): Promise<void> {
    const directory = dir ?? (await this.directory());
    const open = await this.prisma.shortageTask.findMany({ where: { status: 'open' } });
    const drafts = open.flatMap((task) =>
      this.drafts([directory.get(task.assignedTeamLeadId)], {
        kind: 'shortage_task',
        title: task.title,
        body: `${task.openPositions} open position${task.openPositions === 1 ? '' : 's'} with no job seeker nearby`,
        subjectType: 'shortage_task',
        subjectId: task.id,
      }),
    );
    await this.notifications.reconcileKind(
      'shortage_task',
      drafts,
      async (row) => {
        const task = await this.prisma.shortageTask.findUnique({ where: { id: row.subjectId } });
        return { byStaffId: null, reason: task?.closedReason ?? (task ? 'reassigned' : 'task_gone') };
      },
      now,
    );
  }
}
