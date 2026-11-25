import { Injectable, Logger, OnModuleInit, Optional } from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.service';
import { AuditService } from '../../common/audit/audit.service';
import { formatINR, refundGuaranteeDeadline } from '../../common/money/money';
import { publicPageLink } from '../../common/public-pages';
import { ConsentLinkService } from '../consent/consent-link.service';
import { ConsentService } from '../consent/consent.service';
import { MessagingService } from '../message/messaging.service';
import { NotificationService } from '../notification/notification.service';
import { NotificationSourcesService } from '../notification/notification-sources.service';
import { inQuietHours } from '../message/quiet-hours';
import { notificationLink } from '../notification/notification.constants';
import { PricingService } from '../pricing/pricing.service';
import { OtherIdApproved, OtherIdDecisionHooks, OtherIdFollowUp } from '../aadhaar-qr/other-id-decision-hooks';
import { startGuaranteeIfReady } from './guarantee-start';
import {
  JobSeekerFlowEvents,
  JobSeekerIdFailedEvent,
  JobSeekerPaidEvent,
  JobSeekerSelfieSavedEvent,
} from './job-seeker-flow-events';
import { PAID_WAITING_ID } from './job-seeker.status';
import { calculateAge } from './job-seeker.validator';

/** The new automatic messages of the job seeker order (rev 211); texts in whatsapp-templates.ts. */
export const FLOW_TEMPLATES = {
  detailsSaved: 'details_saved_pay_next',
  paymentReceived: 'payment_received_id_left',
  guaranteeStarted: 'guarantee_started',
  idFailed: 'id_check_failed_refund',
  reminder: 'id_check_reminder',
} as const;

/** What went wrong, in his words (id_check_failed_refund). */
export const ID_FAILED_REASON_TEXT: Record<JobSeekerIdFailedEvent['result'], string> = {
  under_18: 'the ID shows you are under 18, and you must be 18 or older to register',
  name_mismatch: 'the name on the ID does not match the name you registered with',
  rejected: 'the photo of your ID card could not be accepted',
};

/** "Paid but no ID check": one reminder a day, at most this many, then nothing more by itself (rev 211). */
export const ID_CHECK_REMINDERS_MAX = 3;
/** At least this long after the payment (or the last reminder) before the next one: one a day. */
export const ID_CHECK_REMINDER_GAP_MS = 20 * 60 * 60 * 1000;
/** Tries (sent or failed) per payment, so a number WhatsApp and SMS both refuse is not tried forever. */
const ID_CHECK_REMINDER_TRIES_MAX = 6;

/** The status history reason kept when an approved other ID starts the 30 days (codes only). */
export const GUARANTEE_AFTER_OTHER_ID_REASON = 'guarantee_started_after_other_id';

function firstName(name: string | null | undefined): string {
  return (name ?? '').trim().split(/\s+/)[0] || 'there';
}

/** "12 Dec 2026", in IST. */
export function guaranteeEndLabel(date: Date): string {
  return new Intl.DateTimeFormat('en-IN', { timeZone: 'Asia/Kolkata', day: 'numeric', month: 'short', year: 'numeric' }).format(date);
}

/**
 * The job seeker order Consent → Selfie → Payment → ID check (Master Guide rev 211, 25 Nov), what
 * follows each step:
 *
 * - Consent and selfie done → "Your details are saved, next pay ₹499" with his link.
 * - ₹499 received with no passed ID → "Payment received, only your ID check is left" with his link;
 *   with his ID already passed → "Your 30 days have started".
 * - The ID check passes (Aadhaar QR, or another ID approved by a Team Lead, Manager or the CEO) for a
 *   paid job seeker → he becomes active, the 30 days start, "Your 30 days have started" (end date).
 *   This replaces the 22 Nov automatic payment link after another ID was approved (the approval itself
 *   is unchanged).
 * - A failed check (under 18, name mismatch, another ID turned down) of a paid job seeker → what went
 *   wrong and "contact us for a full refund" (refunds are only on request: refund-id-not-verified.ts).
 *
 * Every message goes WhatsApp first with SMS as backup (sendPreferWhatsApp), never to a number marked
 * wrong number / do not call, and is never a contact attempt. A follow-up that fails is logged and never
 * undoes the step.
 */
@Injectable()
export class JobSeekerFlowService implements OnModuleInit {
  private readonly logger = new Logger(JobSeekerFlowService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly messaging: MessagingService,
    private readonly pricing: PricingService,
    @Optional() private readonly events?: JobSeekerFlowEvents,
    @Optional() private readonly hooks?: OtherIdDecisionHooks,
    @Optional() private readonly consentLinks?: ConsentLinkService,
    @Optional() private readonly consents?: ConsentService,
    @Optional() private readonly notifications?: NotificationService,
    @Optional() private readonly audit?: AuditService,
    @Optional() private readonly sources?: NotificationSourcesService,
  ) {}

