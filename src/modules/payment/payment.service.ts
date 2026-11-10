import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  Optional,
  UnauthorizedException,
} from '@nestjs/common';
import { PayoutAccount, Prisma } from '@prisma/client';
import { PrismaService } from '../../common/prisma/prisma.service';
import { AuditService } from '../../common/audit/audit.service';
import { IdService } from '../../common/id/id.service';
import { PricingService } from '../pricing/pricing.service';
import { PaymentFilterDto } from './dto/payment-filter.dto';
import { RecordPayoutDto } from './dto/record-payout.dto';
import { matchReceiverName } from '../payout-account/name-matcher';
import { evaluateJobSeekerRefundEligibility } from '../job-seeker/job-seeker-refund-eligibility';
import { evaluatePlacementRefundEligibility } from '../placement/placement-refund-eligibility';
import { PublicLinkStoreService } from '../../common/public-link-store.service';
import { decryptPayoutValue } from '../payout-account/payout-account-key';
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
import { recordStatusChange } from '../../common/status-history/status-history.helper';
import { MessagingService } from '../message/messaging.service';
import { publicLink } from '../../common/public-link';

@Injectable()
export class PaymentService {
  private readonly logger = new Logger(PaymentService.name);
  private readonly publicLinks: PublicLinkStoreService;

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
    @Optional() publicLinkStore?: PublicLinkStoreService,
  ) {
    this.publicLinks = publicLinkStore ?? new PublicLinkStoreService(prisma);
  }

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

  async payByCard(token: string) {
    const payment = await this.prisma.payment.findUnique({
      where: { upiReference: token },
    });
    if (!payment) {
      throw new NotFoundException(`Payment with reference '${token}' not found`);
    }
    if (payment.status !== 'pending') {
      throw new BadRequestException(`Payment is already '${payment.status}'`);
    }

    if (payment.method === 'gateway_card' && payment.gatewayReference) {
      return {
        paymentId: payment.id,
        gatewayReference: payment.gatewayReference,
        paymentLink: `https://pay.laboura.local/pay/${payment.gatewayReference}`,
      };
    }

    const charge = await this.createCharge(
      payment.expectedAmountPaise ?? payment.amount,
      payment.subjectType,
      payment.subjectId,
    );

    await this.prisma.$transaction(async (tx) => {
      await tx.payment.update({
        where: { id: payment.id },
        data: {
          method: 'gateway_card',
          gatewayReference: charge.gatewayReference,
        },
      });
      await recordStatusChange(tx, {
        subjectType: 'payment',
        subjectId: payment.id,
        fromStatus: payment.status,
        toStatus: payment.status,
        reason: 'switched_to_gateway_card',
      });
    });

    return {
      paymentId: payment.id,
      gatewayReference: charge.gatewayReference,
      paymentLink: charge.paymentLink,
    };
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
      throw new UnauthorizedException(
        `Invalid or missing webhook signature${verification.reason ? ` (${verification.reason})` : ''}`,
      );
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
        invoiceCode: string;
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
          let invoiceCode = placement.invoiceCode;
          if (!invoiceCode) {
            invoiceCode = await this.idService.generateCode('invoice');
            if (tx.placement.update) {
              await tx.placement.update({
                where: { id: placement.id },
                data: { invoiceCode },
              });
            } else {
              await tx.placement.updateMany({
                where: { id: placement.id },
                data: { invoiceCode },
              });
            }
          }
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
          placementTransition = { placement, invoiceCode };
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
      const receiptLink = publicLink(`/payments/${paymentId}/receipt`);
      await Promise.all((['sms', 'whatsapp'] as const).map((channel) => this.messagingService.send({
        channel, template: 'payment_receipt', subjectType: 'job_seeker',
        subjectId: transition.updatedSeeker!.id, relatedType: 'payment', relatedId: paymentId,
        variables: { link: receiptLink },
      })));
    }
    if (transition.placementTransition) {
      const { placement, invoiceCode } = transition.placementTransition;
      const actorId = await this.fallbackActorId();
      if (actorId) await this.auditService.log({
        actorId, action: 'placement_fee_paid', entityType: 'Placement', entityCode: placement.code,
        city: placement.city,
        before: { status: 'awaiting_payment', jobSeekerStatus: placement.jobSeeker.status },
        after: { status: 'confirmed', paidAt: confirmedAt.toISOString(), jobSeekerStatus: 'placed', paymentId, invoiceCode },
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
      const invoiceLink = publicLink(`/placements/${placement.id}/invoice`);
      await Promise.all((['sms', 'whatsapp'] as const).map((channel) => this.messagingService.send({
        channel, template: 'placement_invoice', subjectType: 'business',
        subjectId: placement.businessId, relatedType: 'placement', relatedId: placement.id,
        variables: { link: invoiceLink, invoiceCode },
      })));
    }
    return { received: true, status: 'succeeded', paymentId };
  }

  async handleBankFeedWebhook(rawBody: Buffer | string | undefined, signature?: string) {
    const verification = await this.bankFeedProvider.verifyWebhook(rawBody, signature);
    if (!verification.isValid || !verification.event) {
      throw new UnauthorizedException(
        `Invalid or missing bank feed webhook signature${verification.reason ? ` (${verification.reason})` : ''}`,
      );
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

    const candidatePayments = await this.prisma.payment.findMany({
      where: {
        upiReference: { not: null },
      },
    });

    const matchedPayment = candidatePayments.find(
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

    if (
      matchedPayment.type === 'activation'
      && matchedPayment.method !== 'gateway_card'
      && matchedPayment.status === 'succeeded'
      && matchedPayment.jobSeekerId
      && amountPaise === (matchedPayment.expectedAmountPaise ?? matchedPayment.amount)
    ) {
      return this.refundDuplicateActivationPayment(matchedPayment, credit.id, bankUtr, amountPaise);
    }

    if (matchedPayment.method === 'gateway_card' || matchedPayment.status === 'succeeded') {
      await this.reviewFlagService.raise({
        kind: 'payment_mismatch',
        subjectType: 'payment',
        subjectId: matchedPayment.id,
        details: {
          bankCreditId: credit.id,
          bankUtr,
          amountPaise,
          paymentMethod: matchedPayment.method,
          paymentStatus: matchedPayment.status,
          reason: matchedPayment.method === 'gateway_card' ? 'switched_to_card' : 'already_succeeded',
        },
      });
      return {
        received: true,
        status: 'unmatched',
        reason: matchedPayment.method === 'gateway_card' ? 'switched_to_card' : 'already_succeeded',
        bankCreditId: credit.id,
        paymentId: matchedPayment.id,
      };
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

  /**
   * Phase 20 Task 5: when a second ₹499 activation payment arrives for the same job seeker (for example he and his
   * brother both pay), the later one is refunded automatically. The refund is created already approved — it needs no
   * one's decision — and Finance sends it from the company account and records the UTR, like every refund.
   */
  private async refundDuplicateActivationPayment(
    original: { id: string; code: string; city: string; jobSeekerId: string | null },
    bankCreditId: string,
    bankUtr: string,
    amountPaise: number,
  ) {
    const code = await this.idService.generateCode('payment');
    const refund = await this.prisma.$transaction(async (tx) => {
      const created = await tx.payment.create({
        data: {
          code,
          city: original.city,
          type: 'duplicate_refund',
          amount: amountPaise,
          status: 'approved',
          approvedAt: new Date(),
          subjectType: 'job_seeker',
          subjectId: original.jobSeekerId!,
          jobSeekerId: original.jobSeekerId,
          payerUtrHint: bankUtr,
        },
      });
      await tx.bankCredit.update({
        where: { id: bankCreditId },
        data: { status: 'matched', matchedPaymentId: created.id },
      });
      await recordStatusChange(tx, {
        subjectType: 'payment',
        subjectId: created.id,
        fromStatus: null,
        toStatus: 'approved',
        changedByStaffId: 'system',
        reason: 'duplicate_activation_payment',
      });
      return created;
    });
    await this.auditService.log({
      actorId: 'system',
      action: 'payment.duplicate_activation_refund_created',
      entityType: 'Payment',
      entityCode: refund.code,
      after: { originalPaymentCode: original.code, amountPaise, bankUtr, status: 'approved' },
      changedFields: ['type', 'amount', 'status'],
      city: original.city,
    });
    return {
      received: true,
      status: 'duplicate_refund_created',
      paymentId: original.id,
      refundPaymentId: refund.id,
      bankCreditId,
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

    await this.prisma.reviewFlag.updateMany({
      where: {
        kind: 'payment_mismatch',
        status: 'open',
        OR: [
          { subjectType: 'payment', subjectId: payment.id },
          { subjectType: 'bank_credit', subjectId: credit.id },
        ],
      },
      data: {
        status: 'resolved',
        resolution: 'Matched manually by Finance',
        resolvedAt: new Date(),
        resolvedByStaffId: actorId,
      },
    });

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

    await this.prisma.reviewFlag.updateMany({
      where: {
        kind: 'payment_mismatch',
        status: 'open',
        subjectType: 'bank_credit',
        subjectId: credit.id,
      },
      data: {
        status: 'dismissed',
        resolution: reason.trim(),
        resolvedAt: new Date(),
        resolvedByStaffId: actorId,
      },
    });

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

  async listPaymentMismatchFlags(status: string = 'open') {
    const where: Prisma.ReviewFlagWhereInput = {
      kind: {
        in: [
          'payment_mismatch',
          'payout_shared_account',
          'payout_matches_staff',
          'payout_name_mismatch',
        ],
      },
    };
    if (status) {
      where.status = status;
    }
    return this.prisma.reviewFlag.findMany({
      where,
      orderBy: { raisedAt: 'desc' },
      include: {
        raisedForStaff: { select: { id: true, code: true, name: true, role: true } },
        resolvedByStaff: { select: { id: true, code: true, name: true, role: true } },
      },
    });
  }

  async resolvePaymentMismatchFlag(flagId: string, resolution: string, actorId: string) {
    if (!resolution || !resolution.trim()) {
      throw new BadRequestException('A written resolution is required');
    }
    const flag = await this.prisma.reviewFlag.findUnique({ where: { id: flagId } });
    const allowedKinds = [
      'payment_mismatch',
      'payout_shared_account',
      'payout_matches_staff',
      'payout_name_mismatch',
    ];
    if (!flag || !allowedKinds.includes(flag.kind)) {
      throw new NotFoundException(`Payment mismatch flag '${flagId}' not found`);
    }
    const updated = await this.prisma.reviewFlag.update({
      where: { id: flagId },
      data: {
        status: 'resolved',
        resolution: resolution.trim(),
        resolvedAt: new Date(),
        resolvedByStaffId: actorId,
      },
      include: {
        raisedForStaff: { select: { id: true, code: true, name: true, role: true } },
        resolvedByStaff: { select: { id: true, code: true, name: true, role: true } },
      },
    });
    await this.auditService.log({
      actorId,
      action: 'review_flag.resolved',
      entityType: 'review_flag',
      entityCode: flag.code,
      before: { status: flag.status, resolution: flag.resolution },
      after: { status: updated.status, resolution: updated.resolution },
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
    const referralPayoutPaise = await this.getReferralPayoutPaise();

    const payment = await this.prisma.$transaction(async (tx) => {
      const p = await tx.payment.create({
        data: {
          code,
          city: placement.city,
          type: 'referral_payout',
          amount: referralPayoutPaise,
          status: 'pending',
          gatewayReference: null,
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

    // Phase 18 Task 4: Automatically queue payout details link for referral partner if no account
    if (placement.jobSeeker.referredById) {
      const auditStaffId = await this.fallbackActorId(actorId);
      await this.sendPayoutDetailsLinkIfNoAccount(
        'referral',
        placement.jobSeeker.referredById,
        auditStaffId ?? actorId ?? 'system',
        'system',
      );
    }

    return payment;
  }

  async sendPayoutDetailsLinkIfNoAccount(
    ownerType: 'referral' | 'job_seeker' | 'business',
    ownerId: string,
    actorId: string,
    actorRole = 'system',
    now = new Date(),
  ): Promise<{ linkSent: boolean; reason?: string }> {
    const existing = await this.prisma.payoutAccount.findFirst({
      where: {
        ownerType,
        ownerId,
        status: { not: 'superseded' },
      },
    });
    if (existing) {
      return { linkSent: false, reason: 'account_exists' };
    }

    if (await this.publicLinks.hasActive('payout_details', ownerType, ownerId, now)) {
      return { linkSent: false, reason: 'link_already_active' };
    }

    let ownerName: string;
    let phone: string;
    if (ownerType === 'job_seeker') {
      const js = await this.prisma.jobSeeker.findUnique({
        where: { id: ownerId },
        select: { id: true, name: true, phone: true },
      });
      if (!js) throw new NotFoundException(`Job seeker '${ownerId}' not found`);
      ownerName = js.name;
      phone = js.phone;
    } else if (ownerType === 'referral') {
      const ref = await this.prisma.referral.findUnique({
        where: { id: ownerId },
        select: { id: true, name: true, phone: true },
      });
      if (!ref) throw new NotFoundException(`Referral '${ownerId}' not found`);
      ownerName = ref.name;
      phone = ref.phone;
    } else if (ownerType === 'business') {
      const biz = await this.prisma.business.findUnique({
        where: { id: ownerId },
        select: { id: true, name: true, phone: true },
      });
      if (!biz) throw new NotFoundException(`Business '${ownerId}' not found`);
      ownerName = biz.name;
      phone = biz.phone;
    } else {
      throw new BadRequestException(`Invalid ownerType '${ownerType}'`);
    }

    const expiresAt = new Date(now.getTime() + 24 * 60 * 60 * 1000);
    const { token, id } = await this.publicLinks.create({
      purpose: 'payout_details', subjectType: ownerType, subjectId: ownerId,
      phone, expiresAt, metadata: { ownerName },
    });

    await this.messagingService.send({
      channel: 'sms',
      template: 'payout_details_link',
      subjectType: ownerType,
      subjectId: ownerId,
      variables: {
        token,
        link: publicLink(`/payout-accounts/link/${token}`),
      },
    });

    const auditStaffId = await this.fallbackActorId(actorId);

    await this.auditService.log({
      action: 'payout_link_created',
      entityType: 'PayoutAccount',
      entityCode: id,
      actorId: auditStaffId ?? actorId,
      after: {
        ownerType,
        ownerId,
        actorRole,
      },
    });

    return { linkSent: true };
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

  async approvePayment(paymentId: string, actorId: string, asOf?: Date | string) {
    const payment = await this.loadPayoutPayment(paymentId);

    if (payment.status !== 'pending') {
      throw new BadRequestException(`Payment cannot be approved from status '${payment.status}'`);
    }

    const now = asOf ? new Date(asOf) : new Date();

    if (payment.type === 'referral_payout') {
      const referralId = payment.referralId || payment.subjectId;
      const termsConsent = await this.prisma.consent.findFirst({
        where: {
          subjectType: 'referral',
          subjectId: referralId,
          purpose: 'agreement_terms',
          granted: true,
          grantedAt: { not: null },
          withdrawnAt: null,
        },
      });
      if (!termsConsent) {
        throw new BadRequestException('Referral partner has not signed agreement terms');
      }
    } else if (payment.type === 'refund') {
      if (payment.jobSeekerId || payment.subjectType === 'job_seeker') {
        const jsId = payment.jobSeekerId || payment.subjectId;
        const jobSeeker = await this.prisma.jobSeeker.findUnique({
          where: { id: jsId },
        });
        if (!jobSeeker) {
          throw new NotFoundException(`Job seeker '${jsId}' not found`);
        }

        const hasOfferRejected = await this.prisma.jobSeekerHit.findFirst({
          where: {
            jobSeekerId: jobSeeker.id,
            reason: { in: ['offer_declined', 'offer_no_reply', 'interview_no_show', 'offer_rejected'] },
            reversedAt: null,
          },
        });

        const withdrawnConsent = jobSeeker.paymentReceivedAt && this.prisma.consent
          ? await this.prisma.consent.findFirst({
              where: {
                subjectType: 'job_seeker',
                subjectId: jobSeeker.id,
                purpose: { in: ['job_matching', 'profile_sharing', 'call_recording'] },
                withdrawnAt: { not: null, gte: jobSeeker.paymentReceivedAt },
              },
            })
          : null;

        const openBypassFlag = await this.prisma.reviewFlag.findFirst({
          where: {
            subjectType: 'job_seeker',
            subjectId: jobSeeker.id,
            kind: 'bypass_suspected',
            status: 'open',
          },
        });

        const bypassFollowUp = await this.prisma.followUpTask.findFirst({
          where: {
            subjectType: 'job_seeker',
            subjectId: jobSeeker.id,
            kind: 'refund_check',
            answer: 'working_at_introduced_business',
          },
        });

        const policy = await this.pricingService.current();
        const activationPayment = await this.prisma.payment.findFirst({
          where: {
            jobSeekerId: jobSeeker.id,
            type: { in: ['activation', 'reactivation'] },
            status: { in: ['completed', 'succeeded'] },
          },
          orderBy: { createdAt: 'desc' },
        });

        const eligibility = evaluateJobSeekerRefundEligibility(
          {
            code: jobSeeker.code,
            paymentReceivedAt: jobSeeker.paymentReceivedAt,
            status: jobSeeker.status,
            hasOfferRejectedHit: Boolean(hasOfferRejected),
            hasExistingRefund: false,
            activationPaymentPaise: activationPayment?.amount,
            guaranteeDays: policy.jobSeekerGuaranteeDays,
            hasWithdrawnEssentialConsent: Boolean(withdrawnConsent),
            hasOpenBypassFlag: Boolean(openBypassFlag),
            hasWorkingAtIntroducedBusinessFollowUp: Boolean(bypassFollowUp),
          },
          now,
        );

        if (!eligibility.eligible) {
          throw new BadRequestException(eligibility.ineligibleReason!);
        }
      } else if (payment.placementId || payment.subjectType === 'placement') {
        const placementId = payment.placementId || payment.subjectId;
        const placement = await this.prisma.placement.findUnique({
          where: { id: placementId },
          include: { replacementCandidates: true },
        });
        if (!placement) {
          throw new NotFoundException(`Placement '${placementId}' not found`);
        }

        const rootId = placement.rootPlacementId ?? placement.id;
        const rootPlacement = placement.rootPlacementId
          ? await this.prisma.placement.findUniqueOrThrow({
              where: { id: rootId },
              include: { replacementCandidates: true },
            })
          : placement;

        const selectedReplacement = await this.prisma.placement.findFirst({
          where: {
            rootPlacementId: rootId,
            replacementNumber: { gt: 0 },
            status: { in: ['confirmed', 'active', 'completed'] },
          },
        });
        const hasAcceptedReplacement = Boolean(
          selectedReplacement ||
            placement.replacementCandidates.some((rc) => rc.status === 'accepted') ||
            rootPlacement.replacementCandidates?.some((rc) => rc.status === 'accepted'),
        );

        const claim = await this.prisma.replacementClaim.findFirst({
          where: {
            placement: { OR: [{ id: rootId }, { rootPlacementId: rootId }] },
            decision: 'accepted',
          },
          orderBy: { decidedAt: 'desc' },
        });

        const claimAcceptedAt = claim?.decidedAt ?? claim?.reportedAt ?? placement.dropoutReportedAt;
        const policy = await this.pricingService.current();

        const eligibility = evaluatePlacementRefundEligibility(
          {
            code: rootPlacement.code,
            status: placement.status,
            hasAcceptedReplacement,
            hasSelectedReplacement: Boolean(selectedReplacement),
            claimAcceptedAt,
            dropoutReportedAt: placement.dropoutReportedAt,
            placementFee: rootPlacement.placementFee,
            hasExistingRefund: false,
            searchDays: policy.replacementSearchDays,
            guaranteeEndedReason: rootPlacement.guaranteeEndedReason,
          },
          now,
        );

        if (!eligibility.eligible) {
          throw new BadRequestException(eligibility.ineligibleReason!);
        }
      }
    } else if (payment.type === 'joining_reward') {
      const placementId = payment.placementId;
      if (placementId) {
        const placement = await this.prisma.placement.findUnique({
          where: { id: placementId },
        });
        if (!placement || ['cancelled', 'dropped_out'].includes(placement.status)) {
          throw new BadRequestException('Placement is no longer active for joining reward');
        }
      }
    }

    const updated = await this.prisma.payment.update({
      where: { id: payment.id },
      data: {
        status: 'approved',
        approvedByStaffId: actorId,
        approvedAt: now,
      },
    });

    await recordStatusChange(this.prisma, {
      subjectType: 'payment',
      subjectId: payment.id,
      fromStatus: payment.status,
      toStatus: 'approved',
      changedByStaffId: actorId,
      reason: 'payment_approved',
    });

    await this.auditService.log({
      actorId,
      action: 'payment_approved',
      entityType: 'payment',
      entityCode: payment.code,
      before: { status: payment.status },
      after: { status: 'approved', approvedByStaffId: actorId, approvedAt: now.toISOString() },
      changedFields: ['status', 'approvedByStaffId', 'approvedAt'],
      reason: 'Payment approved by CEO or Finance',
    });

    // Phase 18 Task 4: When a refund becomes owed/approved and receiver has no account, send link
    if (payment.type === 'refund') {
      const receiverOwnerType =
        payment.jobSeekerId || payment.subjectType === 'job_seeker' ? 'job_seeker' : 'business';
      let receiverOwnerId: string;
      if (receiverOwnerType === 'job_seeker') {
        receiverOwnerId = payment.jobSeekerId || payment.subjectId;
      } else {
        if (payment.businessId) {
          receiverOwnerId = payment.businessId;
        } else if (payment.placementId) {
          const pl = await this.prisma.placement.findUnique({ where: { id: payment.placementId } });
          receiverOwnerId = pl?.businessId || payment.subjectId;
        } else {
          receiverOwnerId = payment.subjectId;
        }
      }
      await this.sendPayoutDetailsLinkIfNoAccount(
        receiverOwnerType,
        receiverOwnerId,
        actorId,
        'system',
        now,
      );
    }

    return updated;
  }

  async recordPayout(paymentId: string, actorId: string, dto: RecordPayoutDto) {
    if (!dto.bankUtr || !dto.bankUtr.trim()) {
      throw new BadRequestException('bankUtr is required');
    }
    if (!dto.receiverNameShown || !dto.receiverNameShown.trim()) {
      throw new BadRequestException('receiverNameShown is required');
    }

    const bankUtr = dto.bankUtr.trim();
    const receiverNameShown = dto.receiverNameShown.trim();
    const paidAtDate = dto.paidAt ? new Date(dto.paidAt) : new Date();

    const payment = await this.loadPayoutPayment(paymentId);

    // 1. Must be approved first
    if (payment.status !== 'approved') {
      throw new BadRequestException(
        `Payment cannot be marked paid without being approved first. Current status: '${payment.status}'`,
      );
    }

    // 2. bankUtr must be unique across all payments
    const existingUtr = await this.prisma.payment.findFirst({
      where: { bankUtr },
    });
    if (existingUtr && existingUtr.id !== payment.id) {
      throw new BadRequestException(`Bank UTR '${bankUtr}' has already been used on payment '${existingUtr.code}'`);
    }

    // 3. Resolve payout account
    let ownerType: string;
    let ownerId: string;

    if (payment.type === 'referral_payout') {
      ownerType = 'referral';
      ownerId = payment.referralId || payment.subjectId;
    } else if (payment.type === 'joining_reward') {
      ownerType = 'job_seeker';
      ownerId = payment.jobSeekerId || payment.subjectId;
    } else if (payment.type === 'refund') {
      if (payment.jobSeekerId || payment.subjectType === 'job_seeker') {
        ownerType = 'job_seeker';
        ownerId = payment.jobSeekerId || payment.subjectId;
      } else {
        ownerType = 'business';
        if (payment.businessId) {
          ownerId = payment.businessId;
        } else if (payment.placementId) {
          const pl = await this.prisma.placement.findUnique({ where: { id: payment.placementId } });
          ownerId = pl?.businessId || payment.subjectId;
        } else {
          ownerId = payment.subjectId;
        }
      }
    } else {
      ownerType = payment.subjectType;
      ownerId = payment.subjectId;
    }

    let account: PayoutAccount | null = null;
    if (dto.payoutAccountId) {
      account = await this.prisma.payoutAccount.findUnique({
        where: { id: dto.payoutAccountId },
      });
      if (!account || account.ownerType !== ownerType || account.ownerId !== ownerId) {
        throw new BadRequestException(`Specified payout account does not belong to receiver`);
      }
    } else if (payment.payoutAccountId) {
      account = await this.prisma.payoutAccount.findUnique({
        where: { id: payment.payoutAccountId },
      });
    }

    if (!account) {
      account = await this.prisma.payoutAccount.findFirst({
        where: {
          ownerType,
          ownerId,
          status: { not: 'superseded' },
        },
        orderBy: { createdAt: 'desc' },
      });
    }

    if (!account) {
      throw new BadRequestException(`Receiver has no payout account on file`);
    }

    if (account.status === 'superseded') {
      throw new BadRequestException(`Payout account has been superseded`);
    }
    if (account.status === 'flagged') {
      throw new BadRequestException(`Payout account is flagged and cannot be paid`);
    }

    // Cooling period check (48-hour wait): activeFrom must have passed
    if (account.activeFrom.getTime() > paidAtDate.getTime()) {
      throw new BadRequestException(
        `Payout account is in cooling period (48-hour wait) until ${account.activeFrom.toISOString()}`,
      );
    }

    // 4. Name matching
    const ownerName = account.ownerNameAtEntry;
    const isMatch = matchReceiverName(ownerName, receiverNameShown);

    if (!isMatch) {
      // Raise payout_name_mismatch ReviewFlag to CEO
      await this.reviewFlagService.raise({
        kind: 'payout_name_mismatch',
        subjectType: ownerType,
        subjectId: ownerId,
        details: {
          flaggedByStaffId: actorId,
          severity: 'amber',
          reason: `Receiver name '${receiverNameShown}' does not match account owner '${ownerName}'`,
          notes: `Payment ${payment.code}`,
        },
      });

      await this.auditService.log({
        actorId,
        action: 'payout_name_mismatch',
        entityType: 'payment',
        entityCode: payment.code,
        before: { status: payment.status },
        after: {
          status: payment.status,
          attemptedBankUtr: bankUtr,
          receiverNameShown,
          expectedName: ownerName,
        },
        changedFields: [],
        reason: 'Payout refused: receiver name mismatch',
      });

      throw new BadRequestException(
        `Receiver name '${receiverNameShown}' does not match account owner '${ownerName}'`,
      );
    }

    // 5. Name matched -> mark paid & verify account
    const updated = await this.prisma.$transaction(async (tx) => {
      const claimResult = await tx.payment.updateMany({
        where: { id: payment.id, status: 'approved' },
        data: {
          status: 'succeeded',
          bankUtr,
          payoutAccountId: account.id,
          paidAt: paidAtDate,
          paidByStaffId: actorId,
        },
      });

      if (claimResult.count === 0) {
        throw new BadRequestException('Payment is not approved or has already been paid');
      }

      const p = await tx.payment.findUniqueOrThrow({ where: { id: payment.id } });

      await tx.payoutAccount.update({
        where: { id: account.id },
        data: {
          status: 'verified',
          verifiedName: receiverNameShown,
          nameMatches: true,
          validatedAt: paidAtDate,
        },
      });

      await recordStatusChange(tx, {
        subjectType: 'payment',
        subjectId: payment.id,
        fromStatus: payment.status,
        toStatus: 'succeeded',
        changedByStaffId: actorId,
        reason: 'payout_recorded',
      });

      return p;
    });

    await this.auditService.log({
      actorId,
      action: 'payout_recorded',
      entityType: 'payment',
      entityCode: payment.code,
      before: { status: payment.status },
      after: {
        status: 'succeeded',
        bankUtr,
        receiverNameShown,
        paidAt: paidAtDate.toISOString(),
      },
      changedFields: ['status', 'bankUtr', 'payoutAccountId', 'paidAt', 'paidByStaffId'],
      reason: 'Payout recorded by CEO or Finance with verified name',
    });

    return updated;
  }

  async revealPayoutDetails(paymentId: string, actorId: string, now = new Date()) {
    const payment = await this.loadPayoutPayment(paymentId);

    if (payment.status !== 'approved') {
      throw new BadRequestException(
        `Payout details can only be revealed for approved payments. Current status: '${payment.status}'`,
      );
    }

    let ownerType: string;
    let ownerId: string;

    if (payment.type === 'referral_payout') {
      ownerType = 'referral';
      ownerId = payment.referralId || payment.subjectId;
    } else if (payment.type === 'joining_reward') {
      ownerType = 'job_seeker';
      ownerId = payment.jobSeekerId || payment.subjectId;
    } else if (payment.type === 'refund') {
      if (payment.jobSeekerId || payment.subjectType === 'job_seeker') {
        ownerType = 'job_seeker';
        ownerId = payment.jobSeekerId || payment.subjectId;
      } else {
        ownerType = 'business';
        if (payment.businessId) {
          ownerId = payment.businessId;
        } else if (payment.placementId) {
          const pl = await this.prisma.placement.findUnique({ where: { id: payment.placementId } });
          ownerId = pl?.businessId || payment.subjectId;
        } else {
          ownerId = payment.subjectId;
        }
      }
    } else {
      ownerType = payment.subjectType;
      ownerId = payment.subjectId;
    }

    let account: PayoutAccount | null = null;
    if (payment.payoutAccountId) {
      account = await this.prisma.payoutAccount.findUnique({
        where: { id: payment.payoutAccountId },
      });
    }

    if (!account) {
      account = await this.prisma.payoutAccount.findFirst({
        where: {
          ownerType,
          ownerId,
          status: { not: 'superseded' },
        },
        orderBy: { createdAt: 'desc' },
      });
    }

    if (!account) {
      throw new BadRequestException('No payout account found for payment receiver');
    }

    if (account.status === 'superseded') {
      throw new BadRequestException('Payout account has been superseded');
    }
    if (account.status === 'flagged') {
      throw new BadRequestException('Payout account is flagged and cannot be paid');
    }

    if (account.activeFrom.getTime() > now.getTime()) {
      throw new BadRequestException(
        `Payout account is in cooling period (48-hour wait) until ${account.activeFrom.toISOString()}`,
      );
    }

    let upiId: string | undefined;
    let accountNumber: string | undefined;
    let ifsc: string | undefined;

    if (account.method === 'upi') {
      if (!account.upiIdEncrypted) {
        throw new BadRequestException('Payout account has no encrypted UPI ID');
      }
      upiId = decryptPayoutValue(account.upiIdEncrypted);
    } else {
      if (!account.bankAccountEncrypted) {
        throw new BadRequestException('Payout account has no encrypted bank account');
      }
      accountNumber = decryptPayoutValue(account.bankAccountEncrypted);
      ifsc = account.ifsc ?? undefined;
    }

    await this.auditService.log({
      actorId,
      action: 'payout_details_revealed',
      entityType: 'payment',
      entityCode: payment.code,
      before: null,
      after: {
        paymentId: payment.id,
        payoutAccountId: account.id,
        method: account.method,
        maskedValue: account.maskedValue,
      },
      changedFields: [],
      reason: 'Payout details revealed to CEO or Finance for manual disbursement',
    });

    return {
      paymentId: payment.id,
      payoutAccountId: account.id,
      method: account.method,
      maskedValue: account.maskedValue,
      ownerName: account.ownerNameAtEntry,
      upiId,
      accountNumber,
      ifsc,
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

    const payments = await this.prisma.payment.findMany({
      where,
      include: {
        jobSeeker: true,
        business: true,
        placement: true,
        referral: true,
        payoutAccount: {
          select: {
            id: true,
            code: true,
            maskedValue: true,
            status: true,
            ownerNameAtEntry: true,
            activeFrom: true,
          },
        },
      },
      orderBy: { createdAt: 'desc' },
    });

    const results = await Promise.all(
      payments.map(async (p) => {
        if (p.payoutAccount) {
          return {
            ...p,
            maskedPayoutAccount: p.payoutAccount.maskedValue,
          };
        }
        let ownerType: string | null = null;
        let ownerId: string | null = null;
        if (p.type === 'referral_payout') {
          ownerType = 'referral';
          ownerId = p.referralId;
        } else if (p.type === 'joining_reward') {
          ownerType = 'job_seeker';
          ownerId = p.jobSeekerId;
        } else if (p.type === 'refund') {
          if (p.jobSeekerId) {
            ownerType = 'job_seeker';
            ownerId = p.jobSeekerId;
          } else if (p.businessId) {
            ownerType = 'business';
            ownerId = p.businessId;
          } else if (p.placement?.businessId) {
            ownerType = 'business';
            ownerId = p.placement.businessId;
          }
        }
        if (ownerType && ownerId && this.prisma.payoutAccount?.findFirst) {
          const acc = await this.prisma.payoutAccount.findFirst({
            where: { ownerType, ownerId, status: { not: 'superseded' } },
            orderBy: { createdAt: 'desc' },
            select: { maskedValue: true, status: true, activeFrom: true },
          });
          if (acc) {
            return {
              ...p,
              maskedPayoutAccount: acc.maskedValue,
              payoutAccountStatus: acc.status,
              payoutAccountActiveFrom: acc.activeFrom,
            };
          }
        }
        return {
          ...p,
          maskedPayoutAccount: null,
        };
      }),
    );
    return results;
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

  async simulateMockWebhook(body: Record<string, unknown>) {
    if (process.env.NODE_ENV === 'production') {
      throw new NotFoundException('Cannot simulate webhook in production');
    }
    const gatewayReference = String(body.gatewayReference || body.reference || '');
    const status = body.status === 'failed' ? 'failed' : 'succeeded';
    const payment = await this.prisma.payment.findUnique({
      where: { gatewayReference },
    });
    if (!payment) {
      return { received: false, error: 'Payment not found' };
    }
    if (payment.status === 'succeeded') {
      return { received: true, alreadyProcessed: true, paymentId: payment.id };
    }
    if (payment.status === 'failed') {
      return { received: true, alreadyFailed: true, paymentId: payment.id };
    }
    if (status === 'failed') {
      await this.prisma.payment.update({
        where: { id: payment.id },
        data: { status: 'failed' },
      });
      return { received: true, status: 'failed', paymentId: payment.id };
    }
    const result = await this.onPaymentSucceeded(payment.id, {
      confirmedAt: new Date(),
      confirmedBy: 'gateway',
    });
    return {
      received: true,
      status: 'succeeded',
      paymentId: payment.id,
      alreadyProcessed: result.alreadyProcessed,
    };
  }
}
