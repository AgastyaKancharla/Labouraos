import { Injectable, Logger, OnModuleInit, Optional } from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.service';
import { AuditService } from '../../common/audit/audit.service';
import { recordStatusChange } from '../../common/status-history/status-history.helper';
import { ConsentService } from '../consent/consent.service';
import { MessagingService } from '../message/messaging.service';
import { inQuietHours } from '../message/quiet-hours';
import { NotificationService } from '../notification/notification.service';
import { notificationLink } from '../notification/notification.constants';
import { OtherIdDecisionHooks, OtherIdFollowUp, OtherIdApproved } from '../aadhaar-qr/other-id-decision-hooks';
import { JobSeekerService } from './job-seeker.service';

/** Before the ₹499: the statuses of a job seeker who hasn't paid yet. */
const NOT_PAID_STATUSES = ['lead', 'consented', 'pending_activation'];

/** Why the link did not go out, in the agent's words (bell). */
export const PAYMENT_LINK_SKIP_TEXT: Record<string, string> = {
  already_paid: 'he has already paid',
  not_payable: 'his registration is not waiting for a payment',
  no_consent: 'his consent is not complete',
  contact_blocked: 'his number is marked wrong number or do not call',
  quiet_hours: 'it is outside messaging hours (9 AM to 9 PM)',
  not_sent: 'the payment request could not be made',
  failed: 'something went wrong',
};

/** The history reason (StatusHistory, no personal data). */
export const PAYMENT_LINK_HISTORY_REASON = 'payment_link_after_id_approval';

/**
 * Another ID approved → payment link (Master Guide rev 206, decided 22 Nov):
 * when a Team Lead, Manager or the CEO approves a PAN, driving licence or voter
 * ID of a job seeker who hasn't paid, the ₹499 payment link goes to him by
 * itself — the same service as Resend (JobSeekerService.createActivationPayment:
 * the same ID gate, re-consent and ban-review checks, SMS and WhatsApp). The
 * usual message rules apply first: no link without complete consent, to a
 * number marked wrong number or do not call, or between 9 PM and 9 AM; the
 * agent is told and uses Resend later. Each outcome is kept in the job seeker's
 * history and the agent who holds him gets a bell. Paying before the check
 * stays refused (the ID gate is unchanged).
 */
@Injectable()
export class IdApprovedPaymentLinkService implements OnModuleInit {
  private readonly logger = new Logger(IdApprovedPaymentLinkService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly jobSeekers: JobSeekerService,
    private readonly messaging: MessagingService,
    @Optional() private readonly hooks?: OtherIdDecisionHooks,
    @Optional() private readonly consents?: ConsentService,
    @Optional() private readonly notifications?: NotificationService,
    @Optional() private readonly audit?: AuditService,
  ) {}

  onModuleInit(): void {
    this.hooks?.onApproved('job_seeker', (event) => this.afterApproval(event));
  }

  async afterApproval(event: OtherIdApproved): Promise<OtherIdFollowUp> {
    const seeker = await this.prisma.jobSeeker.findUnique({
      where: { id: event.subjectId },
      select: { id: true, code: true, name: true, status: true, paymentReceivedAt: true, anonymisedAt: true, assignedStaffId: true, registeredByStaffId: true },
    });
    if (!seeker || seeker.anonymisedAt) return { status: 'none', reason: null };
    const outcome = await this.send(seeker, event);
    await this.record(seeker, event, outcome);
    return outcome;
  }

  private async send(seeker: { id: string; status: string; paymentReceivedAt: Date | null }, event: OtherIdApproved): Promise<OtherIdFollowUp> {
    if (seeker.paymentReceivedAt || seeker.status === 'active') return { status: 'skipped', reason: 'already_paid' };
    if (!NOT_PAID_STATUSES.includes(seeker.status)) return { status: 'skipped', reason: 'not_payable' };
    if (this.consents && !(await this.consents.hasAllRequired('job_seeker', seeker.id))) return { status: 'skipped', reason: 'no_consent' };
    if (await this.messaging.messagingBlocked('job_seeker', seeker.id, 'payment_request')) return { status: 'skipped', reason: 'contact_blocked' };
    if (inQuietHours(event.now)) return { status: 'skipped', reason: 'quiet_hours' };
    try {
      await this.jobSeekers.createActivationPayment(seeker.id, event.actor.id);
      return { status: 'sent', reason: null };
    } catch (error) {
      this.logger.warn(`Payment link after an approved ID not sent: ${(error as Error).message}`);
      return { status: 'skipped', reason: 'not_sent' };
    }
  }

  /** The job seeker's history (status history + audit, codes only) and a bell for the agent who holds him. */
  private async record(
    seeker: { id: string; code: string; name: string; status: string; assignedStaffId: string | null; registeredByStaffId: string | null },
    event: OtherIdApproved,
    outcome: OtherIdFollowUp,
  ): Promise<void> {
    const reason = outcome.status === 'sent' ? `${PAYMENT_LINK_HISTORY_REASON}:sent` : `${PAYMENT_LINK_HISTORY_REASON}:skipped:${outcome.reason}`;
    try {
      await recordStatusChange(this.prisma, {
        subjectType: 'job_seeker',
        subjectId: seeker.id,
        fromStatus: seeker.status,
        toStatus: seeker.status,
        changedByStaffId: event.actor.id,
        reason,
      });
      await this.audit?.log({
        actorId: event.actor.id,
        action: 'job_seeker.payment_link_after_id_approval',
        entityType: 'job_seeker',
        entityCode: seeker.code,
        after: { outcome: outcome.status, reason: outcome.reason, approverRole: event.actor.role },
        changedFields: [],
      });
    } catch (error) {
      this.logger.warn(`History of the payment link after an approved ID failed: ${(error as Error).message}`);
    }
    await this.tellAgent(seeker, event, outcome);
  }

  private async tellAgent(
    seeker: { id: string; code: string; name: string; assignedStaffId: string | null; registeredByStaffId: string | null },
    event: OtherIdApproved,
    outcome: OtherIdFollowUp,
  ): Promise<void> {
    if (!this.notifications) return;
    const agentId = seeker.assignedStaffId ?? seeker.registeredByStaffId;
    if (!agentId || agentId === event.actor.id) return;
    const agent = await this.prisma.staff.findUnique({ where: { id: agentId }, select: { id: true, role: true, status: true } });
    if (!agent || agent.status !== 'active') return;
    const sent = outcome.status === 'sent';
    const why = outcome.reason ? (PAYMENT_LINK_SKIP_TEXT[outcome.reason] ?? outcome.reason) : null;
    try {
      await this.notifications.open(
        {
          recipientStaffId: agent.id,
          kind: 'payment_link_after_id',
          title: sent
            ? `ID approved for ${seeker.name} (${seeker.code}): the payment link was sent`
            : `ID approved for ${seeker.name} (${seeker.code}): the payment link was not sent`,
          body: sent
            ? 'The payment link went to him by SMS and WhatsApp. Call him to help him pay.'
            : `Not sent because ${why}. Use Resend payment link when you can.`,
          link: notificationLink(agent.role, 'payment_link_after_id', { id: seeker.id }),
          subjectType: 'job_seeker',
          subjectId: seeker.id,
        },
        event.now,
      );
    } catch (error) {
      this.logger.warn(`Bell for the payment link after an approved ID failed: ${(error as Error).message}`);
    }
  }
}
