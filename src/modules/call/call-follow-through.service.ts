import { Injectable, Logger } from '@nestjs/common';
import { CallRecord, Prisma } from '@prisma/client';
import { PrismaService } from '../../common/prisma/prisma.service';
import { LiveEventsService } from '../../common/live/live-events.service';
import { PricingService } from '../pricing/pricing.service';
import { MessagingService } from '../message/messaging.service';
import { ReviewFlagService } from '../review-flag/review-flag.service';
import { FINAL_CALL_STATUSES } from './call-status';
import { nextDayRetryAt, nextRetryAt } from './call-retry-time';

/** Purposes whose call belongs to a follow-up task (retried the next day, Team Lead told after 3). */
const FOLLOW_UP_PURPOSES = ['follow_up', 'check_in', 'refund_check', 'exit_call'];
export const FOLLOW_UP_UNANSWERED_LIMIT = 3;
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
    if (final && !call.answered && call.direction === 'outbound' && call.staffId) {
      try {
        await this.onNoAnswer(call);
      } catch (err) {
        // The call status itself is already saved; never fail the webhook over a follow-up.
        this.logger.error(`No-answer follow-through failed for call ${call.id}: ${(err as Error).message}`);
      }
    }
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
    if (call.subjectType === 'job_seeker') {
      await this.sendWhatsAppOncePerDay(call.subjectId!, missedAt);
    }
    if (call.purpose && FOLLOW_UP_PURPOSES.includes(call.purpose) && call.relatedType === 'follow_up_task' && call.relatedId) {
      await this.rescheduleFollowUp(call, missedAt);
      return;
    }
    await this.scheduleRetry(call, missedAt);
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
    await this.messaging.send({
      channel: 'whatsapp',
      template: NO_ANSWER_WHATSAPP_TEMPLATE,
      subjectType: 'job_seeker',
      subjectId: jobSeekerId,
      variables: { candidateName: seeker.name, trade },
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

  private async scheduleRetry(call: CallRecord, missedAt: Date): Promise<void> {
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
    await this.prisma.followUpTask.update({ where: { id: task.id }, data: { dueAt } });
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
