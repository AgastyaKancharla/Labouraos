import {
  BadRequestException,
  ForbiddenException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  Optional,
} from '@nestjs/common';
import { Prisma, SignupTracker } from '@prisma/client';
import { PrismaService } from '../../common/prisma/prisma.service';
import { AuditService } from '../../common/audit/audit.service';
import { CALL_TASK_KIND_SIGNUP_HELP, VISIT_PURPOSE_BUSINESS_SIGNUP } from '../../common/customer-auth/customer-app.constants';
import { PricingService } from '../pricing/pricing.service';
import { ReviewFlagService } from '../review-flag/review-flag.service';
import { BusinessVerificationService } from '../business/business-verification.service';
import { ReportingScopeService } from '../staff/reporting-scope.service';
import { OwnTeam } from '../../common/rbac/own-team';
import { SignupTrackerClock } from './signup-tracker-clock';
import { SignupFactsService } from './signup-facts.service';
import { SignupSettings, signupSettingsFrom } from './signup-settings';
import { DAY_MS, WorkCalendar, callWindow, callingWindow, isCallableNow, istDateKey, istDayStartMs, nextCallableAt } from './signup-timing';
import { assistedBy, planNext } from './signup-plan';
import { AssignmentCandidate, pickAgent } from './signup-assignment';
import { StageResult, stageIndex } from './signup-stage';
import { ownerAccountIds } from './signup-owner-accounts';
import { SIGNUP_REMINDER_SENDER, SignupReminderSender } from './signup-reminder.port';

/** Outcomes that mean "closed without finishing". Only `no_response` is nudged again (gave_up never is). */
export const REENGAGE_OUTCOMES = ['no_response', 'gave_up'];
const SUBJECT_TYPES = ['job_seeker', 'business', 'referral'];
/** A sign-up that fails to process is looked at again after this long, so it never blocks the sweep. */
const FAILURE_RETRY_MS = 60 * 60 * 1000;
/** Nobody on shift to call: look again after this long. */
const NO_AGENT_RETRY_MS = 30 * 60 * 1000;
/** Sign-ups looked at in one sweep (the oldest due first). */
const SWEEP_BATCH = 200;
/** The monthly re-engagement nudge stops after this many (proposal 4.2, capped by the review of PR #144). */
export const MAX_REENGAGE_NUDGES = 3;
/** Each process of one sign-up runs under this Postgres advisory lock, one at a time. */
const lockKey = (trackerId: string) => `signup-tracker:${trackerId}`;

export interface TrackerRunContext {
  now: Date;
  settings: SignupSettings;
  calendar: WorkCalendar;
}

interface SubjectInfo {
  window: { start: string | null; end: string | null };
  existingAgentIds: string[];
}

/**
 * The back office side of app sign-ups (customer app proposal section 4):
 * stages read from the records, the timing rules, automatic assignment,
 * "sign-up help" call tasks, the field agent suggestion on a business
 * sign-up's visit request, Team Lead reassignment, and the target credit.
 *
 * **Service API for the customer app (Agent A).** Every method is safe to call
 * more than once; each one re-reads the records.
 * - `onSignupChanged(trackerId)` after creating a tracker (stage A), after a
 *   registration sets its record (stage B), or after any step the person
 *   finishes in the app. Without the call the tracker job finds the sign-up
 *   anyway (it picks up trackers whose `nextActionAt` is null) within minutes.
 * - `onSubjectChanged(subjectType, subjectId)` when only the record is known
 *   (e.g. a link page step finished).
 * - `onCallbackRequested(requestId)` after "Call me back".
 * - `requestSeekerVisit(trackerId, note)` when a job seeker stuck at the ID
 *   step asks for an agent to come (proposal question 11).
 */
@Injectable()
export class SignupTrackerService {
  private readonly logger = new Logger(SignupTrackerService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly pricing: PricingService,
    private readonly audit: AuditService,
    private readonly facts: SignupFactsService,
    private readonly verification: BusinessVerificationService,
    private readonly reviewFlags: ReviewFlagService,
    private readonly scope: ReportingScopeService,
    private readonly clock: SignupTrackerClock,
    @Optional() @Inject(SIGNUP_REMINDER_SENDER) private readonly reminders?: SignupReminderSender,
  ) {
    this.ownTeam = new OwnTeam(prisma);
  }

  private readonly ownTeam: OwnTeam;

  now(): Date {
    return this.clock.now();
  }

  // ------------------------------------------------------------ context

  async context(now: Date = this.clock.now()): Promise<TrackerRunContext> {
    const policy = await this.pricing.current();
    const from = new Date(istDayStartMs(now.getTime()) - DAY_MS);
    const to = new Date(from.getTime() + 70 * DAY_MS);
    const holidays = await this.prisma.holiday.findMany({ where: { date: { gte: from, lte: to } }, select: { date: true } });
    return {
      now,
      settings: signupSettingsFrom(policy),
      calendar: {
        weeklyOffDays: policy.weeklyOffDays,
        // Holiday dates are IST calendar dates stored at UTC midnight.
        holidays: new Set(holidays.map((h) => h.date.toISOString().slice(0, 10))),
      },
    };
  }

    // ------------------------------------------------------------ service API

  async onSignupChanged(trackerId: string): Promise<void> {
    await this.process(trackerId, await this.context());
  }

