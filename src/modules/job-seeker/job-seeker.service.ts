import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  Optional,
} from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.service';
import { IdService } from '../../common/id/id.service';
import { AuditService } from '../../common/audit/audit.service';
import { OtpService } from '../../common/otp/otp.service';
import { CreateJobSeekerDto } from './dto/create-job-seeker.dto';
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
import { evaluateJobSeekerRefundEligibility } from './job-seeker-refund-eligibility';

import { PaymentService } from '../payment/payment.service';
import { PricingService } from '../pricing/pricing.service';
import { ConsentService } from '../consent/consent.service';
import { ApproveJobSeekerRefundDto } from './dto/approve-refund.dto';
import { recordStatusChange } from '../../common/status-history/status-history.helper';
import { isJobSeekerStatus } from './job-seeker.status';
import { validateJobSeekerAge } from './job-seeker.validator';
import { UpdateJobSeekerProfileDto } from './dto/update-job-seeker-profile.dto';
import {
  CreateJobSeekerTradeDto,
  UpdateJobSeekerTradeDto,
} from './dto/job-seeker-trade.dto';
import {
  CreateJobSeekerLanguageDto,
  UpdateJobSeekerLanguageDto,
} from './dto/job-seeker-language.dto';

@Injectable()
export class JobSeekerService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly idService: IdService,
    private readonly auditService: AuditService,
    private readonly otpService: OtpService,
    private readonly paymentService: PaymentService,
    private readonly pricingService: PricingService,
    @Optional() private readonly consentService?: ConsentService,
  ) {}

  private async getPolicy() {
    return this.pricingService.current();
  }

  /**
   * ANTI-FRAUD NOTE: Candidate onboarding already carries mobile-number OTP verification,
   * which is the control that makes field-agent candidate capture safe.
   * Do not remove or weaken it, and do not add a bypass for field agents.
   */
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

    /**
     * RATIONALE FOR AGENT ATTRIBUTION (Phase 6.7 Task 1):
     * registeredByStaffId records which staff member onboarded this candidate.
     * These columns are what make per-agent measurement possible at all, and they
     * are what makes the §4 anti-fraud controls investigable — a geofence flag or
     * a duplicate-selfie detection is only actionable if the record names who created it.
     * They are NOT for pay: agents are salaried, there is no commission.
     */
    const status = (dto.status as string) || 'pending_payment';
    const dob = dto.dateOfBirth ? new Date(dto.dateOfBirth as string | Date) : null;
    if (dob) {
      validateJobSeekerAge(dob, status);
    }

    const jobSeeker = await this.prisma.$transaction(async (tx) => {
      const created = await tx.jobSeeker.create({
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
          status,
          dateOfBirth: dob,
          referredById: dto.referredById ?? null,
          registeredByStaffId: actorId ?? null,
        },
      });

      await recordStatusChange(tx, {
        subjectType: 'job_seeker',
        subjectId: created.id,
        fromStatus: null,
        toStatus: status,
        changedByStaffId: actorId,
      });

      return created;
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
    let jobSeeker = await this.prisma.jobSeeker.findUnique({
      where: { id },
      include: {
        referredBy: true,
        payments: true,
        contactAttempts: { orderBy: { attemptedAt: 'desc' } },
        hits: { orderBy: { recordedAt: 'desc' } },
      },
    });
    if (!jobSeeker) {
      jobSeeker = await this.prisma.jobSeeker.findUnique({
        where: { code: id },
        include: {
          referredBy: true,
          payments: true,
          contactAttempts: { orderBy: { attemptedAt: 'desc' } },
          hits: { orderBy: { recordedAt: 'desc' } },
        },
      });
    }
    if (!jobSeeker) {
      throw new NotFoundException(`Job seeker '${id}' not found`);
    }

    const policy = await this.getPolicy();
    const deadline = jobSeeker.paymentReceivedAt
      ? refundGuaranteeDeadline(jobSeeker.paymentReceivedAt, policy.jobSeekerGuaranteeDays)
      : null;
    const isWithinGuarantee = jobSeeker.paymentReceivedAt
      ? isWithinRefundGuarantee(jobSeeker.paymentReceivedAt, now, jobSeeker.status, false, policy.jobSeekerGuaranteeDays)
      : false;

    return {
      ...jobSeeker,
      refundGuaranteeDeadline: deadline,
      isWithinRefundGuarantee: isWithinGuarantee,
    };
  }

  async createActivationPayment(jobSeekerId: string, actorId?: string) {
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

    const policy = await this.getPolicy();
    const charge = await this.paymentService.createCharge(
      policy.activationFeePaise,
      'job_seeker',
      jobSeeker.id,
    );

    const code = await this.idService.generateCode('payment');

    const payment = await this.prisma.$transaction(async (tx) => {
      const p = await tx.payment.create({
        data: {
          code,
          city: jobSeeker.city,
          type: 'activation',
          amount: policy.activationFeePaise,
          status: 'pending',
          gatewayReference: charge.gatewayReference,
          subjectType: 'job_seeker',
          subjectId: jobSeeker.id,
          jobSeekerId: jobSeeker.id,
        },
      });

      await recordStatusChange(tx, {
        subjectType: 'payment',
        subjectId: p.id,
        fromStatus: null,
        toStatus: 'pending',
        changedByStaffId: actorId ?? null,
      });

      return p;
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

    const policy = await this.getPolicy();
    const charge = await this.paymentService.createCharge(
      policy.activationFeePaise,
      'job_seeker',
      jobSeeker.id,
    );

    const code = await this.idService.generateCode('payment');

    const payment = await this.prisma.$transaction(async (tx) => {
      const p = await tx.payment.create({
        data: {
          code,
          city: jobSeeker.city,
          type: 'activation',
          amount: policy.activationFeePaise,
          status: 'pending',
          gatewayReference: charge.gatewayReference,
          subjectType: 'job_seeker',
          subjectId: jobSeeker.id,
          jobSeekerId: jobSeeker.id,
          reactivation: true,
        },
      });

      await recordStatusChange(tx, {
        subjectType: 'payment',
        subjectId: p.id,
        fromStatus: null,
        toStatus: 'pending',
        changedByStaffId: actorId,
      });

      return p;
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

  async recordHit(
    jobSeekerId: string,
    reason: string,
    note?: string,
    actorId?: string,
    actorRole?: string,
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

    let resolvedRole = actorRole;
    if (!resolvedRole && actorId && actorId !== 'system') {
      const actorStaff = await this.prisma.staff.findUnique({
        where: { id: actorId },
        select: { role: true },
      });
      resolvedRole = actorStaff?.role;
    }

    if (resolvedRole === 'field_agent' && reason === 'no_pickup') {
      const refusalMessage =
        "Field agents may only record 'offer_rejected' or 'interview_no_show' hits. Recording 'no_pickup' hits is restricted to call agents and the automated sweep.";

      const jobSeeker = await this.prisma.jobSeeker.findUnique({
        where: { id: jobSeekerId },
        select: { code: true, city: true, hitCount: true, status: true },
      });
      if (!jobSeeker) {
        throw new NotFoundException(`Job seeker '${jobSeekerId}' not found`);
      }

      if (actorId && actorId !== 'system') {
        await this.auditService.log({
          action: 'job_seeker.hit_refused',
          entityType: 'job_seeker',
          entityCode: jobSeeker.code,
          actorId,
          city: jobSeeker.city,
          before: {
            hitCount: jobSeeker.hitCount,
            status: jobSeeker.status,
          },
          after: {
            refusalReason: 'UNAUTHORIZED_HIT_REASON_FOR_ROLE',
            attemptedReason: reason,
            role: resolvedRole,
            allowedReasons: ['offer_rejected', 'interview_no_show'],
            message: refusalMessage,
          },
        });
      }

      throw new ForbiddenException(refusalMessage);
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

      const policy = await this.getPolicy();
      const newHitCount = jobSeeker.hitCount + 1;
      const isNowDeactivated = newHitCount >= policy.maxHits;
      const newStatus = isNowDeactivated ? 'deactivated' : jobSeeker.status;

      const updatedJobSeeker = await tx.jobSeeker.update({
        where: { id: jobSeeker.id },
        data: {
          hitCount: newHitCount,
          status: newStatus,
        },
      });

      if (jobSeeker.status !== newStatus) {
        await recordStatusChange(tx, {
          subjectType: 'job_seeker',
          subjectId: jobSeeker.id,
          fromStatus: jobSeeker.status,
          toStatus: newStatus,
          changedByStaffId: recordedBy === 'system' ? null : recordedBy,
          reason: isNowDeactivated ? 'hit_limit_reached' : undefined,
        });
      }

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

    let now: Date;
    if (dto?.asOf) {
      now = new Date(dto.asOf);
      if (isNaN(now.getTime())) {
        throw new BadRequestException('asOf must be a valid date string');
      }
    } else {
      now = new Date();
    }

    const hasOfferRejected = await this.prisma.jobSeekerHit.findFirst({
      where: {
        jobSeekerId: jobSeeker.id,
        reason: 'offer_rejected',
      },
    });

    const existingRefund = await this.prisma.payment.findFirst({
      where: {
        jobSeekerId: jobSeeker.id,
        type: 'refund',
        status: { in: ['pending', 'processing', 'completed', 'succeeded'] },
      },
    });

    const policy = await this.getPolicy();
    const activationPayment = await this.prisma.payment.findFirst({
      where: {
        jobSeekerId: jobSeeker.id,
        type: { in: ['activation', 'reactivation'] },
        status: { in: ['completed', 'succeeded'] },
      },
      orderBy: { createdAt: 'desc' },
    });

    const eligibilityResult = evaluateJobSeekerRefundEligibility(
      {
        code: jobSeeker.code,
        paymentReceivedAt: jobSeeker.paymentReceivedAt,
        status: jobSeeker.status,
        hasOfferRejectedHit: Boolean(hasOfferRejected),
        hasExistingRefund: Boolean(existingRefund),
        activationPaymentPaise: activationPayment?.amount,
        guaranteeDays: policy.jobSeekerGuaranteeDays,
      },
      now,
    );

    if (!eligibilityResult.eligible) {
      throw new BadRequestException(eligibilityResult.ineligibleReason!);
    }

    const paymentCode = await this.idService.generateCode('payment');
    const payment = await this.prisma.$transaction(async (tx) => {
      const p = await tx.payment.create({
        data: {
          code: paymentCode,
          city: jobSeeker.city,
          type: 'refund',
          amount: eligibilityResult.amountPaise,
          status: 'completed',
          gatewayReference: `ref_js_${jobSeeker.code}_${Date.now()}`,
          subjectType: 'job_seeker',
          subjectId: jobSeeker.id,
          jobSeekerId: jobSeeker.id,
        },
      });

      await recordStatusChange(tx, {
        subjectType: 'payment',
        subjectId: p.id,
        fromStatus: null,
        toStatus: 'completed',
        changedByStaffId: actor.id,
        reason: 'job_seeker_guarantee_refund',
      });

      return p;
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
      reason: 'DPDP erasure request',
      changedFields: ['name', 'phone', 'kycReference', 'erasedAt'],
      before: {
        erasedAt: null,
      },
      after: {
        erasedAt: updated.erasedAt,
      },
    });

    return updated;
  }

  /**
   * Moves a job seeker from 'lead' to 'consented' once all required consents are granted.
   * Throws BadRequestException if called early or if candidate is not in 'lead' status.
   */
  async transitionToConsented(jobSeekerId: string, actorId?: string) {
    const seeker = await this.prisma.jobSeeker.findUnique({
      where: { id: jobSeekerId },
    });
    if (!seeker) {
      throw new NotFoundException(`Job seeker '${jobSeekerId}' not found`);
    }

    if (seeker.status !== 'lead') {
      throw new BadRequestException(
        `Job seeker must be in 'lead' status to transition to 'consented'. Current status: '${seeker.status}'`,
      );
    }

    if (!this.consentService) {
      throw new BadRequestException('ConsentService is not available');
    }

    const hasAll = await this.consentService.hasAllRequired('job_seeker', jobSeekerId);
    if (!hasAll) {
      throw new BadRequestException(
        'Cannot move job seeker to consented without all required consents granted',
      );
    }

    return this.prisma.$transaction(async (tx) => {
      const updated = await tx.jobSeeker.update({
        where: { id: jobSeekerId },
        data: { status: 'consented' },
      });

      await recordStatusChange(tx, {
        subjectType: 'job_seeker',
        subjectId: jobSeekerId,
        fromStatus: seeker.status,
        toStatus: 'consented',
        changedByStaffId: actorId ?? null,
        reason: 'all_required_consents_granted',
      });

      return updated;
    });
  }

  /**
   * Transitions status for a job seeker with closed-list and age enforcement:
   * - 'consented': delegates to transitionToConsented
   * - 'pending_activation', 'active', etc.: requires dateOfBirth and age >= 18
   */
  async transitionStatus(jobSeekerId: string, targetStatus: string, actorId?: string) {
    if (!isJobSeekerStatus(targetStatus)) {
      throw new BadRequestException(`Invalid job seeker status: '${targetStatus}'`);
    }

    if (targetStatus === 'consented') {
      return this.transitionToConsented(jobSeekerId, actorId);
    }

    const seeker = await this.prisma.jobSeeker.findUnique({
      where: { id: jobSeekerId },
    });
    if (!seeker) {
      throw new NotFoundException(`Job seeker '${jobSeekerId}' not found`);
    }

    validateJobSeekerAge(seeker.dateOfBirth, targetStatus);

    return this.prisma.$transaction(async (tx) => {
      const updated = await tx.jobSeeker.update({
        where: { id: jobSeekerId },
        data: { status: targetStatus },
      });

      await recordStatusChange(tx, {
        subjectType: 'job_seeker',
        subjectId: jobSeekerId,
        fromStatus: seeker.status,
        toStatus: targetStatus,
        changedByStaffId: actorId ?? null,
      });

      return updated;
    });
  }

  /**
   * Updates profile fields from Phase 12 redesign.
   * Never writes to deprecated columns (tradeSkill, kycStatus, kycReference).
   */
  async updateProfile(jobSeekerId: string, dto: UpdateJobSeekerProfileDto, actorId?: string) {
    assertNoRawAadhaar(dto);

    const seeker = await this.prisma.jobSeeker.findUnique({
      where: { id: jobSeekerId },
    });
    if (!seeker) {
      throw new NotFoundException(`Job seeker '${jobSeekerId}' not found`);
    }

    const data: Record<string, unknown> = {};

    if (dto.dateOfBirth !== undefined) {
      data.dateOfBirth = dto.dateOfBirth ? new Date(dto.dateOfBirth) : null;
    }
    if (dto.gender !== undefined) data.gender = dto.gender;
    if (dto.whatsappPhone !== undefined) data.whatsappPhone = dto.whatsappPhone;
    if (dto.photoStoragePath !== undefined) data.photoStoragePath = dto.photoStoragePath;
    if (dto.photoTakenAt !== undefined) {
      data.photoTakenAt = dto.photoTakenAt ? new Date(dto.photoTakenAt) : null;
    }
    if (dto.locality !== undefined) data.locality = dto.locality;
    if (dto.pincode !== undefined) data.pincode = dto.pincode;
    if (dto.latitude !== undefined) data.latitude = dto.latitude;
    if (dto.longitude !== undefined) data.longitude = dto.longitude;
    if (dto.travelDistanceKm !== undefined) data.travelDistanceKm = dto.travelDistanceKm;
    if (dto.preferredLocalities !== undefined) data.preferredLocalities = dto.preferredLocalities;
    if (dto.willingToRelocate !== undefined) data.willingToRelocate = dto.willingToRelocate;
    if (dto.needsAccommodation !== undefined) data.needsAccommodation = dto.needsAccommodation;
    if (dto.salaryPeriod !== undefined) data.salaryPeriod = dto.salaryPeriod;
    if (dto.availableFrom !== undefined) {
      data.availableFrom = dto.availableFrom ? new Date(dto.availableFrom) : null;
    }
    if (dto.lookingSince !== undefined) {
      data.lookingSince = dto.lookingSince ? new Date(dto.lookingSince) : null;
    }
    if (dto.shiftPreference !== undefined) data.shiftPreference = dto.shiftPreference;
    if (dto.jobType !== undefined) data.jobType = dto.jobType;
    if (dto.currentlyWorking !== undefined) data.currentlyWorking = dto.currentlyWorking;
    if (dto.lastEmployer !== undefined) data.lastEmployer = dto.lastEmployer;
    if (dto.lastRole !== undefined) data.lastRole = dto.lastRole;
    if (dto.lastSalaryPaise !== undefined) data.lastSalaryPaise = dto.lastSalaryPaise;
    if (dto.educationLevel !== undefined) data.educationLevel = dto.educationLevel;
    if (dto.certificates !== undefined) data.certificates = dto.certificates;
    if (dto.drivingLicenceType !== undefined) data.drivingLicenceType = dto.drivingLicenceType;
    if (dto.ownVehicle !== undefined) data.ownVehicle = dto.ownVehicle;
    if (dto.policeVerified !== undefined) data.policeVerified = dto.policeVerified;
    if (dto.hasSmartphone !== undefined) data.hasSmartphone = dto.hasSmartphone;
    if (dto.cvStoragePath !== undefined) data.cvStoragePath = dto.cvStoragePath;
    if (dto.keySkills !== undefined) data.keySkills = dto.keySkills;
    if (dto.qualification !== undefined) data.qualification = dto.qualification;
    if (dto.currentSalaryPaise !== undefined) data.currentSalaryPaise = dto.currentSalaryPaise;
    if (dto.pausedAt !== undefined) {
      data.pausedAt = dto.pausedAt ? new Date(dto.pausedAt) : null;
    }

    const updated = await this.prisma.jobSeeker.update({
      where: { id: jobSeekerId },
      data,
    });

    if (actorId && actorId !== 'system') {
      await this.auditService.log({
        actorId,
        action: 'job_seeker.profile_updated',
        entityType: 'job_seeker',
        entityCode: seeker.code,
        changedFields: Object.keys(data),
        city: seeker.city,
      });
    }

    return updated;
  }

  // --- Trades (Phase 12 Task 3) ---

  async addTrade(jobSeekerId: string, dto: CreateJobSeekerTradeDto, actorId?: string) {
    const seeker = await this.prisma.jobSeeker.findUnique({
      where: { id: jobSeekerId },
    });
    if (!seeker) {
      throw new NotFoundException(`Job seeker '${jobSeekerId}' not found`);
    }

    if (!dto.trade || !dto.trade.trim()) {
      throw new BadRequestException('Trade is required');
    }

    const existingTrades = await this.prisma.jobSeekerTrade.findMany({
      where: { jobSeekerId },
    });

    if (existingTrades.length >= 3) {
      throw new BadRequestException('A job seeker cannot have more than 3 trades');
    }

    const normalizedTrade = dto.trade.trim();
    if (existingTrades.some((t) => t.trade.toLowerCase() === normalizedTrade.toLowerCase())) {
      throw new ConflictException(`Trade '${normalizedTrade}' already exists for this job seeker`);
    }

    // Exactly one isPrimary = true when any row exists
    let isPrimary = false;
    if (existingTrades.length === 0) {
      isPrimary = true;
    } else if (dto.isPrimary === true) {
      isPrimary = true;
      await this.prisma.jobSeekerTrade.updateMany({
        where: { jobSeekerId, isPrimary: true },
        data: { isPrimary: false },
      });
    }

    const created = await this.prisma.jobSeekerTrade.create({
      data: {
        jobSeekerId,
        trade: normalizedTrade,
        yearsExperience: dto.yearsExperience ?? 0,
        isPrimary,
      },
    });

    if (actorId && actorId !== 'system') {
      await this.auditService.log({
        actorId,
        action: 'job_seeker.trade_added',
        entityType: 'job_seeker_trade',
        entityCode: seeker.code,
        changedFields: ['trade', 'yearsExperience', 'isPrimary'],
        city: seeker.city,
      });
    }

    return created;
  }

  async getTrades(jobSeekerId: string) {
    const seeker = await this.prisma.jobSeeker.findUnique({
      where: { id: jobSeekerId },
    });
    if (!seeker) {
      throw new NotFoundException(`Job seeker '${jobSeekerId}' not found`);
    }

    return this.prisma.jobSeekerTrade.findMany({
      where: { jobSeekerId },
      orderBy: [{ isPrimary: 'desc' }, { createdAt: 'asc' }],
    });
  }

  async updateTrade(
    jobSeekerId: string,
    tradeId: string,
    dto: UpdateJobSeekerTradeDto,
    actorId?: string,
  ) {
    const seeker = await this.prisma.jobSeeker.findUnique({
      where: { id: jobSeekerId },
    });
    if (!seeker) {
      throw new NotFoundException(`Job seeker '${jobSeekerId}' not found`);
    }

    const trade = await this.prisma.jobSeekerTrade.findFirst({
      where: { id: tradeId, jobSeekerId },
    });
    if (!trade) {
      throw new NotFoundException(`Trade '${tradeId}' not found for job seeker '${jobSeekerId}'`);
    }

    const data: Record<string, unknown> = {};

    if (dto.trade !== undefined) {
      const normalized = dto.trade.trim();
      if (!normalized) {
        throw new BadRequestException('Trade cannot be empty');
      }
      const duplicate = await this.prisma.jobSeekerTrade.findFirst({
        where: {
          jobSeekerId,
          trade: { equals: normalized, mode: 'insensitive' },
          id: { not: tradeId },
        },
      });
      if (duplicate) {
        throw new ConflictException(`Trade '${normalized}' already exists for this job seeker`);
      }
      data.trade = normalized;
    }

    if (dto.yearsExperience !== undefined) {
      data.yearsExperience = dto.yearsExperience;
    }

    if (dto.isPrimary !== undefined) {
      if (dto.isPrimary === false && trade.isPrimary) {
        throw new BadRequestException('Exactly one trade must be primary');
      }
      if (dto.isPrimary === true) {
        await this.prisma.jobSeekerTrade.updateMany({
          where: { jobSeekerId, id: { not: tradeId }, isPrimary: true },
          data: { isPrimary: false },
        });
        data.isPrimary = true;
      }
    }

    const updated = await this.prisma.jobSeekerTrade.update({
      where: { id: tradeId },
      data,
    });

    if (actorId && actorId !== 'system') {
      await this.auditService.log({
        actorId,
        action: 'job_seeker.trade_updated',
        entityType: 'job_seeker_trade',
        entityCode: seeker.code,
        changedFields: Object.keys(data),
        city: seeker.city,
      });
    }

    return updated;
  }

  async deleteTrade(jobSeekerId: string, tradeId: string, actorId?: string) {
    const seeker = await this.prisma.jobSeeker.findUnique({
      where: { id: jobSeekerId },
    });
    if (!seeker) {
      throw new NotFoundException(`Job seeker '${jobSeekerId}' not found`);
    }

    const trade = await this.prisma.jobSeekerTrade.findFirst({
      where: { id: tradeId, jobSeekerId },
    });
    if (!trade) {
      throw new NotFoundException(`Trade '${tradeId}' not found for job seeker '${jobSeekerId}'`);
    }

    await this.prisma.jobSeekerTrade.delete({
      where: { id: tradeId },
    });

    if (trade.isPrimary) {
      const nextPrimary = await this.prisma.jobSeekerTrade.findFirst({
        where: { jobSeekerId },
        orderBy: { createdAt: 'asc' },
      });
      if (nextPrimary) {
        await this.prisma.jobSeekerTrade.update({
          where: { id: nextPrimary.id },
          data: { isPrimary: true },
        });
      }
    }

    if (actorId && actorId !== 'system') {
      await this.auditService.log({
        actorId,
        action: 'job_seeker.trade_deleted',
        entityType: 'job_seeker_trade',
        entityCode: seeker.code,
        changedFields: ['id'],
        city: seeker.city,
      });
    }

    return { success: true };
  }

  // --- Languages (Phase 12 Task 3) ---

  async addLanguage(jobSeekerId: string, dto: CreateJobSeekerLanguageDto, actorId?: string) {
    const seeker = await this.prisma.jobSeeker.findUnique({
      where: { id: jobSeekerId },
    });
    if (!seeker) {
      throw new NotFoundException(`Job seeker '${jobSeekerId}' not found`);
    }

    if (!dto.language || !dto.language.trim()) {
      throw new BadRequestException('Language is required');
    }

    const normalizedLang = dto.language.trim();
    const existing = await this.prisma.jobSeekerLanguage.findFirst({
      where: {
        jobSeekerId,
        language: { equals: normalizedLang, mode: 'insensitive' },
      },
    });
    if (existing) {
      throw new ConflictException(`Language '${normalizedLang}' already exists for this job seeker`);
    }

    const created = await this.prisma.jobSeekerLanguage.create({
      data: {
        jobSeekerId,
        language: normalizedLang,
        speaks: dto.speaks ?? false,
        reads: dto.reads ?? false,
        writes: dto.writes ?? false,
      },
    });

    if (actorId && actorId !== 'system') {
      await this.auditService.log({
        actorId,
        action: 'job_seeker.language_added',
        entityType: 'job_seeker_language',
        entityCode: seeker.code,
        changedFields: ['language', 'speaks', 'reads', 'writes'],
        city: seeker.city,
      });
    }

    return created;
  }

  async getLanguages(jobSeekerId: string) {
    const seeker = await this.prisma.jobSeeker.findUnique({
      where: { id: jobSeekerId },
    });
    if (!seeker) {
      throw new NotFoundException(`Job seeker '${jobSeekerId}' not found`);
    }

    return this.prisma.jobSeekerLanguage.findMany({
      where: { jobSeekerId },
      orderBy: { createdAt: 'asc' },
    });
  }

  async updateLanguage(
    jobSeekerId: string,
    languageId: string,
    dto: UpdateJobSeekerLanguageDto,
    actorId?: string,
  ) {
    const seeker = await this.prisma.jobSeeker.findUnique({
      where: { id: jobSeekerId },
    });
    if (!seeker) {
      throw new NotFoundException(`Job seeker '${jobSeekerId}' not found`);
    }

    const lang = await this.prisma.jobSeekerLanguage.findFirst({
      where: { id: languageId, jobSeekerId },
    });
    if (!lang) {
      throw new NotFoundException(
        `Language '${languageId}' not found for job seeker '${jobSeekerId}'`,
      );
    }

    const data: Record<string, unknown> = {};

    if (dto.language !== undefined) {
      const normalized = dto.language.trim();
      if (!normalized) {
        throw new BadRequestException('Language cannot be empty');
      }
      const duplicate = await this.prisma.jobSeekerLanguage.findFirst({
        where: {
          jobSeekerId,
          language: { equals: normalized, mode: 'insensitive' },
          id: { not: languageId },
        },
      });
      if (duplicate) {
        throw new ConflictException(
          `Language '${normalized}' already exists for this job seeker`,
        );
      }
      data.language = normalized;
    }

    if (dto.speaks !== undefined) data.speaks = dto.speaks;
    if (dto.reads !== undefined) data.reads = dto.reads;
    if (dto.writes !== undefined) data.writes = dto.writes;

    const updated = await this.prisma.jobSeekerLanguage.update({
      where: { id: languageId },
      data,
    });

    if (actorId && actorId !== 'system') {
      await this.auditService.log({
        actorId,
        action: 'job_seeker.language_updated',
        entityType: 'job_seeker_language',
        entityCode: seeker.code,
        changedFields: Object.keys(data),
        city: seeker.city,
      });
    }

    return updated;
  }

  async deleteLanguage(jobSeekerId: string, languageId: string, actorId?: string) {
    const seeker = await this.prisma.jobSeeker.findUnique({
      where: { id: jobSeekerId },
    });
    if (!seeker) {
      throw new NotFoundException(`Job seeker '${jobSeekerId}' not found`);
    }

    const lang = await this.prisma.jobSeekerLanguage.findFirst({
      where: { id: languageId, jobSeekerId },
    });
    if (!lang) {
      throw new NotFoundException(
        `Language '${languageId}' not found for job seeker '${jobSeekerId}'`,
      );
    }

    await this.prisma.jobSeekerLanguage.delete({
      where: { id: languageId },
    });

    if (actorId && actorId !== 'system') {
      await this.auditService.log({
        actorId,
        action: 'job_seeker.language_deleted',
        entityType: 'job_seeker_language',
        entityCode: seeker.code,
        changedFields: ['id'],
        city: seeker.city,
      });
    }

    return { success: true };
  }
}


