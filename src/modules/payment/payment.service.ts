import {
  BadRequestException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
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

  async disbursePayout(
    paymentId: string,
    actorId?: string,
    options?: { simulateFailure?: boolean },
  ) {
    const payment = await this.prisma.payment.findUnique({
      where: { id: paymentId },
    });

    if (!payment) {
      throw new NotFoundException(`Payment '${paymentId}' not found`);
    }

    if (payment.status !== 'pending') {
      throw new BadRequestException(
        `Only pending payments can be disbursed. Current status: '${payment.status}'`,
      );
    }

    const before = {
      status: payment.status,
      gatewayReference: payment.gatewayReference,
    };

    const result = await this.provider.disbursePayout(
      payment.amount,
      payment.subjectType,
      payment.subjectId,
      options,
    );

    const updatedPayment = await this.prisma.payment.update({
      where: { id: payment.id },
      data: {
        status: result.status,
        gatewayReference: result.gatewayReference || payment.gatewayReference,
      },
      include: {
        jobSeeker: true,
        business: true,
        placement: true,
        referral: true,
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
        action: 'payout_release',
        entityType: 'Payment',
        entityCode: updatedPayment.code,
        before,
        after: {
          id: updatedPayment.id,
          code: updatedPayment.code,
          status: updatedPayment.status,
          amount: updatedPayment.amount,
          gatewayReference: updatedPayment.gatewayReference,
          failureReason: result.failureReason,
        },
        city: updatedPayment.city,
      });
    }

    return updatedPayment;
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