  async onSubjectChanged(subjectType: string, subjectId: string): Promise<void> {
    const rows = await this.prisma.signupTracker.findMany({ where: { subjectType, subjectId }, select: { id: true } });
    if (rows.length === 0) return;
    const ctx = await this.context();
    for (const row of rows) await this.process(row.id, ctx);
  }

  async requestSeekerVisit(trackerId: string, note?: string | null): Promise<void> {
    const tracker = await this.prisma.signupTracker.findUnique({ where: { id: trackerId } });
    if (!tracker) throw new NotFoundException('Sign-up not found');
    if (tracker.profileKind !== 'job_seeker') throw new BadRequestException('Only a job seeker asks for a visit this way');
    const open = await this.prisma.signupTrackerEvent.findFirst({ where: { trackerId, kind: 'visit_request' } });
    if (open) return;
    await this.event(trackerId, 'visit_request', { note: (note ?? 'Asked for help with the ID check in person').slice(0, 200) });
  }

  // ------------------------------------------------------------ the job

  /**
   * One pass: the sign-ups that are due (never-looked-at ones first, then the
   * longest overdue), then "Call me back" requests. Every sign-up processed
   * gets a later `nextActionAt`, so none is looked at again every 5 minutes.
   */
  async sweep(now: Date = this.clock.now()) {
    const ctx = await this.context(now);
    const due = await this.prisma.signupTracker.findMany({
      where: {
        OR: [
          { outcome: 'open', OR: [{ nextActionAt: null }, { nextActionAt: { lte: now } }] },
          { outcome: 'no_response', nextActionAt: { lte: now } },
        ],
      },
      orderBy: [{ nextActionAt: { sort: 'asc', nulls: 'first' } }, { createdAt: 'asc' }],
      take: SWEEP_BATCH,
      select: { id: true },
    });
    let processed = 0;
    let failed = 0;
    for (const row of due) {
      try {
        await this.process(row.id, ctx);
        processed += 1;
      } catch (err) {
        failed += 1;
        this.logger.error(`Sign-up ${row.id} failed: ${(err as Error).message}`);
        await this.prisma.signupTracker
          .update({ where: { id: row.id }, data: { nextActionAt: new Date(now.getTime() + FAILURE_RETRY_MS) } })
          .catch(() => undefined);
      }
    }
    const callbacks = await this.takeCallbackRequests(ctx);
    return { processed, failed, callbacks };
  }

  /**
   * Brings one sign-up up to date and does whatever is due. One run at a time
   * per sign-up (Postgres advisory lock): a second run started meanwhile (the
   * app's call and the job together) returns at once without doing anything.
   */
  async process(trackerId: string, ctx: TrackerRunContext): Promise<SignupTracker | null> {
    return this.prisma.$transaction(
      async (tx) => {
        const [lock] = await tx.$queryRaw<{ locked: boolean }[]>(
          Prisma.sql`SELECT pg_try_advisory_xact_lock(hashtext(${lockKey(trackerId)})) AS locked`,
        );
        if (!lock?.locked) return null;
        return this.run(trackerId, ctx);
      },
      { maxWait: 10_000, timeout: 120_000 },
    );
  }

  private async run(trackerId: string, ctx: TrackerRunContext): Promise<SignupTracker | null> {
    let tracker = await this.prisma.signupTracker.findUnique({ where: { id: trackerId } });
    if (!tracker) return null;
    if (tracker.outcome === 'self' || tracker.outcome === 'assisted') return tracker;
    const account = tracker.accountId
      ? await this.prisma.customerAccount.findUnique({ where: { id: tracker.accountId }, select: { status: true, contactMeConsent: true } })
      : null;
    // Deleted, blocked or asked to delete: everything stops and nothing is queued.
    if (account && account.status !== 'active') {
      return this.stop(tracker, ctx, `Account ${account.status}`);
    }
    const result = await this.facts.stageOf(tracker.profileKind, tracker);
    tracker = await this.applyStage(tracker, result, ctx);
    if (tracker.stage === 'done') return this.finish(tracker, ctx);
    if (tracker.outcome === 'gave_up') return this.setNext(tracker, null);

    if (tracker.profileKind === 'business' && tracker.subjectId) await this.suggestVisit(tracker);
    await this.closeMissedTasks(tracker, ctx);

    if (tracker.outcome === 'open' && (await this.declinedCalls(tracker))) {
      return this.stop(tracker, ctx, 'Said not interested on a call');
    }
    if (tracker.outcome === 'no_response') return this.reengage(tracker, result, ctx);

    // The account's own tick is the truth; the tracker's copy only when there is no account.
    const consent = account ? account.contactMeConsent : tracker.contactConsent;
    const callable = Boolean(tracker.subjectId) && consent;
    if (!callable) await this.cancelSignupTasks(tracker, ctx);
    const subject = await this.subjectInfo(tracker);
    const window = callWindow(ctx.settings, subject.window);
    for (let step = 0; step < 4; step += 1) {
      const lastTask = await this.prisma.callTask.findFirst({
        where: { signupTrackerId: tracker.id, kind: CALL_TASK_KIND_SIGNUP_HELP },
        orderBy: { dueAt: 'desc' },
        select: { dueAt: true },
      });
      const plan = planNext(
        {
          profileKind: tracker.profileKind,
          stage: tracker.stage,
          stoppedAt: tracker.lastActivityAt,
          remindersDone: await this.reminderSlots(tracker),
          callTries: tracker.callTries,
          callable,
          lastCallDueAt: lastTask?.dueAt ?? null,
          personWindow: window,
        },
        ctx.settings,
        ctx.calendar,
      );
      if (plan.at.getTime() > ctx.now.getTime()) return this.setNext(tracker, plan.at);
      if (plan.action === 'reminder') {
        const next = await this.remind(tracker, result, ctx);
        if (next.deferUntil) return this.setNext(next.tracker, next.deferUntil);
        tracker = next.tracker;
      } else if (plan.action === 'call_task') {
        // Never hand a call to anyone outside the working window, even if their day is still open.
        if (!isCallableNow(ctx.now, ctx.calendar, window)) {
          return this.setNext(tracker, nextCallableAt(ctx.now, ctx.calendar, window));
        }
        const created = await this.createCallTask(tracker, subject, ctx.now, ctx);
        if (!created) return this.setNext(tracker, new Date(ctx.now.getTime() + NO_AGENT_RETRY_MS));
        tracker = created;
      } else {
        return this.closeNoResponse(tracker, ctx, callable ? `${tracker.callTries} call tries` : 'No call allowed; tries window over');
      }
    }
    return this.setNext(tracker, new Date(ctx.now.getTime() + NO_AGENT_RETRY_MS));
  }

