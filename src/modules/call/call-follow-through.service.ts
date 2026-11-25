import { Injectable, Logger } from '@nestjs/common';
import { CallRecord, Prisma } from '@prisma/client';
import { PrismaService } from '../../common/prisma/prisma.service';
import { LiveEventsService } from '../../common/live/live-events.service';
import { PricingService } from '../pricing/pricing.service';
import { MessagingService } from '../message/messaging.service';
import { ReviewFlagService } from '../review-flag/review-flag.service';
import { FINAL_CALL_STATUSES } from './call-status';
import { nextDayRetryAt, nextRetryAt } from './call-retry-time';
import { CALL_TASK_KIND_SIGNUP_HELP } from '../../common/customer-auth/customer-app.constants';
import { NO_ANSWER_OUTCOMES } from './call-outcomes';
import { messagesBlocked } from './contact-block';

/** Purposes whose call belongs to a follow-up task (retried the next day, Team Lead told after 3). */
const FOLLOW_UP_PURPOSES = ['follow_up', 'check_in', 'refund_check', 'exit_call'];
export const FOLLOW_UP_UNANSWERED_LIMIT = 3;
/**
 * 21 Nov fixes: every kind of retry stops after this many unanswered tries in a
 * row (callbacks, missed calls called back, automatic retries) and the Team
 * Lead is told — the follow-up pattern, for all.
 */
export const RETRY_UNANSWERED_LIMIT = 3;
export const NO_ANSWER_WHATSAPP_TEMPLATE = 'call_attempt_notice';

const IST_OFFSET_MS = (5 * 60 + 30) * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

function istDayStart(at: Date): Date {
  const ist = at.getTime() + IST_OFFSET_MS;
  return new Date(Math.floor(ist / DAY_MS) * DAY_MS - IST_OFFSET_MS);
}

/**
 * What the system does after the calling company reports on a call, so the
 * agent never types it (Master Guide, "What happens when things don't go to
 * plan"):
 * - tells the agent's open screens straight away (live channel);
 * - an answered call closes the person's open callback/retry tasks;
 * - an unanswered call: a WhatsApp goes out to a job seeker (once a day), and
 *   a retry is put on the agent's list; a follow-up call is moved to the next
 *   day instead, and after 3 unanswered tries the Team Lead is told.
 *
 * Runs only when a webhook changed the call, so a repeated webhook is a no-op;
 * the retry is also unique per call.
 */
@Injectable()
export class CallFollowThroughService {
  private readonly logger = new Logger(CallFollowThroughService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly pricing: PricingService,
    private readonly messaging: MessagingService,
    private readonly reviewFlags: ReviewFlagService,
    private readonly live: LiveEventsService,
  ) {}

  async onStatusChanged(before: { answered: boolean } | null, call: CallRecord): Promise<void> {
    const final = (FINAL_CALL_STATUSES as readonly string[]).includes(call.providerStatus);
    if (call.staffId) {
      this.live.publish(call.staffId, 'call_status', {
        callRecordId: call.id,
        status: call.providerStatus,
        answered: call.answered,
        final,
      });
    }
    if (!call.subjectType || !call.subjectId) return;
    if (call.answered && !before?.answered) {
      await this.closeOpenTasks(call);
    }
    if (final && call.direction === 'outbound' && call.staffId) {
      try {
        await this.closeCalledBackMissedCalls(call);
      } catch (err) {
        this.logger.error(`Missed-call close failed for call ${call.id}: ${(err as Error).message}`);
      }
    }
    if (final && !call.answered && call.direction === 'outbound' && call.staffId) {
      try {
        await this.onNoAnswer(call);
      } catch (err) {
        // The call status itself is already saved; never fail the webhook over a follow-up.
        this.logger.error(`No-answer follow-through failed for call ${call.id}: ${(err as Error).message}`);
      }
    }
  }

  /**
   * The agent said "busy" or "switched off" on a call the phone system saw as
   * answered (a network message picked up): the retry rules apply as for no
   * answer. Never a contact attempt or a hit: those come only from the phone
   * system.
   */
  async onAgentNoAnswer(call: CallRecord): Promise<void> {
    if (!call.subjectType || !call.subjectId || !call.staffId || call.direction !== 'outbound') return;
    await this.onNoAnswer(call);
  }

  /**
   * The agent called the person back (answered or not): his open missed calls
   * are done — the first try is recorded (target: within 30 minutes) and an
   * unanswered one carries on as an ordinary retry, with the 3-try limit.
   */
  private async closeCalledBackMissedCalls(call: CallRecord): Promise<void> {
    const phone = await this.subjectPhone(call.subjectType!, call.subjectId!);
    const digits = phone ? phone.replace(/\D/g, '').slice(-10) : '';
    const or: Prisma.CallbackTaskWhereInput[] = [];
    if (call.subjectType === 'job_seeker') or.push({ jobSeekerId: call.subjectId! });
    if (digits.length === 10) or.push({ phone: { endsWith: digits } });
    if (!or.length) return;
    const at = call.startedAt ?? call.createdAt;
    const ended = call.endedAt ?? at;
    await this.prisma.callbackTask.updateMany({
      where: { status: { in: ['pending', 'assigned'] }, createdAt: { lte: at }, firstAttemptAt: null, OR: or },
      data: { firstAttemptAt: at },
    });
    await this.prisma.callbackTask.updateMany({
      where: { status: { in: ['pending', 'assigned'] }, createdAt: { lte: at }, OR: or },
      data: { status: 'completed', completedAt: ended },
    });
  }

