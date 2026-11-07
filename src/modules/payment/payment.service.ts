import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { Payment, Prisma } from '@prisma/client';
import { createHash } from 'node:crypto';
import { PrismaService } from '../../common/prisma/prisma.service';
import { AuditService } from '../../common/audit/audit.service';
import { IdService } from '../../common/id/id.service';
import { PricingService } from '../pricing/pricing.service';
import { PaymentFilterDto } from './dto/payment-filter.dto';
import {
  PAYMENT_PROVIDER,
  PaymentProvider,
  WebhookVerificationResult,
} from './payment-provider.interface';
import {
  BANK_FEED_PROVIDER,
  BankFeedProvider,
} from './bank-feed-provider.interface';
import { ReviewFlagService } from '../review-flag/review-flag.service';
import { MAX_PAYOUT_ATTEMPTS, resolveWebhookTransition } from './payout-state';
import { recordStatusChange } from '../../common/status-history/status-history.helper';
import { MessagingService } from '../message/messaging.service';

@Injectable()
export class PaymentService {
  private readonly logger = new Logger(PaymentService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly auditService: AuditService,
    private readonly idService: IdService,
    @Inject(PAYMENT_PROVIDER)
    private readonly provider: PaymentProvider,
    @Inject(BANK_FEED_PROVIDER)
    private readonly bankFeedProvider: BankFeedProvider,
    private readonly pricingService: PricingService,
    private readonly messagingService: MessagingService,
    private readonly reviewFlagService: ReviewFlagService,
  ) {}

  private async getReferralPayoutPaise(): Promise<number> {
    const policy = await this.pricingService.current();
    return policy.referralPayoutPaise;
  }

  getProvider(): PaymentProvider {
    return this.provider;
  }

  async createCharge(
    amountPaise: number,
    subjectType: string,
    subjectId: string,
  ): Promise<{ paymentLink: string; gatewayReference: string }> {
    return this.provider.createCharge(amountPaise, subjectType, subjectId);
  }

  async verifyWebhook(
    payload: unknown,
    signature?: string,
    rawBody?: Buffer | string,
  ): Promise<WebhookVerificationResult> {
    return this.provider.verifyWebhook(payload, signature, rawBody);
  }

  async handleWebhook(
    payload: unknown,
    signature?: string,
    rawBody?: Buffer | string,
  ) {
    const verification = await this.verifyWebhook(payload, signature, rawBody);
    if (!verification.isValid) {
      throw new BadRequestException('Invalid webhook signature or payload');
    }

    const { gatewayReference, status } = verification;

    const payment = await this.prisma.payment.findUnique({
      where: { gatewayReference },
    });

    if (!payment) {
      this.logger.warn(`Webhook received for unknown gatewayReference: ${gatewayReference}`);
      return { received: false, error: 'Payment not found' };
    }

    // Idempotency: if already processed or succeeded, no-op
    if (payment.status === 'succeeded') {
      this.logger.log(`Payment ${payment.id} (${gatewayReference}) was already processed. Ignoring duplicate webhook.`);
      return { received: true, alreadyProcessed: true, paymentId: payment.id };
    }

    if (payment.status === 'failed') {
      this.logger.warn(`Payment ${payment.id} already failed. Cannot succeed.`);
      return { received: true, alreadyFailed: true, paymentId: payment.id };
    }

    if (status === 'failed') {
      const updatedPayment = await this.prisma.$transaction(async (tx) => {
        const updated = await tx.payment.update({
          where: { id: payment.id },
          data: { status: 'failed' },
        });
        await recordStatusChange(tx, {
          subjectType: 'payment',
          subjectId: payment.id,
          fromStatus: payment.status,
          toStatus: 'failed',
          changedByStaffId: null,
          reason: 'collection_webhook_failed',
        });
        return updated;
      });
      return { received: true, status: 'failed', paymentId: updatedPayment.id };
    }

    return this.onPaymentSucceeded(payment.id, {
      confirmedAt: new Date(),
      confirmedBy: 'gateway',
    });
  }