  private setNext(tracker: SignupTracker, at: Date | null) {
    return this.prisma.signupTracker.update({ where: { id: tracker.id }, data: { nextActionAt: at } });
  }

  // ------------------------------------------------------------ stages

  private async applyStage(tracker: SignupTracker, result: StageResult, ctx: TrackerRunContext): Promise<SignupTracker> {
    const forward = stageIndex(result.stage) > stageIndex(tracker.stage);
    if (!forward && tracker.stuckReason === result.stuckReason) return tracker;
    const data: Prisma.SignupTrackerUpdateInput = { stuckReason: result.stuckReason };
    if (forward) {
      Object.assign(data, {
        stage: result.stage,
        stageReachedAt: ctx.now,
        lastActivityAt: ctx.now,
        // A new stop: the reminders and the call tries start again from here.
        remindersSent: 0,
        callTries: 0,
        // Moving forward again reopens a closed sign-up.
        outcome: 'open',
      });
    }
    const updated = await this.prisma.signupTracker.update({ where: { id: tracker.id }, data });
    if (forward) {
      await this.prisma.signupTrackerEvent.create({
        data: { trackerId: tracker.id, kind: 'stage', fromStage: tracker.stage, toStage: result.stage },
      });
    }
    return updated;
  }

  /** When the record says it finished: the ₹499 arrived, or the business was verified. */
  private async completedAt(tracker: SignupTracker, ctx: TrackerRunContext): Promise<Date> {
    if (tracker.subjectType === 'job_seeker' && tracker.subjectId) {
      const s = await this.prisma.jobSeeker.findUnique({ where: { id: tracker.subjectId }, select: { paymentReceivedAt: true } });
      if (s?.paymentReceivedAt) return s.paymentReceivedAt;
    }
    if (tracker.subjectType === 'business' && tracker.subjectId) {
      const b = await this.prisma.business.findUnique({ where: { id: tracker.subjectId }, select: { verifiedAt: true } });
      if (b?.verifiedAt) return b.verifiedAt;
    }
    return ctx.now;
  }

  /** Finished: who gets the credit, and the open tasks are closed. */
  private async finish(tracker: SignupTracker, ctx: TrackerRunContext): Promise<SignupTracker> {
    const finishedAt = await this.completedAt(tracker, ctx);
    const credit = await this.creditFor(tracker, finishedAt);
    const outcome = credit ? 'assisted' : 'self';
    const updated = await this.prisma.signupTracker.update({
      where: { id: tracker.id },
      data: { outcome, finishedAt, nextActionAt: null },
    });
    await this.cancelSignupTasks(tracker, ctx);
    await this.event(tracker.id, 'closed', { note: outcome, staffId: credit });
    return updated;
  }

  /**
   * The assigned call agent, only with that agent's answered call of at least
   * ASSISTED_CALL_MIN_SECONDS after the assignment and before the payment
   * (question 13). See signup-plan.ts for why GPS visits do not count here.
   */
  async creditFor(tracker: SignupTracker, completedAt: Date): Promise<string | null> {
    if (!tracker.assignedStaffId || !tracker.assignedAt || !tracker.subjectType || !tracker.subjectId) return null;
    const window = { gte: tracker.assignedAt, lte: completedAt };
    const calls = await this.prisma.callRecord.findMany({
      where: {
        staffId: tracker.assignedStaffId,
        subjectType: tracker.subjectType,
        subjectId: tracker.subjectId,
        answered: true,
        OR: [{ answeredAt: window }, { answeredAt: null, startedAt: window }],
      },
      select: { staffId: true, answeredAt: true, startedAt: true, createdAt: true, durationSec: true },
    });
    return assistedBy({
      assignedStaffId: tracker.assignedStaffId,
      assignedAt: tracker.assignedAt,
      completedAt,
      connectedCalls: calls.map((c) => ({ staffId: c.staffId, at: c.answeredAt ?? c.startedAt ?? c.createdAt, durationSec: c.durationSec })),
    });
  }