  private async subjectPhone(subjectType: string, subjectId: string): Promise<string | null> {
    if (subjectType === 'job_seeker') return (await this.prisma.jobSeeker.findUnique({ where: { id: subjectId }, select: { phone: true } }))?.phone ?? null;
    if (subjectType === 'business') return (await this.prisma.business.findUnique({ where: { id: subjectId }, select: { phone: true } }))?.phone ?? null;
    if (subjectType === 'referral') return (await this.prisma.referral.findUnique({ where: { id: subjectId }, select: { phone: true } }))?.phone ?? null;
    return null;
  }

  /** The person was reached: every open callback or retry for them is done. */
  private async closeOpenTasks(call: CallRecord): Promise<void> {
    await this.prisma.callTask.updateMany({
      where: {
        subjectType: call.subjectType!,
        subjectId: call.subjectId!,
        status: 'open',
        OR: [{ sourceCallRecordId: null }, { sourceCallRecordId: { not: call.id } }],
      },
      data: { status: 'done', doneAt: call.answeredAt ?? new Date(), doneCallRecordId: call.id },
    });
  }

  private async onNoAnswer(call: CallRecord): Promise<void> {
    const missedAt = call.endedAt ?? call.startedAt ?? call.createdAt;
    // An app sign-up help call has its own tries (3 over 3 working days, signup-tracker):
    // no automatic retry and no no-answer WhatsApp on top of them.
    if (await this.isSignupHelpCall(call)) return;
    // Wrong number or do not call: no retry and no message, ever (until lifted).
    if (await messagesBlocked(this.prisma, { subjectType: call.subjectType!, subjectId: call.subjectId! })) return;
    if (call.subjectType === 'job_seeker') {
      await this.sendWhatsAppOncePerDay(call.subjectId!, missedAt);
    }
    if (call.purpose && FOLLOW_UP_PURPOSES.includes(call.purpose) && call.relatedType === 'follow_up_task' && call.relatedId) {
      await this.rescheduleFollowUp(call, missedAt);
      return;
    }
    await this.scheduleRetry(call, missedAt);
  }

  private async isSignupHelpCall(call: CallRecord): Promise<boolean> {
    const task = await this.prisma.callTask.findFirst({
      where: {
        staffId: call.staffId!,
        subjectType: call.subjectType!,
        subjectId: call.subjectId!,
        kind: CALL_TASK_KIND_SIGNUP_HELP,
        status: 'open',
      },
      select: { id: true },
    });
    return Boolean(task);
  }

  private async sendWhatsAppOncePerDay(jobSeekerId: string, missedAt: Date): Promise<void> {
    const sentToday = await this.prisma.messageLog.findFirst({
      where: {
        subjectType: 'job_seeker',
        subjectId: jobSeekerId,
        template: NO_ANSWER_WHATSAPP_TEMPLATE,
        createdAt: { gte: istDayStart(missedAt) },
        status: { not: 'failed' },
      },
      select: { id: true },
    });
    if (sentToday) return;
    const seeker = await this.prisma.jobSeeker.findUnique({
      where: { id: jobSeekerId },
      select: { name: true, trades: { select: { trade: true, isPrimary: true } } },
    });
    if (!seeker) return;
    const trade = seeker.trades.find((t) => t.isPrimary)?.trade ?? seeker.trades[0]?.trade ?? '';
    // An exception to WhatsApp first (rev 211): "we tried to call you" always goes on WhatsApp and SMS.
    await this.messaging.sendBoth({
      template: NO_ANSWER_WHATSAPP_TEMPLATE,
      subjectType: 'job_seeker',
      subjectId: jobSeekerId,
      // Meta refuses an empty parameter.
      variables: { candidateName: seeker.name, trade: trade || 'suitable' },
    });
  }

  private async personWindow(call: CallRecord): Promise<{ start: string | null; end: string | null }> {
    if (call.subjectType !== 'job_seeker') return { start: null, end: null };
    const seeker = await this.prisma.jobSeeker.findUnique({
      where: { id: call.subjectId! },
      select: { preferredCallWindowStart: true, preferredCallWindowEnd: true },
    });
    return { start: seeker?.preferredCallWindowStart ?? null, end: seeker?.preferredCallWindowEnd ?? null };
  }

