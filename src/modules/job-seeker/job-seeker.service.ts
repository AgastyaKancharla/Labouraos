import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.service';
import { IdService } from '../../common/id/id.service';
import { AuditService } from '../../common/audit/audit.service';
import { OtpService } from '../../common/otp/otp.service';
import { CreateJobSeekerDto } from './dto/create-job-seeker.dto';
import { CreateContactAttemptDto } from './dto/create-contact-attempt.dto';
import { HitReason } from './dto/record-hit.dto';
import {
  assertNoRawAadhaar,
  validateCallWindow,
  validateSalaryRange,
} from './job-seeker.validator';
import {
  refundGuaranteeDeadline,
  isWithinRefundGuarantee,
} from '../../common/money/money';

import { PaymentService } from '../payment/payment.service';
import { ApproveJobSeekerRefundDto } from './dto/approve-refund.dto';

@Injectable()
export class JobSeekerService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly idService: IdService,
    private readonly auditService: AuditService,
    private readonly otpService: OtpService,
    private readonly paymentService: PaymentService,
  ) {}

  async create(dto: CreateJobSeekerDto, actorId: string) {
    assertNoRawAadhaar(dto);

    const phone = (dto.phone ?? dto.mobileNumber)?.trim();
    if (!phone) {
      throw new BadRequestException('Mobile number is required');
    }

    if (!dto.tradeSkill || typeof dto.tradeSkill !== 'string') {
      throw new BadRequestException('tradeSkill is required');
    }

    validateCallWindow(dto.preferredCallWindowStart, dto.preferredCallWindowEnd);
    validateSalaryRange(dto.minSalary, dto.maxSalary);

    if (!dto.otpRequestId) {
      throw new BadRequestException('otpRequestId is required: mobile number must pass OTP verification');
    }

    const isVerified = await this.otpService.isVerified(dto.otpRequestId, phone);
    if (!isVerified) {
      throw new BadRequestException('Mobile number must pass OTP verification before registration');
    }

    if (dto.referredById) {
      const referral = await this.prisma.referral.findUnique({
        where: { id: dto.referredById },
      });
      if (!referral) {
        throw new BadRequestException(`Referral partner with id '${dto.referredById}' does not exist`);
      }
    }

    const existing = await this.prisma.jobSeeker.findUnique({
      where: { phone },
    });
    if (existing) {
      throw new ConflictException(`Job seeker with phone '${phone}' already exists`);
    }

    const code = await this.idService.generateCode('job_seeker');

    const jobSeeker = await this.prisma.jobSeeker.create({
      data: {
        code,
        name: dto.name?.trim() || 'Job Seeker',
        phone,
        phoneVerified: true,
        tradeSkill: dto.tradeSkill,
        minSalary: dto.minSalary,
        maxSalary: dto.maxSalary,
        preferredCallWindowStart: dto.preferredCallWindowStart,
        preferredCallWindowEnd: dto.preferredCallWindowEnd,
        city: dto.city ?? 'Bengaluru',
        status: 'pending_payment',
        referredById: dto.referredById ?? null,
      },
    });

    await this.auditService.log({
      actorId,
      action: 'job_seeker.create',
      entityType: 'job_seeker',
      entityCode: code,
      after: jobSeeker as unknown as Record<string, unknown>,
      city: jobSeeker.city,
    });

    return jobSeeker;
  }

  async findAll() {
    return this.prisma.jobSeeker.findMany({
      orderBy: { createdAt: 'desc' },
    });
  }

  async findById(id: string, now: Date = new Date()) {
    const jobSeeker = await this.prisma.jobSeeker.findUnique({
      where: { id },
      include: {
        referredBy: true,
        payments: true,
        contactAttempts: { orderBy: { attemptedAt: 'desc' } },
        hits: { orderBy: { recordedAt: 'desc' } },
      },
    });
    if (!jobSeeker) {
      throw new NotFoundException(`Job seeker '${id}' not found`);
    }

    const deadline = jobSeeker.paymentReceivedAt
      ? refundGuaranteeDeadline(jobSeeker.paymentReceivedAt)
      : null;
    const isWithinGuarantee = jobSeeker.paymentReceivedAt
      ? isWithinRefundGuarantee(jobSeeker.paymentReceivedAt, now, jobSeeker.status)
      : false;

    return {
      ...jobSeeker,
      refundGuaranteeDeadline: deadline,
      isWithinRefundGuarantee: isWithinGuarantee,
    };
  }

  async createActivationPayment(jobSeekerId: string) {
    const jobSeeker = await this.prisma.jobSeeker.findUnique({
      where: { id: jobSeekerId },
    });
    if (!jobSeeker) {
      throw new NotFoundException(`Job seeker '${jobSeekerId}' not found`);
    }

    if (jobSeeker.status === 'active') {
      throw new BadRequestException('Job seeker is already active');
    }

    if (jobSeeker.status === 'deactivated') {
      throw new BadRequestException(
        'Job seeker is deactivated. Use /job-seekers/:id/reactivate to reactivate',
      );
    }

    const charge = await this.paymentService.createCharge(
      49900,
      'job_seeker',
      jobSeeker.id,
    );

    const code = await this.idService.generateCode('payment');

    const payment = await this.prisma.payment.create({
      data: {
        code,
        city: jobSeeker.city,
        type: 'activation',
        amount: 49900,
        status: 'pending',
        gatewayReference: charge.gatewayReference,
        subjectType: 'job_seeker',
        subjectId: jobSeeker.id,
        jobSeekerId: jobSeeker.id,
      },
    });

    return {
      paymentId: payment.id,
      paymentCode: payment.code,
      paymentLink: charge.paymentLink,
      gatewayReference: charge.gatewayReference,
      amount: payment.amount,
      status: payment.status,
    };
  }

  async reactivate(jobSeekerId: string, actorId: string) {
    const jobSeeker = await this.prisma.jobSeeker.findUnique({
      where: { id: jobSeekerId },
    });
    if (!jobSeeker) {
      throw new NotFoundException(`Job seeker '${jobSeekerId}' not found`);
    }

    if (jobSeeker.status !== 'deactivated') {
      throw new BadRequestException(
        `Job seeker must be deactivated to be reactivated. Current status: '${jobSeeker.status}'`,
      );
    }

    const charge = await this.paymentService.createCharge(
      49900,
      'job_seeker',
      jobSeeker.id,
    );

    const code = await this.idService.generateCode('payment');

    const payment = await this.prisma.payment.create({
      data: {
        code,
        city: jobSeeker.city,
        type: 'activation',
        amount: 49900,
        status: 'pending',
        gatewayReference: charge.gatewayReference,
        subjectType: 'job_seeker',
        subjectId: jobSeeker.id,
        jobSeekerId: jobSeeker.id,
        reactivation: true,
      },
    });

    await this.auditService.log({
      actorId,
      action: 'job_seeker.reactivation_initiated',
      entityType: 'job_seeker',
      entityCode: jobSeeker.code,
      after: {
        paymentId: payment.id,
        paymentCode: payment.code,
        amount: payment.amount,
        reactivation: true,
      },
      city: jobSeeker.city,
    });

    return {
      paymentId: payment.id,
      paymentCode: payment.code,
      paymentLink: charge.paymentLink,
      gatewayReference: charge.gatewayReference,
      amount: payment.amount,
      status: payment.status,
      reactivation: true,
    };
  }

  async updateKyc(jobSeekerId: string, body: Record<string, unknown>, actorId: string) {
    assertNoRawAadhaar(body);

    const jobSeeker = await this.prisma.jobSeeker.findUnique({
      where: { id: jobSeekerId },
    });
    if (!jobSeeker) {
      throw new NotFoundException(`Job seeker '${jobSeekerId}' not found`);
    }

    const kycStatus = String(body.kycStatus || body.status || 'verified');
    if (kycStatus !== 'verified' && kycStatus !== 'failed') {
      throw new BadRequestException("kycStatus must be 'verified' or 'failed'");
    }

    const kycReference = String(body.kycReference || body.vendorReference || '');
    if (!kycReference) {
      throw new BadRequestException('kycReference (vendor reference) is required');
    }

    const updated = await this.prisma.jobSeeker.update({
      where: { id: jobSeeker.id },
      data: {
        kycStatus,
        kycReference,
      },
    });

    await this.auditService.log({
      actorId,
      action: 'job_seeker.kyc',
      entityType: 'job_seeker',
      entityCode: updated.code,
      before: { kycStatus: jobSeeker.kycStatus, kycReference: jobSeeker.kycReference },
      after: { kycStatus: updated.kycStatus, kycReference: updated.kycReference },
      city: updated.city,
    });

    return updated;
  }

  async recordContactAttempt(
    jobSeekerId: string,
    dto: CreateContactAttemptDto,
    actorId: string,
  ) {
    const jobSeeker = await this.prisma.jobSeeker.findUnique({
      where: { id: jobSeekerId },
    });
    if (!jobSeeker) {
      throw new NotFoundException(`Job seeker '${jobSeekerId}' not found`);
    }

    const channel = dto.channel?.toLowerCase() as 'call' | 'whatsapp' | 'sms';
    if (!['call', 'whatsapp', 'sms'].includes(channel)) {
      throw new BadRequestException(
        `Invalid channel '${dto.channel}'. Allowed channels: call, whatsapp, sms`,
      );
    }

    const outcome = dto.outcome?.toLowerCase() as 'picked_up' | 'no_pickup';
    if (!['picked_up', 'no_pickup'].includes(outcome)) {
      throw new BadRequestException(
        `Invalid outcome '${dto.outcome}'. Allowed outcomes: picked_up, no_pickup`,
      );
    }

    const timeOfDay = dto.timeOfDay?.toLowerCase() as 'am' | 'pm';
    if (!['am', 'pm'].includes(timeOfDay)) {
      throw new BadRequestException(
        `Invalid timeOfDay '${dto.timeOfDay}'. Allowed: am, pm`,
      );
    }

    let attemptedAtDate: Date;
    if (dto.attemptedAt) {
      attemptedAtDate = new Date(dto.attemptedAt);
      if (isNaN(attemptedAtDate.getTime())) {
        throw new BadRequestException('attemptedAt must be a valid ISO date');
      }
    } else {
      attemptedAtDate = new Date();
    }

    const attempt = await this.prisma.contactAttempt.create({
      data: {
        jobSeekerId: jobSeeker.id,
        channel,
        outcome,
        timeOfDay,
        attemptedAt: attemptedAtDate,
        staffId: actorId,
      },
    });

    await this.auditService.log({
      actorId,
      action: 'job_seeker.contact_attempt',
      entityType: 'job_seeker',
      entityCode: jobSeeker.code,
      after: attempt as unknown as Record<string, unknown>,
      city: jobSeeker.city,
    });

    return attempt;
  }

  async recordHit(
    jobSeekerId: string,
    reason: string,
    note?: string,
    actorId?: string,
  ) {
    const validReasons: HitReason[] = [
      'no_pickup',
      'offer_rejected',
      'interview_no_show',
    ];
    if (!validReasons.includes(reason as HitReason)) {
      throw new BadRequestException(
        `Invalid hit reason '${reason}'. Allowed reasons: ${validReasons.join(', ')}`,
      );
    }

    return await this.prisma.$transaction(async (tx) => {
      const jobSeeker = await tx.jobSeeker.findUnique({
        where: { id: jobSeekerId },
      });
      if (!jobSeeker) {
        throw new NotFoundException(`Job seeker '${jobSeekerId}' not found`);
      }

      if (jobSeeker.status === 'deactivated') {
        throw new BadRequestException('Job seeker is already deactivated');
      }

      let qualifyingAttemptIds: string[] = [];

      if (reason === 'no_pickup') {
        const attempts = await tx.contactAttempt.findMany({
          where: {
            jobSeekerId,
            hitId: null,
          },
          orderBy: { attemptedAt: 'asc' },
        });

        const byDay: Record<string, typeof attempts> = {};
        for (const att of attempts) {
          const dateKey = new Date(att.attemptedAt).toLocaleDateString('en-CA', {
            timeZone: 'Asia/Kolkata',
          });
          if (!byDay[dateKey]) {
            byDay[dateKey] = [];
          }
          byDay[dateKey].push(att);
        }

        let foundDayKey: string | null = null;
        let selectedIds: string[] = [];

        for (const [dayKey, dayAttempts] of Object.entries(byDay)) {
          const amNoPickupCall = dayAttempts.find(
            (a) =>
              a.channel === 'call' &&
              a.timeOfDay === 'am' &&
              a.outcome === 'no_pickup',
          );
          const pmNoPickupCall = dayAttempts.find(
            (a) =>
              a.channel === 'call' &&
              a.timeOfDay === 'pm' &&
              a.outcome === 'no_pickup',
          );
          const msgAttempt = dayAttempts.find(
            (a) => a.channel === 'whatsapp' || a.channel === 'sms',
          );

          if (amNoPickupCall && pmNoPickupCall && msgAttempt) {
            foundDayKey = dayKey;
            selectedIds = [amNoPickupCall.id, pmNoPickupCall.id, msgAttempt.id];
            break;
          }
        }

        if (!foundDayKey) {
          throw new BadRequestException(
            'Cannot record no_pickup hit: job seeker does not have required AM no-pickup call, PM no-pickup call, and WhatsApp/SMS attempt logged for the same day',
          );
        }

        qualifyingAttemptIds = selectedIds;
      }

      const recordedBy = actorId && actorId !== 'system' ? actorId : 'system';
      const now = new Date();

      const hit = await tx.jobSeekerHit.create({
        data: {
          jobSeekerId: jobSeeker.id,
          reason,
          note: note ?? null,
          recordedBy,
          recordedAt: now,
        },
      });

      if (qualifyingAttemptIds.length > 0) {
        await tx.contactAttempt.updateMany({
          where: { id: { in: qualifyingAttemptIds } },
          data: { hitId: hit.id },
        });
      }

      const newHitCount = jobSeeker.hitCount + 1;
      const isNowDeactivated = newHitCount >= 3;
      const newStatus = isNowDeactivated ? 'deactivated' : jobSeeker.status;

      const updatedJobSeeker = await tx.jobSeeker.update({
        where: { id: jobSeeker.id },
        data: {
          hitCount: newHitCount,
          status: newStatus,
        },
      });

      let auditActorId = actorId && actorId !== 'system' ? actorId : null;
      if (!auditActorId) {
        const ceo = await tx.staff.findFirst({ where: { role: 'ceo' } });
        const firstStaff = ceo ?? (await tx.staff.findFirst());
        if (firstStaff) {
          auditActorId = firstStaff.id;
        }
      }

      if (auditActorId) {
        await this.auditService.log({
          actorId: auditActorId,
          action: 'job_seeker.hit',
          entityType: 'job_seeker',
          entityCode: jobSeeker.code,
          before: {
            hitCount: jobSeeker.hitCount,
            status: jobSeeker.status,
          },
          after: {
            hitCount: updatedJobSeeker.hitCount,
            status: updatedJobSeeker.status,
            hitReason: reason,
            hitId: hit.id,
            recordedBy,
          },
          city: jobSeeker.city,
        });

        if (isNowDeactivated) {
          await this.auditService.log({
            actorId: auditActorId,
            action: 'job_seeker.deactivated',
            entityType: 'job_seeker',
            entityCode: jobSeeker.code,
            before: {
              status: jobSeeker.status,
              hitCount: jobSeeker.hitCount,
            },
            after: {
              status: updatedJobSeeker.status,
              hitCount: updatedJobSeeker.hitCount,
              reason: '3_hits_accumulated',
            },
            city: jobSeeker.city,
          });
        }
      }

      return {
        ...hit,
        hitCount: updatedJobSeeker.hitCount,
        status: updatedJobSeeker.status,
        jobSeeker: updatedJobSeeker,
      };
    });
  }

  async approveRefund(
    id: string,
    dto: ApproveJobSeekerRefundDto,
    actorId: string,
  ) {
    const actor = await this.prisma.staff.findUnique({
      where: { id: actorId },
    });
    if (!actor) {
      throw new NotFoundException(`Staff '${actorId}' not found`);
    }

    const jobSeeker = await this.prisma.jobSeeker.findFirst({
      where: {
        OR: [{ id }, { code: id }],
      },
    });
    if (!jobSeeker) {
      throw new NotFoundException(`Job seeker '${id}' not found`);
    }

    if (!jobSeeker.paymentReceivedAt) {
      throw new BadRequestException(
        `Job seeker '${jobSeeker.code}' has not paid the activation fee and is not eligible for refund`,
      );
    }

    if (jobSeeker.status === 'placed') {
      throw new BadRequestException(
        `Job seeker '${jobSeeker.code}' has a confirmed placement and is not eligible for refund`,
      );
    }

    if (jobSeeker.status === 'deactivated') {
      throw new BadRequestException(
        `Job seeker '${jobSeeker.code}' is deactivated and carries no refund entitlement`,
      );
    }

    const hasOfferRejected = await this.prisma.jobSeekerHit.findFirst({
      where: {
        jobSeekerId: jobSeeker.id,
        reason: 'offer_rejected',
      },
    });
    if (hasOfferRejected) {
      throw new BadRequestException(
        `Job seeker '${jobSeeker.code}' rejected a suitable offer and is not eligible for refund`,
      );
    }

    let now: Date;
    if (dto?.asOf) {
      now = new Date(dto.asOf);
      if (isNaN(now.getTime())) {
        throw new BadRequestException('asOf must be a valid date string');
      }
    } else {
      now = new Date();
    }

    const deadline = refundGuaranteeDeadline(jobSeeker.paymentReceivedAt);
    if (now.getTime() <= deadline.getTime()) {
      throw new BadRequestException(
        `Refund can only be approved after 30 days have elapsed from payment receipt (${deadline.toISOString()})`,
      );
    }

    const existingRefund = await this.prisma.payment.findFirst({
      where: {
        jobSeekerId: jobSeeker.id,
        type: 'refund',
        status: { in: ['pending', 'processing', 'completed', 'succeeded'] },
      },
    });
    if (existingRefund) {
      throw new BadRequestException(
        `A refund has already been issued for job seeker '${jobSeeker.code}'`,
      );
    }

    const paymentCode = await this.idService.generateCode('payment');
    const payment = await this.prisma.payment.create({
      data: {
        code: paymentCode,
        city: jobSeeker.city,
        type: 'refund',
        amount: 49900,
        status: 'completed',
        gatewayReference: `ref_js_${jobSeeker.code}_${Date.now()}`,
        subjectType: 'job_seeker',
        subjectId: jobSeeker.id,
        jobSeekerId: jobSeeker.id,
      },
    });

    await this.auditService.log({
      action: 'refund_approved',
      entityType: 'JobSeeker',
      entityCode: jobSeeker.code,
      actorId: actor.id,
      city: jobSeeker.city,
      after: {
        paymentId: payment.id,
        paymentCode: payment.code,
        amount: payment.amount,
        type: 'refund',
        reason: dto?.reason ?? '30-day no-offer guarantee refund',
      },
    });

    return payment;
  }

  async erase(id: string, actorId: string) {
    const actor = await this.prisma.staff.findUnique({
      where: { id: actorId },
    });
    if (!actor) {
      throw new NotFoundException(`Staff '${actorId}' not found`);
    }

    const jobSeeker = await this.prisma.jobSeeker.findUnique({
      where: { id },
    });
    if (!jobSeeker) {
      throw new NotFoundException(`Job seeker '${id}' not found`);
    }

    // Idempotent: safe no-op if already erased
    if (jobSeeker.erasedAt) {
      return {
        message: 'Job seeker already erased',
        id: jobSeeker.id,
        code: jobSeeker.code,
        erasedAt: jobSeeker.erasedAt,
      };
    }

    const beforeState = {
      name: jobSeeker.name,
      phone: jobSeeker.phone,
      kycReference: jobSeeker.kycReference,
    };

    const updated = await this.prisma.jobSeeker.update({
      where: { id: jobSeeker.id },
      data: {
        name: 'ANONYMIZED_CANDIDATE',
        phone: `ERASED-${jobSeeker.code}`,
        kycReference: null,
        erasedAt: new Date(),
      },
    });

    await this.auditService.log({
      action: 'dpdp.erasure_requested',
      entityType: 'job_seeker',
      entityCode: jobSeeker.code,
      actorId: actor.id,
      city: jobSeeker.city,
      before: beforeState,
      after: {
        name: updated.name,
        phone: updated.phone,
        kycReference: updated.kycReference,
        erasedAt: updated.erasedAt,
      },
    });

    return updated;
  }
}