  onModuleInit(): void {
    // A4: the reminders ride the existing 5-minute notification sweep (no new schedule, no new Redis connection).
    this.sources?.registerRequestSource('id check reminders', (now) => this.sendIdCheckReminders(now));
    this.hooks?.onApproved('job_seeker', (event) => this.afterOtherIdApproved(event));
    this.events?.onIdPassed((event) => this.afterIdPassed(event.jobSeekerId, event.actor, event.now).then(() => undefined));
    this.events?.onPaid((event) => this.afterPaid(event));
    this.events?.onIdFailed((event) => this.afterIdFailed(event));
    this.events?.onSelfieSaved((event) => this.afterSelfie(event));
  }

  /** A fresh registration link that resumes at his first unfinished step (the earlier one keeps working). */
  private async continueLink(jobSeekerId: string, issuedTo: string): Promise<string | null> {
    if (!this.consentLinks) return null;
    const issued = await this.consentLinks.createLink(jobSeekerId, { sms: false, revokeOthers: false, issuedTo });
    return publicPageLink('registration', issued.token);
  }

  /** Once per job seeker and template for this payment (or registration): a repeat event sends nothing. */
  private async alreadySent(jobSeekerId: string, template: string, relatedId: string | null): Promise<boolean> {
    const row = await this.prisma.messageLog.findFirst({
      where: { subjectType: 'job_seeker', subjectId: jobSeekerId, template, status: { notIn: ['failed', 'blocked'] }, ...(relatedId ? { relatedId } : {}) },
      select: { id: true },
    });
    return Boolean(row);
  }

  // ------------------------------------------------------------------ consent + selfie

  async afterSelfie(event: JobSeekerSelfieSavedEvent): Promise<void> {
    const seeker = await this.prisma.jobSeeker.findUnique({
      where: { id: event.jobSeekerId },
      select: { id: true, code: true, name: true, status: true, paymentReceivedAt: true, dateOfBirth: true, anonymisedAt: true },
    });
    if (!seeker || seeker.anonymisedAt || seeker.paymentReceivedAt || seeker.status === 'banned') return;
    const policy = await this.pricing.current();
    // Under 18 by his typed date of birth stops at consent, before payment: never "pay next".
    if (seeker.dateOfBirth && policy.adultMinimumAge && calculateAge(seeker.dateOfBirth, event.now) < policy.adultMinimumAge) return;
    if (this.consents && !(await this.consents.hasAllRequired('job_seeker', seeker.id))) return;
    if (await this.alreadySent(seeker.id, FLOW_TEMPLATES.detailsSaved, null)) return;
    if (await this.messaging.messagingBlocked('job_seeker', seeker.id, FLOW_TEMPLATES.detailsSaved)) return;
    const link = await this.continueLink(seeker.id, 'details_saved_message');
    if (!link) return;
    await this.messaging.sendPreferWhatsApp({
      template: FLOW_TEMPLATES.detailsSaved,
      subjectType: 'job_seeker',
      subjectId: seeker.id,
      variables: { firstName: firstName(seeker.name), code: seeker.code, amount: formatINR(policy.activationFeePaise), link, days: String(policy.jobSeekerGuaranteeDays) },
      contactAttempt: false,
    });
  }

  // ------------------------------------------------------------------ payment

  async afterPaid(event: JobSeekerPaidEvent): Promise<void> {
    const seeker = await this.prisma.jobSeeker.findUnique({
      where: { id: event.jobSeekerId },
      select: { id: true, code: true, name: true, status: true, guaranteeStartsAt: true, anonymisedAt: true },
    });
    if (!seeker || seeker.anonymisedAt) return;
    if (seeker.status === 'active' && seeker.guaranteeStartsAt) {
      await this.sendGuaranteeStarted(seeker, seeker.guaranteeStartsAt, event.paymentId);
      return;
    }
    if (seeker.status !== PAID_WAITING_ID) return;
    if (await this.alreadySent(seeker.id, FLOW_TEMPLATES.paymentReceived, event.paymentId)) return;
    if (await this.messaging.messagingBlocked('job_seeker', seeker.id, FLOW_TEMPLATES.paymentReceived)) return;
    const link = await this.continueLink(seeker.id, 'payment_received_message');
    if (!link) return;
    const policy = await this.pricing.current();
    await this.messaging.sendPreferWhatsApp({
      template: FLOW_TEMPLATES.paymentReceived,
      subjectType: 'job_seeker',
      subjectId: seeker.id,
      relatedType: 'payment',
      relatedId: event.paymentId,
      variables: { firstName: firstName(seeker.name), code: seeker.code, link, days: String(policy.jobSeekerGuaranteeDays) },
      contactAttempt: false,
    });
  }

