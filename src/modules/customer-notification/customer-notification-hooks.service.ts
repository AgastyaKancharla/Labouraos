import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.service';
import { CustomerNotificationService } from './customer-notification.service';

function firstName(name: string | null | undefined): string | null {
  const word = name?.trim().split(/\s+/)[0];
  return word ? word : null;
}

/**
 * The events other modules already have, turned into app notifications.
 * Each existing service calls ONE of these after its own work is saved
 * (marked "Customer app notification (Agent C)" at the call). Every method
 * looks up what it needs by id, never throws, and does nothing for a person
 * without the app. None of them changes the event itself: the SMS, WhatsApp
 * and calls the guide requires still go out exactly as before (C17).
 */
@Injectable()
export class CustomerNotificationHooks {
  private readonly logger = new Logger(CustomerNotificationHooks.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: CustomerNotificationService,
  ) {}

  private async safely(label: string, work: () => Promise<unknown>): Promise<void> {
    try {
      await work();
    } catch (error) {
      this.logger.warn(`Customer app notification (${label}) skipped: ${(error as Error).message}`);
    }
  }

  private async guaranteeDays(): Promise<number | null> {
    const policy = await this.prisma.pricingPolicy.findFirst({
      where: { effectiveFrom: { lte: new Date() } },
      orderBy: [{ effectiveFrom: 'desc' }, { createdAt: 'desc' }],
      select: { jobSeekerGuaranteeDays: true },
    });
    return policy?.jobSeekerGuaranteeDays ?? null;
  }

  /** PaymentService.onPaymentSucceeded: a job seeker's ₹499 is confirmed (the 30 days start). */
  async jobSeekerPaymentConfirmed(paymentId: string): Promise<void> {
    await this.safely('payment_confirmed', async () => {
      const payment = await this.prisma.payment.findUnique({
        where: { id: paymentId },
        select: { type: true, status: true, jobSeekerId: true, jobSeeker: { select: { name: true, referredById: true } } },
      });
      if (!payment || payment.type !== 'activation' || payment.status !== 'succeeded' || !payment.jobSeekerId) return;
      const days = await this.guaranteeDays();
      if (days !== null) {
        await this.notifications.notify({ jobSeekerId: payment.jobSeekerId }, 'payment_confirmed', { days }, { dedupeKey: `payment_confirmed:${paymentId}` });
      }
      const referredBy = payment.jobSeeker?.referredById;
      const name = firstName(payment.jobSeeker?.name);
      if (referredBy && name) {
        await this.notifications.notify({ referralId: referredBy }, 'referral_paid', { firstName: name }, { dedupeKey: `referral_paid:${paymentId}` });
      }
    });
  }

  /** PaymentService.onPaymentSucceeded: a business paid the placement fee (invoice ready, joining confirmed). */
  async placementFeePaid(paymentId: string): Promise<void> {
    await this.safely('fee_paid', async () => {
      const payment = await this.prisma.payment.findUnique({
        where: { id: paymentId },
        select: {
          type: true,
          status: true,
          placement: { select: { id: true, businessId: true, jobSeekerId: true, joiningDate: true, vacancy: { select: { branchId: true } } } },
        },
      });
      const placement = payment?.placement;
      if (!payment || payment.type !== 'placement_fee' || payment.status !== 'succeeded' || !placement) return;
      await this.notifications.notify(
        { businessId: placement.businessId, branchId: placement.vacancy?.branchId ?? null },
        'fee_paid',
        {},
        { dedupeKey: `fee_paid:${paymentId}` },
      );
      if (placement.joiningDate) {
        await this.notifications.notify({ jobSeekerId: placement.jobSeekerId }, 'joining_confirmed', {}, { dedupeKey: `joining_confirmed:${placement.id}` });
        await this.notifications.notify(
          { businessId: placement.businessId, branchId: placement.vacancy?.branchId ?? null },
          'joining_confirmed',
          {},
          { dedupeKey: `joining_confirmed:${placement.id}` },
        );
      }
    });
  }

  private async payee(paymentId: string) {
    const payment = await this.prisma.payment.findUnique({
      where: { id: paymentId },
      select: {
        id: true,
        type: true,
        status: true,
        subjectType: true,
        subjectId: true,
        jobSeekerId: true,
        businessId: true,
        referralId: true,
        placement: { select: { businessId: true } },
      },
    });
    if (!payment) return null;
    if (payment.type === 'refund') {
      if (payment.jobSeekerId || payment.subjectType === 'job_seeker') {
        return { payment, target: { jobSeekerId: payment.jobSeekerId ?? payment.subjectId }, kind: 'refund' as const };
      }
      const businessId = payment.businessId ?? payment.placement?.businessId ?? (payment.subjectType === 'business' ? payment.subjectId : null);
      return businessId ? { payment, target: { businessId }, kind: 'refund' as const } : null;
    }
    if (payment.type === 'referral_payout') {
      const referralId = payment.referralId ?? (payment.subjectType === 'referral' ? payment.subjectId : null);
      return referralId ? { payment, target: { referralId }, kind: 'payout' as const } : null;
    }
    if (payment.type === 'joining_reward') {
      const jobSeekerId = payment.jobSeekerId ?? (payment.subjectType === 'job_seeker' ? payment.subjectId : null);
      return jobSeekerId ? { payment, target: { jobSeekerId }, kind: 'reward' as const } : null;
    }
    return null;
  }