  /** 3 tries with no luck (or the tries window over for someone nobody may call): the monthly list. */
  private async closeNoResponse(tracker: SignupTracker, ctx: TrackerRunContext, note: string) {
    const updated = await this.prisma.signupTracker.update({
      where: { id: tracker.id },
      data: { outcome: 'no_response', nextActionAt: new Date(ctx.now.getTime() + ctx.settings.reengageDays * DAY_MS) },
    });
    await this.cancelSignupTasks(tracker, ctx);
    await this.event(tracker.id, 'closed', { note: `no_response: ${note}` });
    // A business lead that never answers: the Team Lead is told, as for follow-ups after 3 tries.
    if (tracker.profileKind === 'business' && tracker.subjectId && tracker.callTries > 0) {
      await this.reviewFlags
        .raise({
          kind: 'follow_up_unanswered',
          subjectType: 'business',
          subjectId: tracker.subjectId,
          raisedForStaffId: tracker.assignedStaffId,
          details: { signupTrackerId: tracker.id, unansweredCalls: tracker.callTries, source: 'app_signup' },
        })
        .catch((err: unknown) => this.logger.warn(`Team Lead flag failed for sign-up ${tracker.id}: ${String(err)}`));
    }
    return updated;
  }

  /** Said "not interested", or the account was closed: nothing more, ever (no re-engagement). */
  private async stop(tracker: SignupTracker, ctx: TrackerRunContext, note: string) {
    await this.cancelSignupTasks(tracker, ctx);
    if (tracker.outcome === 'gave_up' && tracker.nextActionAt === null) return tracker;
    const updated = await this.prisma.signupTracker.update({ where: { id: tracker.id }, data: { outcome: 'gave_up', nextActionAt: null } });
    await this.event(tracker.id, 'closed', { note: `gave_up: ${note}` });
    return updated;
  }

  /**
   * The monthly re-engagement nudge (push / in-app only, so no contact-me tick
   * is needed): never in quiet hours, never after "not interested", and at
   * most MAX_REENGAGE_NUDGES times.
   */
  private async reengage(tracker: SignupTracker, result: StageResult, ctx: TrackerRunContext) {
    const nudges = await this.prisma.signupTrackerEvent.count({ where: { trackerId: tracker.id, kind: { in: ['reengage', 'reengage_due'] } } });
    if (nudges >= MAX_REENGAGE_NUDGES) {
      await this.event(tracker.id, 'closed', { note: `re-engagement ended after ${nudges} nudges` });
      return this.setNext(tracker, null);
    }
    const quietUntil = this.quietUntil(ctx);
    if (quietUntil) return this.setNext(tracker, quietUntil);
    const sent = await this.send(tracker, result, 'reengage', `reengage:${tracker.id}:${istDateKey(ctx.now.getTime()).slice(0, 7)}`);
    await this.event(tracker.id, sent === 'sent' ? 'reengage' : 'reengage_due', { note: sent === 'sent' ? null : `not sent: ${sent}`, at: ctx.now });
    return this.setNext(tracker, new Date(ctx.now.getTime() + ctx.settings.reengageDays * DAY_MS));
  }

  // ------------------------------------------------------------ reminders

  /** Reminder slots already passed at this stop: sent ones, and due ones the sender could not send. */
  private async reminderSlots(tracker: SignupTracker): Promise<number> {
    // Stages only move forward, so the reminders of this stop are the ones written for this stage.
    const events = await this.prisma.signupTrackerEvent.count({
      where: { trackerId: tracker.id, kind: { in: ['reminder', 'reminder_due'] }, toStage: tracker.stage },
    });
    return Math.max(tracker.remindersSent, events);
  }

  /** Quiet hours (outside the calling hours): when they end, else null. */
  private quietUntil(ctx: TrackerRunContext): Date | null {
    const quiet = callingWindow(ctx.settings);
    const day = istDayStartMs(ctx.now.getTime());
    const minute = Math.floor((ctx.now.getTime() - day) / 60_000);
    if (minute < quiet.start) return new Date(day + quiet.start * 60_000);
    if (minute >= quiet.end) return new Date(day + DAY_MS + quiet.start * 60_000);
    return null;
  }

  /**
   * A reminder that is due. Checked against quiet hours now (not only when it
   * was planned). Until the notification service is connected it is recorded
   * as "due, not sent" and `remindersSent` stays as it is, so no screen shows
   * a reminder that never went out.
   */
  private async remind(
    tracker: SignupTracker,
    result: StageResult,
    ctx: TrackerRunContext,
  ): Promise<{ tracker: SignupTracker; deferUntil?: Date }> {
    const quietUntil = this.quietUntil(ctx);
    if (quietUntil) return { tracker, deferUntil: quietUntil };
    const n = (await this.reminderSlots(tracker)) + 1;
    if (!this.reminders || !tracker.accountId) {
      await this.event(tracker.id, 'reminder_due', { note: `${n} · not sent: ${this.reminders ? 'no app account' : 'sender not connected'}`, toStage: tracker.stage, at: ctx.now });
      return { tracker };
    }
    // Claim the slot first, so a second run never sends the same reminder twice.
    const claimed = await this.prisma.signupTracker.updateMany({
      where: { id: tracker.id, remindersSent: tracker.remindersSent, outcome: 'open' },
      data: { remindersSent: { increment: 1 } },
    });
    if (claimed.count !== 1) return { tracker: (await this.prisma.signupTracker.findUnique({ where: { id: tracker.id } })) ?? tracker };
    const sent = await this.send(tracker, result, n === 1 ? 1 : 2, `signup:${tracker.id}:${tracker.stage}:${n}`);
    if (sent === 'sent') {
      await this.event(tracker.id, 'reminder', { note: String(n), toStage: tracker.stage, at: ctx.now });
    } else {
      await this.prisma.signupTracker.update({ where: { id: tracker.id }, data: { remindersSent: { decrement: 1 } } });
      await this.event(tracker.id, 'reminder_due', { note: `${n} · not sent: ${sent}`, toStage: tracker.stage, at: ctx.now });
    }
    return { tracker: (await this.prisma.signupTracker.findUnique({ where: { id: tracker.id } })) ?? tracker };
  }