  /**
   * Unanswered tries in a row for this person (any agent), newest first, up to
   * the last time he was reached. "Busy" and "switched off" count as no answer.
   */
  async unansweredInARow(subjectType: string, subjectId: string): Promise<number> {
    const calls = await this.prisma.callRecord.findMany({
      where: { subjectType, subjectId, direction: 'outbound', providerStatus: { in: [...FINAL_CALL_STATUSES] } },
      orderBy: { createdAt: 'desc' },
      take: RETRY_UNANSWERED_LIMIT + 5,
      select: { answered: true, agentOutcome: true },
    });
    let count = 0;
    for (const c of calls) {
      const reached = c.answered && !(c.agentOutcome && NO_ANSWER_OUTCOMES.includes(c.agentOutcome));
      if (reached) break;
      count += 1;
    }
    return count;
  }

  /** After 3 unanswered tries: no more retries, open ones cancelled, and the Team Lead told (once). */
  private async stopRetries(call: CallRecord, missedAt: Date, tries: number): Promise<void> {
    await this.prisma.callTask.updateMany({
      where: { subjectType: call.subjectType!, subjectId: call.subjectId!, kind: 'retry', status: 'open' },
      data: { status: 'cancelled', doneAt: missedAt },
    });
    const open = await this.prisma.reviewFlag.findFirst({
      where: { kind: 'calls_unanswered', subjectType: call.subjectType!, subjectId: call.subjectId!, status: 'open' },
      select: { id: true },
    });
    if (open) return;
    await this.reviewFlags.raise({
      kind: 'calls_unanswered',
      subjectType: call.subjectType!,
      subjectId: call.subjectId!,
      raisedForStaffId: call.staffId,
      details: { unansweredCalls: tries, lastCallRecordId: call.id, purpose: call.purpose },
    });
  }

  private async scheduleRetry(call: CallRecord, missedAt: Date): Promise<void> {
    const tries = await this.unansweredInARow(call.subjectType!, call.subjectId!);
    if (tries >= RETRY_UNANSWERED_LIMIT) {
      await this.stopRetries(call, missedAt, tries);
      return;
    }
    const policy = await this.pricing.current();
    const window = await this.personWindow(call);
    const dueAt = nextRetryAt(missedAt, {
      callingHoursStart: policy.callingHoursStart,
      callingHoursEnd: policy.callingHoursEnd,
      personWindowStart: window.start,
      personWindowEnd: window.end,
    });
    try {
      await this.prisma.callTask.create({
        data: {
          staffId: call.staffId!,
          subjectType: call.subjectType!,
          subjectId: call.subjectId!,
          kind: 'retry',
          dueAt,
          sourceCallRecordId: call.id,
        },
      });
    } catch (err) {
      if ((err as Prisma.PrismaClientKnownRequestError)?.code !== 'P2002') throw err;
    }
    // One open retry per person and agent: older ones are replaced by this one.
    await this.prisma.callTask.updateMany({
      where: {
        staffId: call.staffId!,
        subjectType: call.subjectType!,
        subjectId: call.subjectId!,
        kind: 'retry',
        status: 'open',
        sourceCallRecordId: { not: call.id },
      },
      data: { status: 'cancelled', doneAt: missedAt },
    });
  }

  /** Follow-up calls that go unanswered are retried the next day; after 3 tries the Team Lead is told. */
  private async rescheduleFollowUp(call: CallRecord, missedAt: Date): Promise<void> {
    const task = await this.prisma.followUpTask.findUnique({ where: { id: call.relatedId! } });
    if (!task || task.status !== 'pending') return;
    const unanswered = await this.prisma.callRecord.count({
      where: {
        relatedType: 'follow_up_task',
        relatedId: task.id,
        answered: false,
        providerStatus: { in: [...FINAL_CALL_STATUSES] },
      },
    });
    const policy = await this.pricing.current();
    const window = await this.personWindow(call);
    const dueAt = nextDayRetryAt(missedAt, {
      callingHoursStart: policy.callingHoursStart,
      callingHoursEnd: policy.callingHoursEnd,
      personWindowStart: window.start,
      personWindowEnd: window.end,
    });
    // 21 Nov fixes: retries stop after 3 tries — the follow-up is closed as missed
    // (as the follow-up sweep does after the grace days) and the Team Lead is told.
    if (unanswered >= FOLLOW_UP_UNANSWERED_LIMIT) {
      await this.prisma.followUpTask.updateMany({ where: { id: task.id, status: 'pending' }, data: { status: 'missed' } });
    } else {
      await this.prisma.followUpTask.update({ where: { id: task.id }, data: { dueAt } });
    }
    if (unanswered === FOLLOW_UP_UNANSWERED_LIMIT) {
      await this.reviewFlags.raise({
        kind: 'follow_up_unanswered',
        subjectType: task.subjectType,
        subjectId: task.subjectId,
        raisedForStaffId: call.staffId,
        details: { followUpTaskId: task.id, followUpTaskCode: task.code, kind: task.kind, unansweredCalls: unanswered },
      });
    }
  }
}