  async onPaymentSucceeded(
    paymentId: string,
    confirmation: { confirmedAt: Date; confirmedBy: string; confirmedByStaffId?: string; bankUtr?: string },
  ) {
    const { confirmedAt, confirmedBy, confirmedByStaffId, bankUtr } = confirmation;
    const transition = await this.prisma.$transaction(async (tx) => {
      const payment = await tx.payment.findUnique({
        where: { id: paymentId },
        include: { jobSeeker: true },
      });
      if (!payment) throw new NotFoundException(`Payment '${paymentId}' not found`);
      if (payment.status === 'succeeded') return { alreadyProcessed: true as const, payment };
      if (payment.status === 'failed') return { alreadyFailed: true as const, payment };

      const claimed = await tx.payment.updateMany({
        where: { id: paymentId, status: payment.status },
        data: {
          status: 'succeeded',
          confirmedAt,
          confirmedBy,
          confirmedByStaffId: confirmedByStaffId ?? null,
          bankUtr: bankUtr ?? payment.bankUtr,
        },
      });
      if (claimed.count !== 1) return { alreadyProcessed: true as const, payment };
      await recordStatusChange(tx, {
        subjectType: 'payment', subjectId: paymentId, fromStatus: payment.status, toStatus: 'succeeded',
        changedByStaffId: confirmedByStaffId ?? null, reason: `payment_confirmed_${confirmedBy}`, changedAt: confirmedAt,
      });

      let updatedSeeker: Awaited<ReturnType<typeof tx.jobSeeker.update>> | null = null;
      if (payment.type === 'activation' && payment.jobSeekerId) {
        updatedSeeker = await tx.jobSeeker.update({
          where: { id: payment.jobSeekerId },
          data: {
            status: 'active', paymentReceivedAt: confirmedAt,
            hitCount: payment.reactivation ? 0 : (payment.jobSeeker?.hitCount ?? 0),
          },
        });
        await recordStatusChange(tx, {
          subjectType: 'job_seeker', subjectId: payment.jobSeekerId,
          fromStatus: payment.jobSeeker?.status ?? null, toStatus: 'active',
          changedByStaffId: confirmedByStaffId ?? null,
          reason: payment.reactivation ? 'reactivated_via_payment' : 'activated_via_payment', changedAt: confirmedAt,
        });
      }

      let placementTransition: {
        placement: Prisma.PlacementGetPayload<{ include: { jobSeeker: true } }>;
      } | null = null;
      if (payment.type === 'placement_fee' && payment.placementId) {
        const placement = await tx.placement.findUnique({
          where: { id: payment.placementId }, include: { jobSeeker: true },
        });
        if (!placement) throw new NotFoundException('Placement for fee payment was not found');
        const paid = await tx.placement.updateMany({
          where: { id: placement.id, status: 'awaiting_payment' },
          data: { status: 'confirmed', paidAt: confirmedAt },
        });
        if (paid.count === 1) {
          await recordStatusChange(tx, {
            subjectType: 'placement', subjectId: placement.id, fromStatus: 'awaiting_payment', toStatus: 'confirmed',
            changedByStaffId: confirmedByStaffId ?? null, reason: 'placement_fee_payment_succeeded', changedAt: confirmedAt,
          });
          if (placement.jobSeeker.status !== 'placed') {
            await tx.jobSeeker.update({ where: { id: placement.jobSeekerId }, data: { status: 'placed' } });
            await recordStatusChange(tx, {
              subjectType: 'job_seeker', subjectId: placement.jobSeekerId,
              fromStatus: placement.jobSeeker.status, toStatus: 'placed',
              changedByStaffId: confirmedByStaffId ?? null,
              reason: 'placement_fee_payment_succeeded', changedAt: confirmedAt,
            });
          }
          placementTransition = { placement };
        }
      }
      return { alreadyProcessed: false as const, payment, updatedSeeker, placementTransition };
    });

    if ('alreadyProcessed' in transition && transition.alreadyProcessed) {
      return { received: true, alreadyProcessed: true, paymentId };
    }
    if ('alreadyFailed' in transition && transition.alreadyFailed) {
      return { received: true, alreadyFailed: true, paymentId };
    }
    if (transition.updatedSeeker) {
      const actorId = await this.fallbackActorId();
      if (actorId) await this.auditService.log({
        actorId,
        action: transition.payment.reactivation ? 'job_seeker.reactivated' : 'job_seeker.activated',
        entityType: 'job_seeker', entityCode: transition.updatedSeeker.code,
        before: transition.payment.jobSeeker ? {
          status: transition.payment.jobSeeker.status,
          hitCount: transition.payment.jobSeeker.hitCount,
          paymentReceivedAt: transition.payment.jobSeeker.paymentReceivedAt,
        } : null,
        after: {
          status: transition.updatedSeeker.status, hitCount: transition.updatedSeeker.hitCount,
          paymentReceivedAt: transition.updatedSeeker.paymentReceivedAt,
          reactivation: transition.payment.reactivation,
        }, city: transition.updatedSeeker.city,
      });
    }
    if (transition.placementTransition) {
      const { placement } = transition.placementTransition;
      const actorId = await this.fallbackActorId();
      if (actorId) await this.auditService.log({
        actorId, action: 'placement_fee_paid', entityType: 'Placement', entityCode: placement.code,
        city: placement.city,
        before: { status: 'awaiting_payment', jobSeekerStatus: placement.jobSeeker.status },
        after: { status: 'confirmed', paidAt: confirmedAt.toISOString(), jobSeekerStatus: 'placed', paymentId },
      });
      if (placement.joiningDate) {
        const joiningDate = new Intl.DateTimeFormat('en-IN', {
          timeZone: 'Asia/Kolkata', dateStyle: 'medium',
        }).format(placement.joiningDate);
        await Promise.all((['sms', 'whatsapp'] as const).map((channel) => this.messagingService.send({
          channel, template: 'joining_confirmed', subjectType: 'job_seeker',
          subjectId: placement.jobSeekerId, relatedType: 'placement', relatedId: placement.id,
          variables: { joiningDate },
        })));
      }
    }
    return { received: true, status: 'succeeded', paymentId };
  }