  private async send(
    tracker: SignupTracker,
    result: StageResult,
    reminder: 1 | 2 | 'reengage',
    dedupeKey: string,
  ): Promise<'sent' | 'sender not connected' | 'no app account' | 'failed'> {
    if (!this.reminders) return 'sender not connected';
    if (!tracker.accountId) return 'no app account';
    const profile = tracker.subjectId
      ? await this.prisma.customerProfile.findFirst({
          where: {
            accountId: tracker.accountId,
            OR: [{ jobSeekerId: tracker.subjectId }, { businessId: tracker.subjectId }, { referralId: tracker.subjectId }],
          },
          select: { id: true },
        })
      : null;
    try {
      await this.reminders.sendSignupReminder({
        accountId: tracker.accountId,
        profileId: profile?.id ?? null,
        trackerId: tracker.id,
        profileKind: tracker.profileKind,
        stage: tracker.stage,
        reminder,
        missing: result.missing,
        dedupeKey,
      });
      return 'sent';
    } catch (err) {
      // A reminder is a nicety; the timing carries on to the call task.
      this.logger.warn(`Reminder for sign-up ${tracker.id} failed: ${(err as Error).message}`);
      return 'failed';
    }
  }

  // ------------------------------------------------------------ calls

  /** The staff who own the record itself (registered it, or hold the business): its team. */
  async recordOwners(tracker: Pick<SignupTracker, 'subjectType' | 'subjectId'>): Promise<string[]> {
    if (!tracker.subjectType || !tracker.subjectId) return [];
    if (tracker.subjectType === 'job_seeker') {
      const s = await this.prisma.jobSeeker.findUnique({ where: { id: tracker.subjectId }, select: { registeredByStaffId: true } });
      return [s?.registeredByStaffId].filter((x): x is string => Boolean(x));
    }
    if (tracker.subjectType === 'business') {
      const b = await this.prisma.business.findUnique({ where: { id: tracker.subjectId }, select: { leadCreatedByStaffId: true, accountAgentId: true } });
      return [b?.leadCreatedByStaffId, b?.accountAgentId].filter((x): x is string => Boolean(x));
    }
    const r = await this.prisma.referral.findUnique({ where: { id: tracker.subjectId }, select: { registeredByStaffId: true } });
    return [r?.registeredByStaffId].filter((x): x is string => Boolean(x));
  }

  private async subjectInfo(tracker: SignupTracker): Promise<SubjectInfo> {
    const info: SubjectInfo = { window: { start: null, end: null }, existingAgentIds: [] };
    if (tracker.assignedStaffId) info.existingAgentIds.push(tracker.assignedStaffId);
    if (!tracker.subjectType || !tracker.subjectId) return info;
    if (tracker.subjectType === 'job_seeker') {
      const s = await this.prisma.jobSeeker.findUnique({
        where: { id: tracker.subjectId },
        select: { preferredCallWindowStart: true, preferredCallWindowEnd: true },
      });
      if (s) info.window = { start: s.preferredCallWindowStart, end: s.preferredCallWindowEnd };
    }
    info.existingAgentIds.push(...(await this.recordOwners(tracker)));
    const spoke = await this.prisma.callRecord.findFirst({
      where: { subjectType: tracker.subjectType, subjectId: tracker.subjectId, answered: true, staffId: { not: null } },
      orderBy: { createdAt: 'desc' },
      select: { staffId: true },
    });
    if (spoke?.staffId) info.existingAgentIds.push(spoke.staffId);
    info.existingAgentIds = [...new Set(info.existingAgentIds)];
    return info;
  }

  /** "Not interested" on any answered call about this person since the sign-up started stops the calls. */
  private async declinedCalls(tracker: SignupTracker): Promise<boolean> {
    if (!tracker.subjectType || !tracker.subjectId) return false;
    const row = await this.prisma.callRecord.findFirst({
      where: {
        subjectType: tracker.subjectType,
        subjectId: tracker.subjectId,
        agentOutcome: 'not_interested',
        createdAt: { gte: tracker.createdAt },
      },
      select: { id: true },
    });
    return Boolean(row);
  }

  /** A sign-up help task due on an earlier day that is still open was a try that did not reach him. */
  private async closeMissedTasks(tracker: SignupTracker, ctx: TrackerRunContext) {
    const todayStart = new Date(istDayStartMs(ctx.now.getTime()));
    await this.prisma.callTask.updateMany({
      where: { signupTrackerId: tracker.id, kind: CALL_TASK_KIND_SIGNUP_HELP, status: 'open', dueAt: { lt: todayStart } },
      data: { status: 'cancelled', doneAt: ctx.now },
    });
  }

