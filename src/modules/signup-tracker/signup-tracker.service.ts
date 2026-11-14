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
import { SignupTrackerClock } from './signup-tracker-clock';
import { SignupFactsService } from './signup-facts.service';
import { SignupSettings, signupSettingsFrom } from './signup-settings';
import { DAY_MS, WorkCalendar, callWindow, istDateKey, istDayStartMs, nextCallableAt } from './signup-timing';
import { assistedBy, planNext, reminderCount } from './signup-plan';
import { AssignmentCandidate, pickAgent } from './signup-assignment';
import { StageResult, stageIndex } from './signup-stage';
import { ownerAccountIds } from './signup-owner-accounts';
import { SIGNUP_REMINDER_SENDER, SignupReminderSender } from './signup-reminder.port';

/** Outcomes that mean "closed without finishing": they go on the monthly re-engagement list. */
export const REENGAGE_OUTCOMES = ['no_response', 'gave_up'];
const SUBJECT_TYPES = ['job_seeker', 'business', 'referral'];

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
  ) {}

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

  /** One pass: every sign-up that is due, then "Call me back" requests. */
  async sweep(now: Date = this.clock.now()) {
    const ctx = await this.context(now);
    const due = await this.prisma.signupTracker.findMany({
      where: {
        OR: [
          { outcome: 'open', OR: [{ nextActionAt: null }, { nextActionAt: { lte: now } }] },
          { outcome: { in: REENGAGE_OUTCOMES }, nextActionAt: { lte: now } },
        ],
      },
      orderBy: [{ nextActionAt: { sort: 'asc', nulls: 'first' } }],
      take: 500,
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
      }
    }
    const callbacks = await this.takeCallbackRequests(ctx);
    return { processed, failed, callbacks };
  }

  /** Brings one sign-up up to date and does whatever is due. */
  async process(trackerId: string, ctx: TrackerRunContext): Promise<SignupTracker | null> {
    let tracker = await this.prisma.signupTracker.findUnique({ where: { id: trackerId } });
    if (!tracker) return null;
    const account = tracker.accountId
      ? await this.prisma.customerAccount.findUnique({ where: { id: tracker.accountId }, select: { status: true, contactMeConsent: true } })
      : null;
    const result = await this.facts.stageOf(tracker.profileKind, tracker);
    tracker = await this.applyStage(tracker, result, ctx);

    if (tracker.stage === 'done') return this.finish(tracker, ctx);

    if (tracker.profileKind === 'business' && tracker.subjectId) await this.suggestVisit(tracker);
    tracker = await this.closeMissedTasks(tracker, ctx);

    const subject = await this.subjectInfo(tracker);
    const declined = await this.declinedCalls(tracker);
    if (declined && tracker.outcome === 'open') {
      return this.close(tracker, 'gave_up', ctx, 'Said not interested on a call');
    }
    if (REENGAGE_OUTCOMES.includes(tracker.outcome)) return this.reengage(tracker, result, ctx);

    const callable =
      Boolean(tracker.subjectId) &&
      (tracker.contactConsent || Boolean(account?.contactMeConsent)) &&
      (!account || account.status === 'active');
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
          remindersSent: tracker.remindersSent,
          callTries: tracker.callTries,
          callable,
          lastCallDueAt: lastTask?.dueAt ?? null,
          personWindow: window,
        },
        ctx.settings,
        ctx.calendar,
      );
      if (plan.at.getTime() > ctx.now.getTime() || plan.action === 'wait') {
        return this.prisma.signupTracker.update({ where: { id: tracker.id }, data: { nextActionAt: plan.at } });
      }
      if (plan.action === 'reminder') {
        tracker = await this.sendReminder(tracker, result, tracker.remindersSent + 1 === 1 ? 1 : 2);
      } else if (plan.action === 'call_task') {
        const created = await this.createCallTask(tracker, subject, nextCallableAt(ctx.now, ctx.calendar, window), ctx);
        if (!created) {
          // Nobody on shift: try again in 30 minutes; the Team Lead sees it as unassigned meanwhile.
          return this.prisma.signupTracker.update({
            where: { id: tracker.id },
            data: { nextActionAt: new Date(ctx.now.getTime() + 30 * 60_000) },
          });
        }
        tracker = created;
      } else {
        const reached = await this.connectedCallCount(tracker);
        return this.close(tracker, reached > 0 ? 'gave_up' : 'no_response', ctx, `${tracker.callTries} call tries`);
      }
    }
    return tracker;
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

  /** Finished: who gets the credit, and the open tasks are closed. */
  private async finish(tracker: SignupTracker, ctx: TrackerRunContext): Promise<SignupTracker> {
    if (tracker.outcome === 'self' || tracker.outcome === 'assisted') return tracker;
    const finishedAt = ctx.now;
    const credit = await this.creditFor(tracker, finishedAt);
    const outcome = credit ? 'assisted' : 'self';
    const updated = await this.prisma.signupTracker.update({
      where: { id: tracker.id },
      data: { outcome, finishedAt, nextActionAt: null },
    });
    await this.prisma.callTask.updateMany({
      where: { signupTrackerId: tracker.id, status: 'open' },
      data: { status: 'cancelled', doneAt: finishedAt },
    });
    await this.event(tracker.id, 'closed', { note: outcome, staffId: credit });
    return updated;
  }

  /** The assigned agent, only with a connected call or a GPS visit on record (question 13). */
  async creditFor(tracker: SignupTracker, finishedAt: Date): Promise<string | null> {
    if (!tracker.assignedStaffId || !tracker.assignedAt || !tracker.subjectType || !tracker.subjectId) return null;
    const window = { gte: tracker.assignedAt, lte: finishedAt };
    const [calls, visits] = await Promise.all([
      this.prisma.callRecord.findMany({
        where: {
          staffId: tracker.assignedStaffId,
          subjectType: tracker.subjectType,
          subjectId: tracker.subjectId,
          answered: true,
          OR: [{ answeredAt: window }, { answeredAt: null, startedAt: window }],
        },
        select: { staffId: true, answeredAt: true, startedAt: true, createdAt: true },
      }),
      tracker.subjectType === 'business'
        ? this.prisma.businessVisit.findMany({
            where: { staffId: tracker.assignedStaffId, businessId: tracker.subjectId, visitedAt: window },
            select: { staffId: true, visitedAt: true },
          })
        : Promise.resolve([]),
    ]);
    return assistedBy({
      assignedStaffId: tracker.assignedStaffId,
      assignedAt: tracker.assignedAt,
      finishedAt,
      connectedCalls: calls.map((c) => ({ staffId: c.staffId, at: c.answeredAt ?? c.startedAt ?? c.createdAt })),
      gpsVisits: visits.map((v) => ({ staffId: v.staffId, at: v.visitedAt })),
    });
  }

  private async close(tracker: SignupTracker, outcome: 'no_response' | 'gave_up', ctx: TrackerRunContext, note: string) {
    const updated = await this.prisma.signupTracker.update({
      where: { id: tracker.id },
      data: { outcome, nextActionAt: new Date(ctx.now.getTime() + ctx.settings.reengageDays * DAY_MS) },
    });
    await this.prisma.callTask.updateMany({
      where: { signupTrackerId: tracker.id, status: 'open' },
      data: { status: 'cancelled', doneAt: ctx.now },
    });
    await this.event(tracker.id, 'closed', { note: `${outcome}: ${note}` });
    // A business lead that never answers: the Team Lead is told, as for follow-ups after 3 tries.
    if (tracker.profileKind === 'business' && tracker.subjectId && outcome === 'no_response') {
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

  /** The monthly re-engagement list: one reminder every few weeks until they finish. */
  private async reengage(tracker: SignupTracker, result: StageResult, ctx: TrackerRunContext) {
    await this.send(tracker, result, 'reengage', `reengage:${tracker.id}:${istDateKey(ctx.now.getTime()).slice(0, 7)}`);
    await this.event(tracker.id, 'reminder', { note: 'reengage' });
    return this.prisma.signupTracker.update({
      where: { id: tracker.id },
      data: { nextActionAt: new Date(ctx.now.getTime() + ctx.settings.reengageDays * DAY_MS) },
    });
  }

  // ------------------------------------------------------------ reminders

  private async sendReminder(tracker: SignupTracker, result: StageResult, n: 1 | 2): Promise<SignupTracker> {
    if (tracker.remindersSent >= reminderCount(tracker.profileKind)) return tracker;
    await this.send(tracker, result, n, `signup:${tracker.id}:${tracker.stage}:${n}`);
    await this.event(tracker.id, 'reminder', { note: String(n) });
    return this.prisma.signupTracker.update({ where: { id: tracker.id }, data: { remindersSent: { increment: 1 } } });
  }

  private async send(tracker: SignupTracker, result: StageResult, reminder: 1 | 2 | 'reengage', dedupeKey: string) {
    if (!this.reminders || !tracker.accountId) return;
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
    } catch (err) {
      // A reminder is a nicety; the timing carries on to the call task.
      this.logger.warn(`Reminder for sign-up ${tracker.id} failed: ${(err as Error).message}`);
    }
  }

  // ------------------------------------------------------------ calls

  private async subjectInfo(tracker: SignupTracker): Promise<SubjectInfo> {
    const info: SubjectInfo = { window: { start: null, end: null }, existingAgentIds: [] };
    if (tracker.assignedStaffId) info.existingAgentIds.push(tracker.assignedStaffId);
    if (!tracker.subjectType || !tracker.subjectId) return info;
    if (tracker.subjectType === 'job_seeker') {
      const s = await this.prisma.jobSeeker.findUnique({
        where: { id: tracker.subjectId },
        select: { registeredByStaffId: true, preferredCallWindowStart: true, preferredCallWindowEnd: true },
      });
      if (s) {
        info.window = { start: s.preferredCallWindowStart, end: s.preferredCallWindowEnd };
        if (s.registeredByStaffId) info.existingAgentIds.push(s.registeredByStaffId);
      }
    } else if (tracker.subjectType === 'business') {
      const b = await this.prisma.business.findUnique({ where: { id: tracker.subjectId }, select: { leadCreatedByStaffId: true } });
      if (b?.leadCreatedByStaffId) info.existingAgentIds.push(b.leadCreatedByStaffId);
    } else if (tracker.subjectType === 'referral') {
      const r = await this.prisma.referral.findUnique({ where: { id: tracker.subjectId }, select: { registeredByStaffId: true } });
      if (r?.registeredByStaffId) info.existingAgentIds.push(r.registeredByStaffId);
    }
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

  private async connectedCallCount(tracker: SignupTracker): Promise<number> {
    if (!tracker.subjectType || !tracker.subjectId) return 0;
    return this.prisma.callRecord.count({
      where: { subjectType: tracker.subjectType, subjectId: tracker.subjectId, answered: true, createdAt: { gte: tracker.createdAt } },
    });
  }

  /** A sign-up help task due on an earlier day that is still open was a try that did not reach him. */
  private async closeMissedTasks(tracker: SignupTracker, ctx: TrackerRunContext): Promise<SignupTracker> {
    const todayStart = new Date(istDayStartMs(ctx.now.getTime()));
    await this.prisma.callTask.updateMany({
      where: { signupTrackerId: tracker.id, kind: CALL_TASK_KIND_SIGNUP_HELP, status: 'open', dueAt: { lt: todayStart } },
      data: { status: 'cancelled', doneAt: ctx.now },
    });
    return tracker;
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
      // Already on someone's list (e.g. moved there by the Team Lead): that is today's try.
      return this.prisma.signupTracker.update({ where: { id: tracker.id }, data: { callTries: { increment: 1 } } });
    }
    const pick = pickAgent({
      candidates: await this.candidates(ctx.now),
      existingAgentIds: subject.existingAgentIds,
      language: tracker.language,
    });
    if (!pick) {
      await this.event(tracker.id, 'unassigned', { note: 'No call agent on shift' });
      return null;
    }
    const sameAgent = tracker.assignedStaffId === pick.staffId;
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
    const updated = await this.prisma.signupTracker.update({
      where: { id: tracker.id },
      data: {
        callTries: { increment: 1 },
        ...(sameAgent ? {} : { assignedStaffId: pick.staffId, assignedAt: ctx.now, assignmentReason: pick.reason }),
      },
    });
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
    if (!profile) return false;
    const subjectType = profile.kind;
    const subjectId = profile.jobSeekerId ?? profile.businessId ?? profile.referralId;
    if (!subjectId || !SUBJECT_TYPES.includes(subjectType)) return false;
    const tracker = await this.prisma.signupTracker.findFirst({
      where: { accountId: request.accountId, subjectType, subjectId, outcome: 'open' },
    });
    const info = tracker ? await this.subjectInfo(tracker) : { window: { start: request.preferredFrom, end: request.preferredTo }, existingAgentIds: [] };
    const window = callWindow(ctx.settings, { start: request.preferredFrom ?? info.window.start, end: request.preferredTo ?? info.window.end });
    const dueAt = nextCallableAt(ctx.now, ctx.calendar, window);
    const pick = pickAgent({ candidates: await this.candidates(ctx.now), existingAgentIds: info.existingAgentIds, language: tracker?.language ?? null });
    if (!pick) return false;
    const kind = tracker && request.topic === 'signup' ? CALL_TASK_KIND_SIGNUP_HELP : 'callback';
    const task = await this.prisma.callTask.create({
      data: { staffId: pick.staffId, subjectType, subjectId, kind, dueAt, signupTrackerId: kind === CALL_TASK_KIND_SIGNUP_HELP ? tracker!.id : null },
    });
    await this.prisma.customerCallbackRequest.update({
      where: { id: request.id },
      data: { status: 'assigned', callTaskId: task.id, assignedStaffId: pick.staffId },
    });
    if (tracker && kind === CALL_TASK_KIND_SIGNUP_HELP) {
      await this.prisma.signupTracker.update({
        where: { id: tracker.id },
        data: tracker.assignedStaffId === pick.staffId ? {} : { assignedStaffId: pick.staffId, assignedAt: ctx.now, assignmentReason: pick.reason },
      });
      await this.event(tracker.id, 'call_task', { staffId: pick.staffId, note: 'Call me back' });
    }
    return true;
  }

  // ------------------------------------------------------------ Team Lead / Manager / CEO

  /**
   * Move a sign-up (and its open call task) to another call agent. A Team Lead
   * only between their own team's agents (or an unassigned one into their
   * team); a Manager only to people under them; the CEO anyone.
   */
  async reassign(actor: { id: string; role: string }, trackerId: string, staffId: string, reason?: string | null) {
    if (!staffId) throw new BadRequestException('Pick the agent to move it to');
    const tracker = await this.prisma.signupTracker.findUnique({ where: { id: trackerId } });
    if (!tracker) throw new NotFoundException('Sign-up not found');
    if (tracker.outcome !== 'open') throw new BadRequestException('This sign-up is closed');
    const target = await this.prisma.staff.findUnique({ where: { id: staffId }, select: { id: true, role: true, status: true, teamLeadId: true, code: true } });
    if (!target || target.role !== 'call_agent' || target.status !== 'active') {
      throw new BadRequestException('Sign-up help goes to an active call agent');
    }
    if (actor.role === 'team_lead') {
      if (target.teamLeadId !== actor.id) throw new ForbiddenException('Team Leads move sign-ups only to their own team');
      if (tracker.assignedStaffId) {
        const current = await this.prisma.staff.findUnique({ where: { id: tracker.assignedStaffId }, select: { teamLeadId: true } });
        if (current?.teamLeadId !== actor.id) throw new ForbiddenException('This sign-up belongs to another team');
      }
    } else if (actor.role === 'manager') {
      const under = await this.peopleUnder(actor.id);
      if (!under.has(target.id)) throw new ForbiddenException('Managers move sign-ups only inside their own teams');
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

  async peopleUnder(managerId: string): Promise<Set<string>> {
    return new Set(await this.scope.peopleUnder(managerId));
  }

  private async event(trackerId: string, kind: string, extra: { staffId?: string | null; byStaffId?: string | null; note?: string | null } = {}) {
    await this.prisma.signupTrackerEvent.create({
      data: {
        trackerId,
        kind,
        staffId: extra.staffId ?? null,
        byStaffId: extra.byStaffId ?? null,
        note: extra.note ?? null,
      },
    });
  }
}