  async handleBankFeedWebhook(rawBody: Buffer | string | undefined, signature?: string) {
    const verification = await this.bankFeedProvider.verifyWebhook(rawBody, signature);
    if (!verification.isValid || !verification.event) {
      throw new BadRequestException('Invalid bank feed webhook signature or payload');
    }

    const { bankUtr, amountPaise, receivedAt, payerName, payerVpaMasked, remark } = verification.event;

    // Idempotent check by bankUtr
    const existing = await this.prisma.bankCredit.findUnique({
      where: { bankUtr },
    });
    if (existing) {
      this.logger.log(`Bank credit '${bankUtr}' already processed. Idempotent skip.`);
      return { received: true, alreadyProcessed: true, bankCreditId: existing.id };
    }

    const credit = await this.prisma.bankCredit.create({
      data: {
        bankUtr,
        amountPaise,
        receivedAt,
        payerName: payerName ?? null,
        payerVpaMasked: payerVpaMasked ?? null,
        remark: remark ?? null,
        source: 'bank_feed',
        status: 'unmatched',
      },
    });

    if (!remark || !remark.trim()) {
      await this.reviewFlagService.raise({
        kind: 'payment_mismatch',
        subjectType: 'bank_credit',
        subjectId: credit.id,
        details: { bankUtr, amountPaise, reason: 'no_reference' },
      });
      return { received: true, status: 'unmatched', reason: 'no_reference', bankCreditId: credit.id };
    }

    const pendingPayments = await this.prisma.payment.findMany({
      where: {
        status: 'pending',
        method: 'upi_direct',
        upiReference: { not: null },
      },
    });

    const matchedPayment = pendingPayments.find(
      (p) => p.upiReference && remark.toUpperCase().includes(p.upiReference.toUpperCase()),
    );

    if (!matchedPayment) {
      await this.reviewFlagService.raise({
        kind: 'payment_mismatch',
        subjectType: 'bank_credit',
        subjectId: credit.id,
        details: { bankUtr, amountPaise, remark, reason: 'unknown_reference' },
      });
      return { received: true, status: 'unmatched', reason: 'unknown_reference', bankCreditId: credit.id };
    }

    const expectedAmount = matchedPayment.expectedAmountPaise ?? matchedPayment.amount;
    if (expectedAmount !== amountPaise) {
      await this.reviewFlagService.raise({
        kind: 'payment_mismatch',
        subjectType: 'payment',
        subjectId: matchedPayment.id,
        details: {
          bankCreditId: credit.id,
          bankUtr,
          expectedAmountPaise: expectedAmount,
          receivedAmountPaise: amountPaise,
          reason: 'amount_mismatch',
        },
      });
      return { received: true, status: 'unmatched', reason: 'amount_mismatch', bankCreditId: credit.id };
    }

    await this.onPaymentSucceeded(matchedPayment.id, {
      confirmedAt: receivedAt,
      confirmedBy: 'bank_feed',
      bankUtr,
    });

    await this.prisma.bankCredit.update({
      where: { id: credit.id },
      data: {
        status: 'matched',
        matchedPaymentId: matchedPayment.id,
      },
    });

    return {
      received: true,
      status: 'succeeded',
      paymentId: matchedPayment.id,
      bankCreditId: credit.id,
    };
  }