  /** Every open sign-up help task for this sign-up or its person comes off the work lists. */
  private async cancelSignupTasks(tracker: SignupTracker, ctx: TrackerRunContext) {
    const or: Prisma.CallTaskWhereInput[] = [{ signupTrackerId: tracker.id }];
    if (tracker.subjectType && tracker.subjectId) or.push({ subjectType: tracker.subjectType, subjectId: tracker.subjectId });
    await this.prisma.callTask.updateMany({
      where: { kind: CALL_TASK_KIND_SIGNUP_HELP, status: 'open', OR: or },
      data: { status: 'cancelled', doneAt: ctx.now },
    });
  }

  /** Everyone who could take a sign-up help call now, with what the assignment rules need. */
  async candidates(now: Date): Promise<AssignmentCandidate[]> {
    const staff = await this.prisma.staff.findMany({
      where: {
        role: 'call_agent',
        status: 'active',
        lockedByStaffId: null,
        OR: [{ lockedUntil: null }, { lockedUntil: { lte: now } }],
      },
      select: { id: true, code: true, spokenLanguages: true },
    });
    if (staff.length === 0) return [];
    const ids = staff.map((s) => s.id);
    const today = new Date(`${istDateKey(now.getTime())}T00:00:00.000Z`);
    const [days, sessions, open, last, owners] = await Promise.all([
      this.prisma.attendanceDay.findMany({
        where: { staffId: { in: ids }, date: today, loginAt: { not: null }, logoutAt: null, dayType: { not: 'leave' } },
        select: { staffId: true },
      }),
      this.prisma.staffSession.findMany({
        where: { staffId: { in: ids }, revokedAt: null, expiresAt: { gt: now }, absoluteExpiresAt: { gt: now } },
        select: { staffId: true },
      }),
      this.prisma.callTask.groupBy({
        by: ['staffId'],
        where: { staffId: { in: ids }, kind: CALL_TASK_KIND_SIGNUP_HELP, status: 'open' },
        _count: { _all: true },
      }),
      this.prisma.signupTracker.groupBy({
        by: ['assignedStaffId'],
        where: { assignedStaffId: { in: ids } },
        _max: { assignedAt: true },
      }),
      ownerAccountIds(this.prisma, ids),
    ]);
    const onShift = new Set(days.map((d) => d.staffId));
    const signedIn = new Set(sessions.map((s) => s.staffId));
    const openBy = new Map(open.map((o) => [o.staffId, o._count._all]));
    const lastBy = new Map(last.map((l) => [l.assignedStaffId, l._max.assignedAt]));
    return staff.map((s) => ({
      id: s.id,
      code: s.code,
      onShift: onShift.has(s.id),
      isOwnerAccount: owners.has(s.id),
      signedIn: signedIn.has(s.id),
      spokenLanguages: s.spokenLanguages,
      openSignupTasks: openBy.get(s.id) ?? 0,
      lastSignupAssignedAt: lastBy.get(s.id) ?? null,
    }));
  }

  /** "Nobody on shift" is written at most once a day per sign-up. */
  private async noteNoAgent(tracker: SignupTracker, ctx: TrackerRunContext) {
    const today = new Date(istDayStartMs(ctx.now.getTime()));
    const already = await this.prisma.signupTrackerEvent.findFirst({
      where: { trackerId: tracker.id, kind: 'unassigned', createdAt: { gte: today } },
      select: { id: true },
    });
    if (!already) await this.event(tracker.id, 'unassigned', { note: 'No call agent on shift', at: ctx.now });
  }

  private async createCallTask(
    tracker: SignupTracker,
    subject: SubjectInfo,
    dueAt: Date,
    ctx: TrackerRunContext,
  ): Promise<SignupTracker | null> {
    if (!tracker.subjectType || !tracker.subjectId) return null;
    const open = await this.prisma.callTask.findFirst({
      where: { signupTrackerId: tracker.id, kind: CALL_TASK_KIND_SIGNUP_HELP, status: 'open' },
    });
    if (open) {
      // Already on someone's list today (e.g. a "Call me back"): that is today's try.
      await this.prisma.signupTracker.updateMany({
        where: { id: tracker.id, callTries: tracker.callTries },
        data: { callTries: { increment: 1 } },
      });
      return this.prisma.signupTracker.findUnique({ where: { id: tracker.id } });
    }
    // A Team Lead's move sticks: the next try goes to the same agent, and waits for them if they are away.
    let pick: { staffId: string; reason: string } | null = null;
    if (tracker.assignmentReason === 'manual' && tracker.assignedStaffId) {
      const chosen = await this.prisma.staff.findFirst({
        where: { id: tracker.assignedStaffId, role: 'call_agent', status: 'active' },
        select: { id: true },
      });
      if (chosen) pick = { staffId: chosen.id, reason: 'manual' };
    }
    pick ??= pickAgent({ candidates: await this.candidates(ctx.now), existingAgentIds: subject.existingAgentIds, language: tracker.language });
    if (!pick) {
      await this.noteNoAgent(tracker, ctx);
      return null;
    }
    const sameAgent = tracker.assignedStaffId === pick.staffId;
    // Claim the try first, so two runs never put two tasks on the lists.
    const claimed = await this.prisma.signupTracker.updateMany({
      where: { id: tracker.id, callTries: tracker.callTries, outcome: 'open' },
      data: {
        callTries: { increment: 1 },
        ...(sameAgent ? {} : { assignedStaffId: pick.staffId, assignedAt: ctx.now, assignmentReason: pick.reason }),
      },
    });
    if (claimed.count !== 1) return this.prisma.signupTracker.findUnique({ where: { id: tracker.id } });
    await this.prisma.callTask.create({
      data: {
        staffId: pick.staffId,
        subjectType: tracker.subjectType,
        subjectId: tracker.subjectId,
        kind: CALL_TASK_KIND_SIGNUP_HELP,
        dueAt,
        signupTrackerId: tracker.id,
      },
    });
    const updated = await this.prisma.signupTracker.findUniqueOrThrow({ where: { id: tracker.id } });
    if (!sameAgent) await this.event(tracker.id, tracker.assignedStaffId ? 'reassigned' : 'assigned', { staffId: pick.staffId, note: pick.reason });
    await this.event(tracker.id, 'call_task', { staffId: pick.staffId, note: `try ${updated.callTries}` });
    return updated;
  }

