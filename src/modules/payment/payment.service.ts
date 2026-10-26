import {
  BadRequestException,
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
import { REFERRAL_PAYOUT_AMOUNT_PAISE } from '../../common/money/money';
import { PaymentFilterDto } from './dto/payment-filter.dto';
import {
  PAYMENT_PROVIDER,
  PaymentProvider,
  WebhookVerificationResult,
} from './payment-provider.interface';
import { MAX_PAYOUT_ATTEMPTS, resolveWebhookTransition } from './payout-state';

@Injectable()
export class PaymentService {
  private readonly logger = new Logger(PaymentService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly auditService: AuditService,
    private readonly idService: IdService,
    @Inject(PAYMENT_PROVIDER)
    private readonly provider: PaymentProvider,
  ) {}

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
  ): Promise<WebhookVerificationResult> {
    return this.provider.verifyWebhook(payload, signature);
  }

  async handleWebhook(payload: unknown, signature?: string) {
    const verification = await this.verifyWebhook(payload, signature);
    if (!verification.isValid) {
      throw new BadRequestException('Invalid webhook signature or payload');
    }

    const { gatewayReference, status } = verification;

    const payment = await this.prisma.payment.findUnique({
      where: { gatewayReference },
      include: { jobSeeker: true },
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
      const updatedPayment = await this.prisma.payment.update({
        where: { id: payment.id },
        data: { status: 'failed' },
      });
      return { received: true, status: 'failed', paymentId: updatedPayment.id };
    }

    // Process success
    const nowUtc = new Date();

    const updatedPayment = await this.prisma.payment.update({
      where: { id: payment.id },
      data: { status: 'succeeded' },
    });

    // If linked to a job seeker, activate or reactivate them and set paymentReceivedAt
    if (payment.jobSeekerId) {
      const beforeSeeker = payment.jobSeeker;
      const isReactivation = Boolean(payment.reactivation);

      const updatedJobSeeker = await this.prisma.jobSeeker.update({
        where: { id: payment.jobSeekerId },
        data: {
          status: 'active',
          paymentReceivedAt: nowUtc,
          hitCount: isReactivation ? 0 : (beforeSeeker?.hitCount ?? 0),
        },
      });

      // Audit log the activation or reactivation
      const staffActor =
        (await this.prisma.staff.findFirst({ where: { role: 'ceo' } })) ??
        (await this.prisma.staff.findFirst());

      if (staffActor) {
        await this.auditService.log({
          actorId: staffActor.id,
          action: isReactivation ? 'job_seeker.reactivated' : 'job_seeker.activated',
          entityType: 'job_seeker',
          entityCode: updatedJobSeeker.code,
          before: beforeSeeker
            ? {
                status: beforeSeeker.status,
                hitCount: beforeSeeker.hitCount,
                paymentReceivedAt: beforeSeeker.paymentReceivedAt,
              }
            : null,
          after: {
            status: updatedJobSeeker.status,
            hitCount: updatedJobSeeker.hitCount,
            paymentReceivedAt: updatedJobSeeker.paymentReceivedAt,
            reactivation: isReactivation,
          },
          city: updatedJobSeeker.city,
        });
      }
    }

    if (payment.placementId) {
      const placement = await this.prisma.placement.findUnique({
        where: { id: payment.placementId },
      });
      if (placement) {
        const staffActor =
          (await this.prisma.staff.findFirst({ where: { role: 'ceo' } })) ??
          (await this.prisma.staff.findFirst());
        if (staffActor) {
          await this.auditService.log({
            actorId: staffActor.id,
            action: 'payment.placement_fee_paid',
            entityType: 'placement',
            entityCode: placement.code,
            after: {
              paymentId: updatedPayment.id,
              status: 'succeeded',
              amount: updatedPayment.amount,
            },
            city: placement.city,
          });
        }
      }
    }

    return {
      received: true,
      status: 'succeeded',
      paymentId: updatedPayment.id,
    };
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

    const payment = await this.prisma.payment.create({
      data: {
        code,
        city: placement.city,
        type: 'referral_payout',
        amount: REFERRAL_PAYOUT_AMOUNT_PAISE,
        status: 'pending',
        gatewayReference,
        subjectType: 'referral',
        subjectId: placement.jobSeeker.referredById,
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

    const claim = await this.prisma.payment.updateMany({
      where: {
        id: payment.id,
        status: { in: claimableFrom },
        payoutAttempts: { lt: MAX_PAYOUT_ATTEMPTS },
      },
      data: { status: 'processing', payoutAttempts: { increment: 1 } },
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
      await this.prisma.payment.updateMany({
        where: { id: payment.id, status: 'processing' },
        data,
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
      claimed = await this.prisma.payment.updateMany({
        where: { id: payment.id, status: 'processing' },
        data: {
          status: outcome,
          ...(gatewayReference ? { gatewayReference } : {}),
        },
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