  async recordManualBankCredit(
    dto: {
      bankUtr: string;
      amountPaise: number;
      receivedAt: Date | string;
      payerName?: string;
      payerVpaMasked?: string;
      remark?: string;
    },
    actorId: string,
  ) {
    const bankUtr = dto.bankUtr?.trim();
    if (!bankUtr) {
      throw new BadRequestException('bankUtr is required');
    }
    const amountPaise = Number(dto.amountPaise);
    if (!amountPaise || amountPaise <= 0 || isNaN(amountPaise)) {
      throw new BadRequestException('amountPaise must be a positive integer');
    }
    const receivedAt = new Date(dto.receivedAt);
    if (isNaN(receivedAt.getTime())) {
      throw new BadRequestException('receivedAt must be a valid date');
    }

    const existing = await this.prisma.bankCredit.findUnique({
      where: { bankUtr },
    });
    if (existing) {
      throw new ConflictException(`Bank credit with UTR '${bankUtr}' already exists`);
    }

    const credit = await this.prisma.bankCredit.create({
      data: {
        bankUtr,
        amountPaise,
        receivedAt,
        payerName: dto.payerName?.trim() || null,
        payerVpaMasked: dto.payerVpaMasked?.trim() || null,
        remark: dto.remark?.trim() || null,
        source: 'finance_manual',
        enteredByStaffId: actorId,
        status: 'unmatched',
      },
    });

    await this.auditService.log({
      actorId,
      action: 'bank_credit.recorded',
      entityType: 'BankCredit',
      entityCode: bankUtr,
      after: {
        id: credit.id,
        bankUtr,
        amountPaise,
        receivedAt: receivedAt.toISOString(),
        source: 'finance_manual',
      },
    });

    return credit;
  }

  async confirmPaymentWithBankCredit(
    paymentId: string,
    bankCreditId: string,
    actorId: string,
  ) {
    if (!bankCreditId) {
      throw new BadRequestException('bankCreditId is required');
    }
    const payment = await this.prisma.payment.findUnique({
      where: { id: paymentId },
    });
    if (!payment) {
      throw new NotFoundException(`Payment '${paymentId}' not found`);
    }
    if (payment.status !== 'pending') {
      throw new BadRequestException(`Cannot confirm payment with status '${payment.status}'`);
    }

    const credit = await this.prisma.bankCredit.findUnique({
      where: { id: bankCreditId },
    });
    if (!credit) {
      throw new NotFoundException(`Bank credit '${bankCreditId}' not found`);
    }
    if (credit.status === 'matched') {
      throw new BadRequestException('Bank credit is already matched');
    }
    if (credit.status === 'ignored') {
      throw new BadRequestException('Cannot match an ignored bank credit');
    }

    const expectedAmount = payment.expectedAmountPaise ?? payment.amount;
    if (expectedAmount !== credit.amountPaise) {
      throw new BadRequestException(
        `Amount mismatch: payment expected ${expectedAmount} paise but credit has ${credit.amountPaise} paise`,
      );
    }

    const existingPaymentWithUtr = await this.prisma.payment.findFirst({
      where: { bankUtr: credit.bankUtr, NOT: { id: payment.id } },
    });
    if (existingPaymentWithUtr) {
      throw new ConflictException(`Bank UTR '${credit.bankUtr}' is already matched to another payment`);
    }

    await this.onPaymentSucceeded(payment.id, {
      confirmedAt: credit.receivedAt,
      confirmedBy: 'finance_manual',
      confirmedByStaffId: actorId,
      bankUtr: credit.bankUtr,
    });

    await this.prisma.bankCredit.update({
      where: { id: credit.id },
      data: {
        status: 'matched',
        matchedPaymentId: payment.id,
      },
    });

    const openFlags = await this.prisma.reviewFlag.findMany({
      where: {
        kind: 'payment_mismatch',
        status: 'open',
        OR: [
          { subjectType: 'payment', subjectId: payment.id },
          { subjectType: 'bank_credit', subjectId: credit.id },
        ],
      },
    });
    for (const flag of openFlags) {
      await this.reviewFlagService.resolve(
        flag.id,
        { id: actorId, role: 'finance' },
        { status: 'resolved', resolution: 'Matched manually by Finance' },
      );
    }

    await this.auditService.log({
      actorId,
      action: 'payment.confirmed_manual',
      entityType: 'Payment',
      entityCode: payment.code,
      after: {
        paymentId: payment.id,
        bankCreditId: credit.id,
        bankUtr: credit.bankUtr,
        confirmedBy: 'finance_manual',
      },
    });

    return {
      success: true,
      paymentId: payment.id,
      bankCreditId: credit.id,
    };
  }

  async ignoreBankCredit(bankCreditId: string, reason: string, actorId: string) {
    if (!reason || !reason.trim()) {
      throw new BadRequestException('reason is required to ignore a bank credit');
    }
    const credit = await this.prisma.bankCredit.findUnique({
      where: { id: bankCreditId },
    });
    if (!credit) {
      throw new NotFoundException(`Bank credit '${bankCreditId}' not found`);
    }
    if (credit.status === 'matched') {
      throw new BadRequestException('Cannot ignore a matched bank credit');
    }

    const updated = await this.prisma.bankCredit.update({
      where: { id: credit.id },
      data: {
        status: 'ignored',
        ignoredReason: reason.trim(),
      },
    });

    const openFlags = await this.prisma.reviewFlag.findMany({
      where: {
        kind: 'payment_mismatch',
        status: 'open',
        subjectType: 'bank_credit',
        subjectId: credit.id,
      },
    });
    for (const flag of openFlags) {
      await this.reviewFlagService.resolve(
        flag.id,
        { id: actorId, role: 'finance' },
        { status: 'dismissed', resolution: reason.trim() },
      );
    }

    await this.auditService.log({
      actorId,
      action: 'bank_credit.ignored',
      entityType: 'BankCredit',
      entityCode: credit.bankUtr,
      before: { status: credit.status },
      after: { status: 'ignored', ignoredReason: reason.trim() },
    });

    return updated;
  }