  // ------------------------------------------------------------------ ID passed

  /**
   * The ID check passed: starts his 30 days when he has paid (the later of the payment and the ID
   * pass), audits it and sends "Your 30 days have started". True when it started now.
   */
  async afterIdPassed(jobSeekerId: string, actor: { id: string; role: string } | null, now: Date, reason?: string): Promise<boolean> {
    const result = await this.prisma.$transaction((tx) => startGuaranteeIfReady(tx, jobSeekerId, actor?.id ?? null, now));
    if (!result.started || !result.jobSeeker || !result.guaranteeStartsAt) return false;
    await this.audit?.log({
      actorId: actor?.id ?? 'system',
      action: 'job_seeker.guarantee_started',
      entityType: 'job_seeker',
      entityCode: result.jobSeeker.code,
      before: { status: PAID_WAITING_ID, guaranteeStartsAt: null },
      after: { status: 'active', guaranteeStartsAt: result.guaranteeStartsAt.toISOString(), ...(reason ? { via: reason } : {}) },
      changedFields: ['status', 'guaranteeStartsAt'],
      city: result.jobSeeker.city,
    });
    await this.sendGuaranteeStarted(result.jobSeeker, result.guaranteeStartsAt, null);
    return true;
  }

  private async sendGuaranteeStarted(seeker: { id: string; name: string }, startsAt: Date, relatedPaymentId: string | null): Promise<void> {
    try {
      if (await this.alreadySent(seeker.id, FLOW_TEMPLATES.guaranteeStarted, relatedPaymentId)) return;
      const policy = await this.pricing.current();
      await this.messaging.sendPreferWhatsApp({
        template: FLOW_TEMPLATES.guaranteeStarted,
        subjectType: 'job_seeker',
        subjectId: seeker.id,
        ...(relatedPaymentId ? { relatedType: 'payment', relatedId: relatedPaymentId } : {}),
        variables: {
          firstName: firstName(seeker.name),
          days: String(policy.jobSeekerGuaranteeDays),
          endDate: guaranteeEndLabel(refundGuaranteeDeadline(startsAt, policy.jobSeekerGuaranteeDays)),
        },
        contactAttempt: false,
      });
    } catch (error) {
      this.logger.warn(`"30 days started" message not sent: ${(error as Error).message}`);
    }
  }

  /**
   * Another ID (PAN, driving licence, voter ID) approved by a Team Lead, Manager or the CEO
   * (rev 211, replaces the 22 Nov automatic payment link): when he has paid, his 30 days start and
   * he is told; the agent who holds him gets a bell. Before payment nothing is sent (his link already
   * leads with the payment).
   */
  async afterOtherIdApproved(event: OtherIdApproved): Promise<OtherIdFollowUp> {
    const started = await this.afterIdPassed(event.subjectId, event.actor, event.now, 'other_id_approved');
    if (!started) {
      const seeker = await this.prisma.jobSeeker.findUnique({ where: { id: event.subjectId }, select: { paymentReceivedAt: true } });
      return { status: 'none', reason: seeker?.paymentReceivedAt ? 'already_started' : 'not_paid_yet' };
    }
    await this.tellAgent(event);
    return { status: 'sent', reason: 'guarantee_started' };
  }

  private async tellAgent(event: OtherIdApproved): Promise<void> {
    if (!this.notifications) return;
    const seeker = await this.prisma.jobSeeker.findUnique({
      where: { id: event.subjectId },
      select: { id: true, code: true, name: true, assignedStaffId: true, registeredByStaffId: true },
    });
    const agentId = seeker ? seeker.assignedStaffId ?? seeker.registeredByStaffId : null;
    if (!seeker || !agentId || agentId === event.actor.id) return;
    const agent = await this.prisma.staff.findUnique({ where: { id: agentId }, select: { id: true, role: true, status: true } });
    if (!agent || agent.status !== 'active') return;
    try {
      await this.notifications.open(
        {
          recipientStaffId: agent.id,
          kind: 'guarantee_started',
          title: `ID approved for ${seeker.name} (${seeker.code}): his 30 days have started`,
          body: 'He was told by WhatsApp (or SMS). He can now be matched with jobs.',
          link: notificationLink(agent.role, 'guarantee_started', { id: seeker.id }),
          subjectType: 'job_seeker',
          subjectId: seeker.id,
        },
        event.now,
      );
    } catch (error) {
      this.logger.warn(`Bell for the 30 days started failed: ${(error as Error).message}`);
    }
  }

  // ------------------------------------------------------------------ ID failed