  /** Business sign-ups: the visit request Agent A made gets the nearest available field agent suggested. */
  private async suggestVisit(tracker: SignupTracker) {
    const rows = await this.prisma.visitAssignment.findMany({
      where: { signupTrackerId: tracker.id, purpose: VISIT_PURPOSE_BUSINESS_SIGNUP, status: 'pending' },
      select: { id: true, suggestedStaffId: true },
    });
    for (const row of rows) {
      const staffId = await this.verification.prepareSignupVisit(row.id);
      if (staffId && !row.suggestedStaffId) {
        await this.event(tracker.id, 'visit_request', { staffId, note: 'Field agent suggested; Team Lead confirms' });
      }
    }
  }

  // ------------------------------------------------------------ call me back

  /** Open "Call me back" requests become call tasks (sign-up help during a sign-up, callback otherwise). */
  async takeCallbackRequests(ctx: TrackerRunContext): Promise<number> {
    const open = await this.prisma.customerCallbackRequest.findMany({
      where: { status: 'open' },
      orderBy: { createdAt: 'asc' },
      take: 100,
      select: { id: true },
    });
    let made = 0;
    for (const request of open) {
      if (await this.takeCallback(request.id, ctx)) made += 1;
    }
    return made;
  }

  async onCallbackRequested(requestId: string): Promise<void> {
    await this.takeCallback(requestId, await this.context());
  }

  private async takeCallback(requestId: string, ctx: TrackerRunContext): Promise<boolean> {
    const request = await this.prisma.customerCallbackRequest.findUnique({ where: { id: requestId } });
    if (!request || request.status !== 'open') return false;
    const profile = request.profileId
      ? await this.prisma.customerProfile.findFirst({ where: { id: request.profileId, accountId: request.accountId, status: 'active' } })
      : await this.prisma.customerProfile.findFirst({ where: { accountId: request.accountId, status: 'active' }, orderBy: { updatedAt: 'desc' } });
    const subjectId = profile ? profile.jobSeekerId ?? profile.businessId ?? profile.referralId : null;
    if (!profile || !subjectId || !SUBJECT_TYPES.includes(profile.kind)) {
      // Nothing an agent can call through the calling system: closed, not left open forever.
      await this.prisma.customerCallbackRequest.updateMany({ where: { id: request.id, status: 'open' }, data: { status: 'cancelled', doneAt: ctx.now } });
      this.logger.log(`Call me back ${request.id} closed: no registered profile to call`);
      return false;
    }
    const subjectType = profile.kind;
    const tracker = await this.prisma.signupTracker.findFirst({
      where: { accountId: request.accountId, subjectType, subjectId, outcome: 'open' },
    });
    const info = tracker ? await this.subjectInfo(tracker) : { window: { start: null, end: null }, existingAgentIds: [] };
    const window = callWindow(ctx.settings, { start: request.preferredFrom ?? info.window.start, end: request.preferredTo ?? info.window.end });
    // Only inside office hours on a working day: never handed to someone whose day is merely still open.
    if (!isCallableNow(ctx.now, ctx.calendar, callWindow(ctx.settings))) return false;
    // Claim the request first, so two runs never make two tasks for it.
    const claimed = await this.prisma.customerCallbackRequest.updateMany({ where: { id: request.id, status: 'open' }, data: { status: 'assigned' } });
    if (claimed.count !== 1) return false;
    const pick = pickAgent({ candidates: await this.candidates(ctx.now), existingAgentIds: info.existingAgentIds, language: tracker?.language ?? null });
    if (!pick) {
      await this.prisma.customerCallbackRequest.update({ where: { id: request.id }, data: { status: 'open' } });
      return false;
    }
    const dueAt = nextCallableAt(ctx.now, ctx.calendar, window);
    const kind = tracker && request.topic === 'signup' ? CALL_TASK_KIND_SIGNUP_HELP : 'callback';
    const task = await this.prisma.callTask.create({
      data: { staffId: pick.staffId, subjectType, subjectId, kind, dueAt, signupTrackerId: kind === CALL_TASK_KIND_SIGNUP_HELP ? tracker!.id : null },
    });
    await this.prisma.customerCallbackRequest.update({
      where: { id: request.id },
      data: { callTaskId: task.id, assignedStaffId: pick.staffId },
    });
    if (tracker && kind === CALL_TASK_KIND_SIGNUP_HELP) {
      if (tracker.assignedStaffId !== pick.staffId) {
        await this.prisma.signupTracker.update({
          where: { id: tracker.id },
          data: { assignedStaffId: pick.staffId, assignedAt: ctx.now, assignmentReason: pick.reason },
        });
      }
      await this.event(tracker.id, 'call_task', { staffId: pick.staffId, note: 'Call me back' });
    }
    return true;
  }