  async listBankCredits(query?: { status?: string }) {
    const where: Prisma.BankCreditWhereInput = {};
    if (query?.status) {
      where.status = query.status;
    }
    return this.prisma.bankCredit.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      include: {
        enteredByStaff: {
          select: { id: true, code: true, name: true, role: true },
        },
      },
    });
  }

  async createReferralPayout(
    placementId: string,
    actorId?: string,
  ) {
    const placement = await this.prisma.placement.findUnique({
      where: { id: placementId },
      include: {
        jobSeeker: true,
      },
    });

    if (!placement) {
      throw new NotFoundException(`Placement '${placementId}' not found`);
    }

    if (!placement.jobSeeker?.referredById) {
      return null;
    }

    // Idempotency: a job seeker whose joined event somehow fires twice never produces two payouts
    const existing = await this.prisma.payment.findFirst({
      where: {
        type: 'referral_payout',
        placementId: placement.id,
      },
    });

    if (existing) {
      this.logger.log(
        `Referral payout already exists for placement ${placement.id} (payment: ${existing.id}). Idempotent no-op.`,
      );
      return existing;
    }

    const code = await this.idService.generateCode('payment');
    const timestamp = Date.now();
    const randomHex = Math.random().toString(36).substring(2, 8);
    const gatewayReference = `mock_payout_ref_${placement.id}_${timestamp}_${randomHex}`;

    const referralPayoutPaise = await this.getReferralPayoutPaise();

    const payment = await this.prisma.$transaction(async (tx) => {
      const p = await tx.payment.create({
        data: {
          code,
          city: placement.city,
          type: 'referral_payout',
          amount: referralPayoutPaise,
          status: 'pending',
          gatewayReference,
          subjectType: 'referral',
          subjectId: placement.jobSeeker.referredById!,
          referralId: placement.jobSeeker.referredById,
          placementId: placement.id,
          jobSeekerId: placement.jobSeekerId,
          businessId: placement.businessId,
        },
        include: {
          referral: true,
          jobSeeker: true,
          placement: true,
        },
      });

      await recordStatusChange(tx, {
        subjectType: 'payment',
        subjectId: p.id,
        fromStatus: null,
        toStatus: 'pending',
        changedByStaffId: actorId ?? null,
        reason: 'referral_payout_created',
      });

      return p;
    });

    let actor = actorId
      ? await this.prisma.staff.findUnique({ where: { id: actorId } })
      : null;
    if (!actor) {
      actor =
        (await this.prisma.staff.findFirst({ where: { role: 'ceo' } })) ??
        (await this.prisma.staff.findFirst());
    }

    if (actor) {
      await this.auditService.log({
        actorId: actor.id,
        action: 'referral_payout.created',
        entityType: 'Payment',
        entityCode: payment.code,
        after: {
          id: payment.id,
          code: payment.code,
          type: payment.type,
          amount: payment.amount,
          referralId: payment.referralId,
          placementId: payment.placementId,
          jobSeekerId: payment.jobSeekerId,
          status: payment.status,
        },
        city: payment.city,
      });
    }

    return payment;
  }

  /** Who audit rows for system-driven changes are attributed to (actorId must be a real staff row). */
  private async fallbackActorId(actorId?: string): Promise<string | null> {
    const actor =
      (actorId
        ? await this.prisma.staff.findUnique({ where: { id: actorId } })
        : null) ??
      (await this.prisma.staff.findFirst({ where: { role: 'ceo' } })) ??
      (await this.prisma.staff.findFirst());
    if (!actor) {
      // AuditLog.actorId is a foreign key to Staff, so there is nobody to
      // attribute this to. The money state change has already happened and must
      // stand, but a missing audit entry must never pass unnoticed.
      this.logger.error(
        'No staff account exists to attribute an audit entry to; the audit entry was NOT written',
      );
    }
    return actor?.id ?? null;
  }

  private async loadPayoutPayment(paymentId: string) {
    const payment = await this.prisma.payment.findUnique({
      where: { id: paymentId },
    });
    if (!payment) {
      throw new NotFoundException(`Payment '${paymentId}' not found`);
    }
    return payment;
  }

  async disbursePayout(
    paymentId: string,
    actorId?: string,
    options?: { simulateFailure?: boolean },
  ) {
    const payment = await this.loadPayoutPayment(paymentId);

    if (payment.status !== 'pending') {
      throw new BadRequestException(
        `Only pending payments can be disbursed. Current status: '${payment.status}'`,
      );
    }

    return this.dispatchPayout(payment, ['pending'], 'payout_release', actorId, options);
  }

  /**
   * Re-sends a payout that definitively failed (or was reversed). CEO/Manager
   * only. It goes through the same atomic claim as a first disbursement, and
   * uses a NEW idempotency key: reusing the old one would make the gateway
   * hand back the original failed payout instead of creating a new one.
   *
   * A payout stuck in `processing` is deliberately not retryable: it may have
   * been paid, so it has to be resolved against the gateway's records first.
   */
  async retryPayout(paymentId: string, actorId: string) {
    const payment = await this.loadPayoutPayment(paymentId);

    if (payment.payoutAttempts < 1) {
      throw new BadRequestException('This payment has never been sent as a payout');
    }
    if (payment.status !== 'failed' && payment.status !== 'reversed') {
      throw new BadRequestException(
        payment.status === 'processing'
          ? 'Payout is still processing; it may already have been paid. Reconcile it against the gateway and resolve it instead of retrying.'
          : `Only failed or reversed payouts can be retried. Current status: '${payment.status}'`,
      );
    }
    if (payment.payoutAttempts >= MAX_PAYOUT_ATTEMPTS) {
      throw new BadRequestException(
        `Payout has already been attempted ${payment.payoutAttempts} times; escalate instead of retrying`,
      );
    }

    return this.dispatchPayout(payment, ['failed', 'reversed'], 'payout_retry', actorId);
  }

  /**
   * The one place a payout reaches the gateway. The claim is a single
   * conditional update checked by affected-row count, so of any number of
   * concurrent callers exactly one gets through (AGENTS.md §2 rule 7).
   */
  private async dispatchPayout(
    payment: Payment,
    claimableFrom: string[],
    action: 'payout_release' | 'payout_retry',
    actorId?: string,
    options?: { simulateFailure?: boolean },
  ) {
    const before = {
      status: payment.status,
      gatewayReference: payment.gatewayReference,
      payoutAttempts: payment.payoutAttempts,
    };

    const claim = await this.prisma.$transaction(async (tx) => {
      const c = await tx.payment.updateMany({
        where: {
          id: payment.id,
          status: { in: claimableFrom },
          payoutAttempts: { lt: MAX_PAYOUT_ATTEMPTS },
        },
        data: { status: 'processing', payoutAttempts: { increment: 1 } },
      });
      if (c.count === 1) {
        await recordStatusChange(tx, {
          subjectType: 'payment',
          subjectId: payment.id,
          fromStatus: payment.status,
          toStatus: 'processing',
          changedByStaffId: actorId ?? null,
          reason: 'payout_dispatched',
        });
      }
      return c;
    });
    if (claim.count !== 1) {
      throw new BadRequestException(
        'Payout is already being processed or is no longer in a state that can be sent',
      );
    }
    // We hold the claim, so this attempt number is ours alone.
    const claimed = await this.prisma.payment.findUniqueOrThrow({
      where: { id: payment.id },
    });
    const attempt = claimed.payoutAttempts;

    // If the provider throws, whether the gateway moved money is unknown, so the
    // payment is deliberately left in 'processing' (not released back to
    // 'pending') for a human to reconcile rather than risk a second payout.
    const result = await this.provider.disbursePayout(
      payment.amount,
      payment.subjectType,
      payment.subjectId,
      { ...options, paymentId: payment.id, attempt },
    );

    // Conditional on still being 'processing': the gateway's webhook can land
    // before this response is written, and a stale result must not overwrite it.
    const data: Prisma.PaymentUpdateManyMutationInput = {};
    if (result.status !== 'processing') data.status = result.status;
    if (result.gatewayReference) data.gatewayReference = result.gatewayReference;
    if (Object.keys(data).length > 0) {
      await this.prisma.$transaction(async (tx) => {
        await tx.payment.updateMany({
          where: { id: payment.id, status: 'processing' },
          data,
        });
        if (data.status) {
          await recordStatusChange(tx, {
            subjectType: 'payment',
            subjectId: payment.id,
            fromStatus: 'processing',
            toStatus: data.status as string,
            changedByStaffId: actorId ?? null,
            reason: `payout_result_${data.status}`,
          });
        }
      });
    }

    const updatedPayment = await this.prisma.payment.findUniqueOrThrow({
      where: { id: payment.id },
      include: {
        jobSeeker: true,
        business: true,
        placement: true,
        referral: true,
      },
    });

    const auditActor = await this.fallbackActorId(actorId);
    if (auditActor) {
      await this.auditService.log({
        actorId: auditActor,
        action,
        entityType: 'Payment',
        entityCode: updatedPayment.code,
        before,
        after: {
          id: updatedPayment.id,
          code: updatedPayment.code,
          status: updatedPayment.status,
          amount: updatedPayment.amount,
          gatewayReference: updatedPayment.gatewayReference,
          payoutAttempts: updatedPayment.payoutAttempts,
          gatewayResult: result.status,
          ambiguous: result.ambiguous ?? false,
          failureReason: result.failureReason,
        },
        city: updatedPayment.city,
      });
    }

    return updatedPayment;
  }

  /**
   * Settles a payout stuck in `processing` once someone has checked the
   * gateway's own records (dashboard / Fetch Payout). CEO/Manager only.
   * `succeeded` needs the gateway's payout id as proof; both outcomes need a
   * note saying what was checked. Always audit-logged.
   */
  async resolvePayout(
    paymentId: string,
    actorId: string,
    dto: { outcome?: unknown; gatewayReference?: unknown; note?: unknown },
  ) {
    const outcome = dto?.outcome;
    if (outcome !== 'succeeded' && outcome !== 'failed') {
      throw new BadRequestException("outcome must be 'succeeded' or 'failed'");
    }
    const note = typeof dto.note === 'string' ? dto.note.trim() : '';
    if (!note) {
      throw new BadRequestException(
        'note is required: record what was checked against the gateway',
      );
    }
    const gatewayReference =
      typeof dto.gatewayReference === 'string' ? dto.gatewayReference.trim() : '';
    if (outcome === 'succeeded' && !gatewayReference) {
      throw new BadRequestException(
        "gatewayReference (the gateway's payout id) is required to resolve as succeeded",
      );
    }

    const payment = await this.loadPayoutPayment(paymentId);
    if (payment.status !== 'processing') {
      throw new BadRequestException(
        `Only a payout stuck in 'processing' can be resolved. Current status: '${payment.status}'`,
      );
    }

    let claimed: { count: number };
    try {
      claimed = await this.prisma.$transaction(async (tx) => {
        const c = await tx.payment.updateMany({
          where: { id: payment.id, status: 'processing' },
          data: {
            status: outcome,
            ...(gatewayReference ? { gatewayReference } : {}),
          },
        });
        if (c.count === 1) {
          await recordStatusChange(tx, {
            subjectType: 'payment',
            subjectId: payment.id,
            fromStatus: payment.status,
            toStatus: outcome,
            changedByStaffId: actorId ?? null,
            reason: note,
          });
        }
        return c;
      });
    } catch (err) {
      if ((err as { code?: string }).code === 'P2002') {
        throw new BadRequestException(
          'That gatewayReference is already recorded against another payment',
        );
      }
      throw err;
    }
    if (claimed.count !== 1) {
      throw new BadRequestException(
        'Payout was settled by someone else while resolving; reload it',
      );
    }

    const updated = await this.prisma.payment.findUniqueOrThrow({
      where: { id: payment.id },
    });
    const auditActor = await this.fallbackActorId(actorId);
    if (auditActor) {
      await this.auditService.log({
        actorId: auditActor,
        action: 'payout_resolved_manually',
        entityType: 'Payment',
        entityCode: updated.code,
        before: {
          status: payment.status,
          gatewayReference: payment.gatewayReference,
        },
        after: {
          status: updated.status,
          gatewayReference: updated.gatewayReference,
          amount: updated.amount,
          reconciliationNote: note,
        },
        city: updated.city,
      });
    }
    return updated;
  }

  /**
   * RazorpayX payout-status webhook. Authenticated by signature over the raw
   * body, idempotent per event id (AGENTS.md §2 rule 7), and safe against
   * events arriving out of order (see payout-state.ts).
   */
  async handlePayoutWebhook(
    rawBody: Buffer | string | undefined,
    signature?: string,
    eventIdHeader?: string,
  ) {
    if (rawBody === undefined) {
      // Re-serialising the parsed body would not match what the gateway signed.
      throw new BadRequestException('Raw request body unavailable');
    }

    const event = await this.provider.verifyPayoutWebhook(rawBody, signature);
    if (!event.isValid) {
      throw new BadRequestException('Invalid webhook signature or payload');
    }
    if (event.outcome === 'unknown' || !event.payoutId) {
      return { received: true, ignored: 'not_a_payout_status_event', event: event.event };
    }
    // narrowed above; captured so the narrowing survives into the transaction callback
    const outcome = event.outcome;

    const payment =
      (await this.prisma.payment.findUnique({
        where: { gatewayReference: event.payoutId },
      })) ??
      (event.paymentIdHint
        ? await this.prisma.payment.findUnique({ where: { id: event.paymentIdHint } })
        : null);

    if (!payment || payment.payoutAttempts < 1) {
      this.logger.warn(
        `Payout webhook ${event.event} for ${event.payoutId} matches no dispatched payout`,
      );
      return { received: true, matched: false };
    }

    if (event.amountPaise !== undefined && event.amountPaise !== payment.amount) {
      this.logger.error(
        `Payout webhook amount ${event.amountPaise} does not match payment ${payment.code} amount ${payment.amount}; ignoring`,
      );
      return { received: true, ignored: 'amount_mismatch', paymentId: payment.id };
    }

    const eventId =
      eventIdHeader?.trim() ||
      `body:${createHash('sha256').update(rawBody).digest('hex')}`;

    const applied = await this.prisma.$transaction(async (tx) => {
      // ON CONFLICT DO NOTHING: a redelivery (or a concurrent twin) inserts 0 rows
      const inserted = await tx.payoutWebhookEvent.createMany({
        data: [
          {
            eventId,
            event: event.event,
            outcome,
            paymentId: payment.id,
          },
        ],
        skipDuplicates: true,
      });
      if (inserted.count === 0) return { duplicate: true as const };

      // Serialise events for the same payout, then decide from the live status
      const rows = await tx.$queryRaw<Array<{ status: string; gatewayReference: string }>>`
        SELECT "status", "gatewayReference" FROM "Payment" WHERE "id" = ${payment.id} FOR UPDATE`;
      const current = rows[0];
      const transition = resolveWebhookTransition(current.status, outcome);

      const data: Prisma.PaymentUpdateInput = {};
      if (transition.next) data.status = transition.next;
      if (
        transition.reason !== 'not_dispatched' &&
        transition.reason !== 'terminal' &&
        current.gatewayReference !== event.payoutId
      ) {
        data.gatewayReference = event.payoutId;
      }
      if (Object.keys(data).length > 0) {
        await tx.payment.update({ where: { id: payment.id }, data });
      }
      if (transition.next) {
        await recordStatusChange(tx, {
          subjectType: 'payment',
          subjectId: payment.id,
          fromStatus: current.status,
          toStatus: transition.next,
          changedByStaffId: null,
          reason: `payout_webhook_${event.event}`,
        });
        await tx.payoutWebhookEvent.update({
          where: { eventId },
          data: { applied: true },
        });
      }
      return { duplicate: false as const, from: current.status, transition };
    });

    if (applied.duplicate) {
      return { received: true, duplicate: true, paymentId: payment.id };
    }

    const { transition, from } = applied;
    if (transition.next) {
      const auditActor = await this.fallbackActorId();
      if (auditActor) {
        await this.auditService.log({
          actorId: auditActor,
          action: 'payout_status_webhook',
          entityType: 'Payment',
          entityCode: payment.code,
          before: { status: from },
          after: {
            status: transition.next,
            source: 'razorpayx_webhook',
            event: event.event,
            eventId,
            gatewayStatus: event.gatewayStatus,
            payoutId: event.payoutId,
            utr: event.utr ?? null,
            failureReason: event.failureReason ?? null,
            // the gateway overruled an earlier "failed" we had recorded
            correction: from === 'failed' && transition.next === 'succeeded',
          },
          city: payment.city,
        });
      }
    }

    return {
      received: true,
      paymentId: payment.id,
      applied: transition.next !== null,
      status: transition.next ?? from,
      reason: transition.reason,
    };
  }

  async findAll(filters?: PaymentFilterDto) {
    const where: Prisma.PaymentWhereInput = {};

    if (filters?.type) {
      where.type = filters.type;
    }

    if (filters?.status) {
      where.status = filters.status;
    }

    const from = filters?.fromDate ?? filters?.startDate;
    const to = filters?.toDate ?? filters?.endDate;

    if (from || to) {
      const createdAt: Prisma.DateTimeFilter = {};
      if (from) {
        createdAt.gte = new Date(from);
      }
      if (to) {
        createdAt.lte = new Date(to);
      }
      where.createdAt = createdAt;
    }

    return this.prisma.payment.findMany({
      where,
      include: {
        jobSeeker: true,
        business: true,
        placement: true,
        referral: true,
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  async findById(id: string) {
    const payment = await this.prisma.payment.findUnique({
      where: { id },
      include: {
        jobSeeker: true,
        business: true,
        placement: true,
        referral: true,
      },
    });
    if (!payment) {
      throw new NotFoundException(`Payment '${id}' not found`);
    }
    return payment;
  }
}