  /** PaymentService.approvePayment: a refund, referral payout or joining reward is approved by CEO or Finance. */
  async paymentApproved(paymentId: string): Promise<void> {
    await this.safely('payment_approved', async () => {
      const found = await this.payee(paymentId);
      if (!found || found.payment.status !== 'approved') return;
      const kind = found.kind === 'refund' ? 'refund_approved' : found.kind === 'payout' ? 'payout_approved' : 'reward_approved';
      await this.notifications.notify(found.target, kind, {}, { dedupeKey: `${kind}:${paymentId}` });
    });
  }

  /** PaymentService.recordPayout: the money went out (status shown only; released by a person). */
  async paymentPaid(paymentId: string): Promise<void> {
    await this.safely('payment_paid', async () => {
      const found = await this.payee(paymentId);
      if (!found || found.payment.status !== 'succeeded') return;
      const kind = found.kind === 'refund' ? 'refund_paid' : found.kind === 'payout' ? 'payout_paid' : 'reward_paid';
      await this.notifications.notify(found.target, kind, {}, { dedupeKey: `${kind}:${paymentId}` });
    });
  }

  /**
   * InterviewService.book: an offer (a confirmed interview) was sent by SMS and
   * WhatsApp. The app push is extra and urgent; the offer itself and its
   * 48-hour clock are unchanged.
   */
  async interviewOffered(interviewId: string): Promise<void> {
    await this.safely('interview_booked', async () => {
      const interview = await this.prisma.interview.findUnique({
        where: { id: interviewId },
        select: { jobSeekerId: true, status: true, offerSentAt: true, replyDueAt: true },
      });
      if (!interview || interview.status !== 'offered') return;
      const hours = Math.max(1, Math.round((interview.replyDueAt.getTime() - interview.offerSentAt.getTime()) / 3_600_000));
      await this.notifications.notify({ jobSeekerId: interview.jobSeekerId }, 'interview_booked', { hours }, { urgent: true, dedupeKey: `interview_booked:${interviewId}` });
    });
  }

  /**
   * BusinessVerificationService.assign: a field agent is assigned to visit the
   * business at the time the owner picked in the app (visit_booked). Only when
   * a time is known (requestedFor).
   */
  async visitAssigned(assignmentId: string): Promise<void> {
    await this.safely('visit_booked', async () => {
      const assignment = await this.prisma.visitAssignment.findUnique({
        where: { id: assignmentId },
        select: { businessId: true, status: true, requestedFor: true, assignedStaff: { select: { name: true } } },
      });
      const agentFirstName = firstName(assignment?.assignedStaff?.name);
      if (!assignment || assignment.status !== 'assigned' || !assignment.requestedFor || !agentFirstName) return;
      await this.notifications.notify(
        { businessId: assignment.businessId },
        'visit_booked',
        { agentFirstName, when: assignment.requestedFor },
        { dedupeKey: `visit_booked:${assignmentId}:${agentFirstName}` },
      );
    });
  }

  /** BusinessVerificationService.approve: the Team Lead approved the business (verified). */
  async businessApproved(businessId: string): Promise<void> {
    await this.safely('business_approved', async () => {
      const business = await this.prisma.business.findUnique({ where: { id: businessId }, select: { verificationStatus: true, verifiedAt: true } });
      if (!business || business.verificationStatus !== 'verified') return;
      await this.notifications.notify(
        { businessId },
        'business_approved',
        {},
        { dedupeKey: `business_approved:${businessId}:${business.verifiedAt?.toISOString() ?? ''}` },
      );
    });
  }

  /** VacancyConfirmationService: the contact person confirmed the vacancy by OTP. */
  async vacancyConfirmed(vacancyId: string): Promise<void> {
    await this.safely('vacancy_confirmed', async () => {
      const vacancy = await this.prisma.vacancy.findUnique({ where: { id: vacancyId }, select: { code: true, businessId: true, branchId: true } });
      if (!vacancy) return;
      await this.notifications.notify(
        { businessId: vacancy.businessId, branchId: vacancy.branchId },
        'vacancy_confirmed',
        { vacancyCode: vacancy.code },
        { dedupeKey: `vacancy_confirmed:${vacancyId}` },
      );
    });
  }
}