  async afterIdFailed(event: JobSeekerIdFailedEvent): Promise<void> {
    const seeker = await this.prisma.jobSeeker.findUnique({
      where: { id: event.jobSeekerId },
      select: { id: true, code: true, name: true, status: true, paymentReceivedAt: true, guaranteeStartsAt: true, anonymisedAt: true },
    });
    // Only a paid job seeker whose 30 days have not started has a refund to ask about.
    if (!seeker || seeker.anonymisedAt || !seeker.paymentReceivedAt || seeker.guaranteeStartsAt || seeker.status !== PAID_WAITING_ID) return;
    if (await this.alreadySent(seeker.id, FLOW_TEMPLATES.idFailed, event.verificationId)) return;
    const policy = await this.pricing.current();
    await this.messaging.sendPreferWhatsApp({
      template: FLOW_TEMPLATES.idFailed,
      subjectType: 'job_seeker',
      subjectId: seeker.id,
      relatedType: 'identity_verification',
      relatedId: event.verificationId,
      variables: {
        firstName: firstName(seeker.name),
        code: seeker.code,
        reason: ID_FAILED_REASON_TEXT[event.result],
        amount: formatINR(policy.activationFeePaise),
      },
      contactAttempt: false,
    });
  }

  // ------------------------------------------------------------------ reminders

  /**
   * Paid but no ID check (rev 211, A4): one reminder a day for 3 days ("id_check_reminder" with his
   * continue link), only between 9 AM and 9 PM, never to a number marked wrong number / do not call,
   * then nothing more by itself (he stays paused; nothing is refunded by itself). Nothing while
   * another ID waits for the Team Lead (nothing for him to do) or after an under-18 stop.
   */
  async sendIdCheckReminders(now: Date): Promise<{ sent: number; quietHours?: true }> {
    if (inQuietHours(now)) return { sent: 0, quietHours: true };
    const seekers = await this.prisma.jobSeeker.findMany({
      where: { status: PAID_WAITING_ID, guaranteeStartsAt: null, paymentReceivedAt: { not: null, lte: new Date(now.getTime() - ID_CHECK_REMINDER_GAP_MS) }, anonymisedAt: null },
      select: { id: true, name: true, paymentReceivedAt: true },
      orderBy: { paymentReceivedAt: 'asc' },
      take: 500,
    });
    let sent = 0;
    for (const seeker of seekers) {
      try {
        if (await this.remindOne(seeker, now)) sent += 1;
      } catch (error) {
        this.logger.warn(`ID check reminder for ${seeker.id} failed: ${(error as Error).message}`);
      }
    }
    return { sent };
  }

  private async remindOne(seeker: { id: string; name: string; paymentReceivedAt: Date | null }, now: Date): Promise<boolean> {
    if (!seeker.paymentReceivedAt) return false;
    const payment = await this.prisma.payment.findFirst({
      where: { jobSeekerId: seeker.id, type: { in: ['activation', 'reactivation'] }, status: { in: ['succeeded', 'completed'] } },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      select: { id: true },
    });
    if (!payment) return false;
    const [latestId, stop] = await Promise.all([
      this.prisma.identityVerification.findFirst({ where: { jobSeekerId: seeker.id }, orderBy: { createdAt: 'desc' }, select: { status: true } }),
      this.prisma.identityVerification.findFirst({
        where: { jobSeekerId: seeker.id, method: 'aadhaar_qr', vendor: 'uidai_secure_qr', isAdult: false, under18LiftedAt: null },
        select: { id: true },
      }),
    ]);
    if (stop || latestId?.status === 'pending') return false;
    const rows = await this.prisma.messageLog.findMany({
      where: { subjectType: 'job_seeker', subjectId: seeker.id, template: FLOW_TEMPLATES.reminder, relatedId: payment.id, status: { not: 'blocked' } },
      select: { status: true, createdAt: true },
      orderBy: { createdAt: 'desc' },
    });
    const delivered = rows.filter((r) => r.status !== 'failed');
    if (delivered.length >= ID_CHECK_REMINDERS_MAX || rows.length >= ID_CHECK_REMINDER_TRIES_MAX) return false;
    const last = rows[0]?.createdAt ?? seeker.paymentReceivedAt;
    if (now.getTime() - last.getTime() < ID_CHECK_REMINDER_GAP_MS) return false;
    if (await this.messaging.messagingBlocked('job_seeker', seeker.id, FLOW_TEMPLATES.reminder)) return false;
    const link = await this.continueLink(seeker.id, 'id_check_reminder');
    if (!link) return false;
    const policy = await this.pricing.current();
    const result = await this.messaging.sendPreferWhatsApp({
      template: FLOW_TEMPLATES.reminder,
      subjectType: 'job_seeker',
      subjectId: seeker.id,
      relatedType: 'payment',
      relatedId: payment.id,
      variables: { firstName: firstName(seeker.name), days: String(policy.jobSeekerGuaranteeDays), link },
      contactAttempt: false,
    });
    return result.status === 'sent';
  }
}