  // ------------------------------------------------------------ Team Lead / Manager / CEO

  /**
   * Move a sign-up (and its open call task) to another call agent.
   * - Team Lead: only sign-ups of their own team (assigned to a team member,
   *   or with no agent yet but registered by one) and only to their own team.
   *   A sign-up with no owner belongs to no team: Managers and the CEO.
   * - Manager: inside their own tree (and no-team sign-ups).
   * - CEO: anyone.
   */
  async reassign(actor: { id: string; role: string }, trackerId: string, staffId: string, reason?: string | null) {
    if (!staffId) throw new BadRequestException('Pick the agent to move it to');
    const tracker = await this.prisma.signupTracker.findUnique({ where: { id: trackerId } });
    if (!tracker) throw new NotFoundException('Sign-up not found');
    if (tracker.outcome !== 'open') throw new BadRequestException('This sign-up is closed');
    if (tracker.assignedStaffId === staffId) throw new BadRequestException('It is already with this agent');
    const target = await this.prisma.staff.findUnique({ where: { id: staffId }, select: { id: true, role: true, status: true, code: true } });
    if (!target || target.role !== 'call_agent' || target.status !== 'active') {
      throw new BadRequestException('Sign-up help goes to an active call agent');
    }
    const owner = tracker.assignedStaffId ?? (await this.recordOwners(tracker))[0] ?? null;
    if (actor.role === 'team_lead') {
      if (!(await this.ownTeam.includes(actor.id, target.id))) throw new ForbiddenException('Team Leads move sign-ups only to their own team');
      if (!owner) throw new ForbiddenException('This sign-up belongs to no team: a Manager or the CEO gives it out');
      if (!(await this.ownTeam.includes(actor.id, owner))) throw new ForbiddenException('This sign-up belongs to another team');
    } else if (actor.role === 'manager') {
      const under = await this.peopleUnder(actor.id);
      if (!under.has(target.id)) throw new ForbiddenException('Managers move sign-ups only inside their own teams');
      if (owner && !under.has(owner)) throw new ForbiddenException('This sign-up belongs to another Manager’s team');
    } else if (actor.role !== 'ceo') {
      throw new ForbiddenException('Only a Team Lead, Manager or CEO moves a sign-up');
    }
    const now = this.clock.now();
    await this.prisma.$transaction([
      this.prisma.callTask.updateMany({
        where: { signupTrackerId: tracker.id, kind: CALL_TASK_KIND_SIGNUP_HELP, status: 'open' },
        data: { staffId: target.id },
      }),
      this.prisma.signupTracker.update({
        where: { id: tracker.id },
        data: { assignedStaffId: target.id, assignedAt: now, assignmentReason: 'manual' },
      }),
      this.prisma.signupTrackerEvent.create({
        data: { trackerId: tracker.id, kind: 'reassigned', staffId: target.id, byStaffId: actor.id, note: reason?.slice(0, 200) ?? null },
      }),
    ]);
    await this.audit.log({
      actorId: actor.id,
      action: 'signup_tracker.reassigned',
      entityType: 'signup_tracker',
      entityCode: tracker.id,
      before: { assignedStaffId: tracker.assignedStaffId },
      after: { assignedStaffId: target.id, assignmentReason: 'manual' },
      changedFields: ['assignedStaffId', 'assignmentReason'],
      reason: reason ?? 'Moved by hand',
    });
    return { id: tracker.id, assignedStaffId: target.id, assignedTo: target.code };
  }

  /** A Team Lead, Manager or the CEO sends a field agent to a business sign-up (team checks in BusinessVerificationService.assign). */
  async assignSignupVisit(actor: { id: string; role: string }, assignmentId: string, staffId: string) {
    const assignment = await this.prisma.visitAssignment.findUnique({ where: { id: assignmentId }, select: { purpose: true, signupTrackerId: true } });
    if (!assignment) throw new NotFoundException('Visit request not found');
    if (assignment.purpose !== VISIT_PURPOSE_BUSINESS_SIGNUP) {
      throw new BadRequestException('Only an app sign-up visit request is assigned here');
    }
    if (actor.role === 'manager' && staffId && !(await this.peopleUnder(actor.id)).has(staffId)) {
      throw new ForbiddenException('Managers send only field agents in their own teams');
    }
    const updated = await this.verification.assign(assignmentId, actor.id, staffId);
    if (assignment.signupTrackerId) {
      await this.event(assignment.signupTrackerId, 'visit_request', { staffId, byStaffId: actor.id, note: 'Field agent confirmed' });
    }
    return updated;
  }

  async peopleUnder(managerId: string): Promise<Set<string>> {
    return new Set(await this.scope.peopleUnder(managerId));
  }

  private async event(
    trackerId: string,
    kind: string,
    extra: { staffId?: string | null; byStaffId?: string | null; note?: string | null; toStage?: string | null; at?: Date } = {},
  ) {
    await this.prisma.signupTrackerEvent.create({
      data: {
        trackerId,
        kind,
        staffId: extra.staffId ?? null,
        byStaffId: extra.byStaffId ?? null,
        note: extra.note ?? null,
        toStage: extra.toStage ?? null,
        ...(extra.at ? { createdAt: extra.at } : {}),
      },
    });
  }
}
