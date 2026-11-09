import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
  Optional,
} from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.service';
import { IdService } from '../../common/id/id.service';
import { AuditService } from '../../common/audit/audit.service';
import { OtpService } from '../../common/otp/otp.service';
import { CreateJobSeekerDto } from './dto/create-job-seeker.dto';
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
import { UpiCollectionService } from '../payment/upi-collection.service';
import { PricingService } from '../pricing/pricing.service';
import { ConsentService } from '../consent/consent.service';
import { ReviewFlagService } from '../review-flag/review-flag.service';
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
import { normalizeHitReason } from './dto/record-hit.dto';
import { withCurrentJobSeekerFields } from './job-seeker-legacy-read';
import { EditPolicyService, EditActor } from '../../common/edit-policy/edit-policy.service';
import { ConsentClock } from '../consent/consent-clock';
import {
  CANDIDATE_PHOTO_LINK_TTL_SECONDS,
  CANDIDATE_PHOTO_STORAGE,
  CandidatePhotoStorage,
} from './photo-storage';

const ALLOWED_JOB_SEEKER_UPDATE_FIELDS = new Set([
  'name',
  'phone',
  'minSalary',
  'maxSalary',
  'preferredCallWindowStart',
  'preferredCallWindowEnd',
  'city',
  'dateOfBirth',
  'gender',
  'whatsappPhone',
  'locality',
  'pincode',
  'latitude',
  'longitude',
  'travelDistanceKm',
  'preferredLocalities',
  'willingToRelocate',
  'needsAccommodation',
  'salaryPeriod',
  'availableFrom',
  'lookingSince',
  'shiftPreference',
  'jobType',
  'currentlyWorking',
  'lastEmployer',
  'lastRole',
  'lastSalaryPaise',
  'educationLevel',
  'certificates',
  'drivingLicenceType',
  'ownVehicle',
  'policeVerified',
  'hasSmartphone',
  'cvStoragePath',
  'keySkills',
  'qualification',
  'currentSalaryPaise',
  'pausedAt',
]);

@Injectable()
export class JobSeekerService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly idService: IdService,
    private readonly auditService: AuditService,
    private readonly otpService: OtpService,
    private readonly paymentService: PaymentService,
    private readonly pricingService: PricingService,
    private readonly upiCollectionService: UpiCollectionService,
    private readonly editPolicyService: EditPolicyService,
    @Optional() private readonly consentService?: ConsentService,
    @Optional() private readonly reviewFlagService?: ReviewFlagService,
    @Optional() private readonly consentClock?: ConsentClock,
    @Optional() @Inject(CANDIDATE_PHOTO_STORAGE) private readonly photoStorage?: CandidatePhotoStorage,
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
    const status = (dto.status as string) || 'lead';
    const dob = dto.dateOfBirth ? new Date(dto.dateOfBirth as string | Date) : null;
    if (dob) {
      validateJobSeekerAge(dob, status);
    }
    const trade = typeof dto.tradeSkill === 'string' ? dto.tradeSkill.trim() : '';
    if (status === 'pending_activation' && !trade) {
      throw new BadRequestException(
        'A primary trade is required before a job seeker can reach pending_activation',
      );
    }

    const jobSeeker = await this.prisma.$transaction(async (tx) => {
      const created = await tx.jobSeeker.create({
        data: {
          code,
          name: dto.name?.trim() || 'Job Seeker',
          phone,
          phoneVerified: true,
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

      if (trade) {
        await tx.jobSeekerTrade.create({
          data: {
            jobSeekerId: created.id,
            trade,
            yearsExperience: dto.yearsExperience ?? 0,
            isPrimary: true,
          },
        });
      }

      await recordStatusChange(tx, {
        subjectType: 'job_seeker',
        subjectId: created.id,
        fromStatus: null,
        toStatus: status,
        changedByStaffId: actorId,
      });

      const createdWithRelations = await tx.jobSeeker.findUniqueOrThrow({
        where: { id: created.id },
        include: { trades: true, identityVerifications: { orderBy: { createdAt: 'desc' }, take: 1 } },
      });
      return withCurrentJobSeekerFields(createdWithRelations);
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
    const seekers = await this.prisma.jobSeeker.findMany({
      include: {
        trades: true,
        identityVerifications: { orderBy: { createdAt: 'desc' }, take: 1 },
      },
      orderBy: { createdAt: 'desc' },
    });
    return seekers.map(withCurrentJobSeekerFields);
  }

  async findById(id: string, now: Date = new Date()) {
    let jobSeeker = await this.prisma.jobSeeker.findUnique({
      where: { id },
      include: {
        referredBy: true,
        payments: true,
        contactAttempts: { orderBy: { attemptedAt: 'desc' } },
        hits: { orderBy: { recordedAt: 'desc' } },
        trades: true,
        identityVerifications: { orderBy: { createdAt: 'desc' }, take: 1 },
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
          trades: true,
          identityVerifications: { orderBy: { createdAt: 'desc' }, take: 1 },
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
      ...withCurrentJobSeekerFields(jobSeeker),
      refundGuaranteeDeadline: deadline,
      isWithinRefundGuarantee: isWithinGuarantee,
    };
  }

  async createActivationPayment(jobSeekerId: string, actorId?: string) {
    void actorId;
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

    const upiRequest = await this.upiCollectionService.createRequest({
      type: 'activation',
      subjectType: 'job_seeker',
      subjectId: jobSeeker.id,
      amountPaise: policy.activationFeePaise,
      city: jobSeeker.city,
      jobSeekerId: jobSeeker.id,
      notifySubjectType: 'job_seeker',
      notifySubjectId: jobSeeker.id,
    });
    return {
      paymentId: upiRequest.paymentId,
      paymentCode: upiRequest.paymentCode,
      paymentLink: upiRequest.paymentLink,
      upiReference: upiRequest.upiReference,
      upiUri: upiRequest.upiUri,
      gatewayReference: null,
      amount: upiRequest.amountPaise,
      amountPaise: upiRequest.amountPaise,
      status: upiRequest.status,
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

    const upiRequest = await this.upiCollectionService.createRequest({
      type: 'activation',
      subjectType: 'job_seeker',
      subjectId: jobSeeker.id,
      amountPaise: policy.activationFeePaise,
      city: jobSeeker.city,
      jobSeekerId: jobSeeker.id,
      notifySubjectType: 'job_seeker',
      notifySubjectId: jobSeeker.id,
      reactivation: true,
    });

    await this.auditService.log({
      actorId,
      action: 'job_seeker.reactivation_initiated',
      entityType: 'job_seeker',
      entityCode: jobSeeker.code,
      after: {
        paymentId: upiRequest.paymentId,
        paymentCode: upiRequest.paymentCode,
        amount: upiRequest.amountPaise,
        reactivation: true,
      },
      city: jobSeeker.city,
    });

    return {
      paymentId: upiRequest.paymentId,
      paymentCode: upiRequest.paymentCode,
      paymentLink: upiRequest.paymentLink,
      upiReference: upiRequest.upiReference,
      upiUri: upiRequest.upiUri,
      gatewayReference: null,
      amount: upiRequest.amountPaise,
      amountPaise: upiRequest.amountPaise,
      status: upiRequest.status,
      reactivation: true,
    };
  }

  async recordHit(
    jobSeekerId: string,
    rawReason: string,
    note?: string,
    actorId?: string,
    actorRole?: string,
    meta?: { interviewId?: string; callRecordId?: string },
  ) {
    const validReasons = [
      'no_pickup',
      'offer_declined',
      'offer_no_reply',
      'interview_no_show',
      'offer_rejected',
    ];
    if (!validReasons.includes(rawReason)) {
      throw new BadRequestException(
        `Invalid hit reason '${rawReason}'. Allowed reasons: no_pickup, offer_declined, offer_no_reply, interview_no_show`,
      );
    }
    const reason = normalizeHitReason(rawReason);

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
        "Field agents may only record 'offer_declined' (or 'offer_rejected'), 'offer_no_reply' or 'interview_no_show' hits. Recording 'no_pickup' hits is restricted to call agents and the automated sweep.";

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
            allowedReasons: ['offer_declined', 'offer_rejected', 'offer_no_reply', 'interview_no_show'],
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
          reason: rawReason,
          note: note ?? null,
          interviewId: meta?.interviewId ?? null,
          callRecordId: meta?.callRecordId ?? null,
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
        include: { trades: true, identityVerifications: { orderBy: { createdAt: 'desc' }, take: 1 } },
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
        jobSeeker: withCurrentJobSeekerFields(updatedJobSeeker),
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
        reason: { in: ['offer_declined', 'offer_no_reply', 'interview_no_show', 'offer_rejected'] },
        reversedAt: null,
      },
    });

    const existingRefund = await this.prisma.payment.findFirst({
      where: {
        jobSeekerId: jobSeeker.id,
        type: 'refund',
        status: { in: ['pending', 'approved', 'processing', 'completed', 'succeeded'] },
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

    const openBypassFlag = this.prisma.reviewFlag
      ? await this.prisma.reviewFlag.findFirst({
          where: {
            subjectType: 'job_seeker',
            subjectId: jobSeeker.id,
            kind: 'bypass_suspected',
            status: 'open',
          },
        })
      : null;

    const bypassFollowUp = this.prisma.followUpTask
      ? await this.prisma.followUpTask.findFirst({
          where: {
            subjectType: 'job_seeker',
            subjectId: jobSeeker.id,
            kind: 'refund_check',
            answer: 'working_at_introduced_business',
          },
        })
      : null;

    const eligibilityResult = evaluateJobSeekerRefundEligibility(
      {
        code: jobSeeker.code,
        paymentReceivedAt: jobSeeker.paymentReceivedAt,
        status: jobSeeker.status,
        hasOfferRejectedHit: Boolean(hasOfferRejected),
        hasExistingRefund: Boolean(existingRefund),
        activationPaymentPaise: activationPayment?.amount,
        guaranteeDays: policy.jobSeekerGuaranteeDays,
        hasWithdrawnEssentialConsent: Boolean(withdrawnConsent),
        hasOpenBypassFlag: Boolean(openBypassFlag),
        hasWorkingAtIntroducedBusinessFollowUp: Boolean(bypassFollowUp),
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
          status: 'approved',
          approvedByStaffId: actor.id,
          approvedAt: now,
          gatewayReference: null,
          subjectType: 'job_seeker',
          subjectId: jobSeeker.id,
          jobSeekerId: jobSeeker.id,
        },
      });

      await recordStatusChange(tx, {
        subjectType: 'payment',
        subjectId: p.id,
        fromStatus: null,
        toStatus: 'approved',
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

    // Phase 18 Task 4: When a refund becomes owed and the receiver has no account, send link
    if (this.paymentService?.sendPayoutDetailsLinkIfNoAccount) {
      await this.paymentService.sendPayoutDetailsLinkIfNoAccount(
        'job_seeker',
        jobSeeker.id,
        actor.id,
        actor.role,
        now,
      );
    }

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
        erasedAt: new Date(),
      },
      include: { trades: true, identityVerifications: { orderBy: { createdAt: 'desc' }, take: 1 } },
    });

    await this.auditService.log({
      action: 'dpdp.erasure_requested',
      entityType: 'job_seeker',
      entityCode: jobSeeker.code,
      actorId: actor.id,
      city: jobSeeker.city,
      reason: 'DPDP erasure request',
      changedFields: ['name', 'phone', 'erasedAt'],
      before: {
        erasedAt: null,
      },
      after: {
        erasedAt: updated.erasedAt,
      },
    });

    return withCurrentJobSeekerFields(updated);
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
        include: { trades: true, identityVerifications: { orderBy: { createdAt: 'desc' }, take: 1 } },
      });

      await recordStatusChange(tx, {
        subjectType: 'job_seeker',
        subjectId: jobSeekerId,
        fromStatus: seeker.status,
        toStatus: 'consented',
        changedByStaffId: actorId ?? null,
        reason: 'all_required_consents_granted',
      });

      return withCurrentJobSeekerFields(updated);
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

    if (targetStatus === 'pending_activation') {
      const primaryTradeCount = await this.prisma.jobSeekerTrade.count({
        where: { jobSeekerId, isPrimary: true },
      });
      if (primaryTradeCount === 0) {
        throw new BadRequestException(
          'A primary trade is required before a job seeker can reach pending_activation',
        );
      }
    }

    return this.prisma.$transaction(async (tx) => {
      const updated = await tx.jobSeeker.update({
        where: { id: jobSeekerId },
        data: { status: targetStatus },
        include: { trades: true, identityVerifications: { orderBy: { createdAt: 'desc' }, take: 1 } },
      });

      await recordStatusChange(tx, {
        subjectType: 'job_seeker',
        subjectId: jobSeekerId,
        fromStatus: seeker.status,
        toStatus: targetStatus,
        changedByStaffId: actorId ?? null,
      });

      return withCurrentJobSeekerFields(updated);
    });
  }

  async update(jobSeekerId: string, dto: Record<string, unknown>, actor: EditActor | string) {
    assertNoRawAadhaar(dto);

    let editActor: EditActor;
    if (typeof actor === 'string') {
      const staff = await this.prisma.staff.findUnique({
        where: { id: actor },
        select: { id: true, role: true, teamLeadId: true },
      });
      if (staff) {
        editActor = { id: staff.id, role: staff.role, teamLeadId: staff.teamLeadId };
      } else {
        editActor = { id: actor, role: 'manager' };
      }
    } else {
      editActor = actor;
    }

    const reason = typeof dto.reason === 'string' ? dto.reason : undefined;

    const filteredDto: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(dto)) {
      if (ALLOWED_JOB_SEEKER_UPDATE_FIELDS.has(key) && value !== undefined) {
        filteredDto[key] = value;
      }
    }

    const { record, diff } = await this.editPolicyService.assertCanEdit({
      actor: editActor,
      entityType: 'job_seeker',
      entityId: jobSeekerId,
      updates: filteredDto,
      reason,
    });

    if (!diff || !diff.hasChange) {
      return withCurrentJobSeekerFields(record);
    }

    const data: Record<string, unknown> = {};
    for (const key of diff.changedFields) {
      if (['dateOfBirth', 'availableFrom', 'lookingSince', 'pausedAt'].includes(key)) {
        data[key] = filteredDto[key] ? new Date(filteredDto[key] as string) : null;
      } else {
        data[key] = filteredDto[key];
      }
    }

    const updated = await this.prisma.jobSeeker.update({
      where: { id: record.id as string },
      data,
      include: { trades: true, identityVerifications: { orderBy: { createdAt: 'desc' }, take: 1 } },
    });

    await this.editPolicyService.logEdit({
      actorId: editActor.id,
      entityType: 'job_seeker',
      entityCode: record.code as string,
      diff,
      reason,
      city: record.city as string | undefined,
    });

    return withCurrentJobSeekerFields(updated);
  }

  /**
   * Updates profile fields from Phase 12 redesign.
   * Never writes to deprecated columns (tradeSkill, kycStatus, kycReference).
   */
  async updateProfile(jobSeekerId: string, dto: UpdateJobSeekerProfileDto, actor?: EditActor | string) {
    return this.update(jobSeekerId, dto as unknown as Record<string, unknown>, actor ?? 'system');
  }

  async uploadPhoto(jobSeekerId: string, photo: { buffer: Buffer; mimetype: string }, actorId: string) {
    if (!photo.buffer.length || !photo.mimetype.toLowerCase().startsWith('image/')) {
      throw new BadRequestException('A valid image file is required');
    }
    const seeker = await this.prisma.jobSeeker.findUnique({ where: { id: jobSeekerId } });
    if (!seeker) throw new NotFoundException(`Job seeker '${jobSeekerId}' not found`);
    const consent = await this.prisma.consent.findFirst({
      where: {
        subjectType: 'job_seeker',
        subjectId: seeker.id,
        purpose: 'profile_sharing',
        granted: true,
        grantedAt: { not: null },
        withdrawnAt: null,
      },
      select: { id: true },
    });
    if (!consent) throw new ForbiddenException('Active profile_sharing consent is required to upload a photo');
    if (!this.photoStorage || !this.consentClock) throw new Error('Candidate photo storage is not configured');

    const path = `job-seekers/${seeker.id}/profile-photo`;
    const photoTakenAt = this.consentClock.now();
    await this.photoStorage.put(path, photo.buffer, photo.mimetype);
    const updated = await this.prisma.jobSeeker.update({
      where: { id: seeker.id },
      data: { photoStoragePath: path, photoTakenAt },
    });
    await this.auditService.log({
      actorId,
      action: 'job_seeker.photo_uploaded',
      entityType: 'job_seeker',
      entityCode: seeker.code,
      before: { photoStoragePath: seeker.photoStoragePath, photoTakenAt: seeker.photoTakenAt?.toISOString() ?? null },
      after: { photoStoragePath: path, photoTakenAt: photoTakenAt.toISOString() },
      changedFields: ['photoStoragePath', 'photoTakenAt'],
      city: seeker.city,
    });
    return { jobSeekerId: updated.id, photoTakenAt: updated.photoTakenAt, expiresInSeconds: CANDIDATE_PHOTO_LINK_TTL_SECONDS };
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

  /**
   * Records an IdentityVerification row for a job seeker.
   * Requires that Consent.aadhaar_verification is active for this job seeker.
   * NEVER writes to deprecated columns (kycStatus, kycReference).
   * Runs assertNoRawAadhaar on input.
   */
  async createIdentityVerification(
    jobSeekerId: string,
    dto: Record<string, unknown>,
    actorId?: string,
  ) {
    assertNoRawAadhaar(dto);

    const seeker = await this.prisma.jobSeeker.findUnique({
      where: { id: jobSeekerId },
    });
    if (!seeker) {
      throw new NotFoundException(`Job seeker not found: ${jobSeekerId}`);
    }

    if (!this.consentService) {
      throw new BadRequestException('ConsentService is not available');
    }

    const hasAadhaarConsent = await this.consentService.hasConsent(
      'job_seeker',
      jobSeekerId,
      'aadhaar_verification',
    );
    if (!hasAadhaarConsent) {
      throw new BadRequestException(
        'Consent for aadhaar_verification is required before identity verification can be requested',
      );
    }

    const method = String(dto.method || 'digilocker');
    const allowedMethods = ['digilocker', 'aadhaar_qr', 'pan', 'driving_licence', 'voter_id'];
    if (!allowedMethods.includes(method)) {
      throw new BadRequestException(
        `Invalid identity verification method: ${method}. Allowed: ${allowedMethods.join(', ')}`,
      );
    }

    const status = String(dto.status || 'verified');
    const allowedStatuses = ['pending', 'verified', 'failed'];
    if (!allowedStatuses.includes(status)) {
      throw new BadRequestException(
        `Invalid identity verification status: ${status}. Allowed: ${allowedStatuses.join(', ')}`,
      );
    }

    let last4: string | null = null;
    if (dto.last4 !== undefined && dto.last4 !== null && dto.last4 !== '') {
      const last4Str = String(dto.last4).trim();
      if (!/^\d{4}$/.test(last4Str)) {
        throw new BadRequestException('last4 must be exactly 4 digits');
      }
      last4 = last4Str;
    }

    const vendor = String(dto.vendor || 'digilocker');
    const vendorReference = String(
      dto.vendorReference ||
        `idv_ref_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
    );

    const nameMatches =
      dto.nameMatches !== undefined ? Boolean(dto.nameMatches) : status === 'verified';
    const isAdult =
      dto.isAdult !== undefined ? Boolean(dto.isAdult) : status === 'verified';
    const verifiedAt = status === 'verified' ? new Date() : null;
    const failureReason =
      status === 'failed'
        ? dto.failureReason
          ? String(dto.failureReason)
          : 'Verification failed'
        : null;

    const verification = await this.prisma.identityVerification.create({
      data: {
        jobSeekerId,
        method,
        vendor,
        vendorReference,
        status,
        last4,
        nameMatches,
        isAdult,
        verifiedAt,
        failureReason,
      },
    });

    if (actorId && actorId !== 'system') {
      await this.auditService.log({
        actorId,
        action: 'job_seeker.identity_verification',
        entityType: 'identity_verification',
        entityCode: seeker.code,
        before: null,
        after: {
          id: verification.id,
          method: verification.method,
          status: verification.status,
          vendor: verification.vendor,
          last4: verification.last4,
        },
        changedFields: ['id', 'status', 'method'],
        city: seeker.city,
      });
    }

    return verification;
  }

  async getIdentityVerifications(jobSeekerId: string) {
    const seeker = await this.prisma.jobSeeker.findUnique({
      where: { id: jobSeekerId },
    });
    if (!seeker) {
      throw new NotFoundException(`Job seeker not found: ${jobSeekerId}`);
    }
    return this.prisma.identityVerification.findMany({
      where: { jobSeekerId },
      orderBy: { createdAt: 'desc' },
    });
  }

  async reverseHit(
    hitId: string,
    reversalReason: string,
    actorId: string,
    actorRole?: string,
  ) {
    if (!reversalReason || !reversalReason.trim()) {
      throw new BadRequestException('reversalReason is required');
    }

    const hit = await this.prisma.jobSeekerHit.findUnique({
      where: { id: hitId },
      include: { jobSeeker: true },
    });
    if (!hit) {
      throw new NotFoundException(`Job seeker hit '${hitId}' not found`);
    }

    if (hit.reversedAt) {
      throw new BadRequestException(`Hit '${hitId}' has already been reversed`);
    }

    const now = new Date();
    const policy = await this.getPolicy();

    const result = await this.prisma.$transaction(async (tx) => {
      const updatedHit = await tx.jobSeekerHit.update({
        where: { id: hitId },
        data: {
          reversedAt: now,
          reversedByStaffId: actorId,
          reversalReason: reversalReason.trim(),
        },
      });

      const newHitCount = Math.max(0, hit.jobSeeker.hitCount - 1);

      const wasDeactivated = hit.jobSeeker.status === 'deactivated';
      const shouldReactivate = wasDeactivated && newHitCount < policy.maxHits;
      const newStatus = shouldReactivate ? 'active' : hit.jobSeeker.status;

      const updatedJobSeeker = await tx.jobSeeker.update({
        where: { id: hit.jobSeekerId },
        data: {
          hitCount: newHitCount,
          status: newStatus,
        },
        include: { trades: true, identityVerifications: { orderBy: { createdAt: 'desc' }, take: 1 } },
      });

      if (hit.jobSeeker.status !== newStatus) {
        await recordStatusChange(tx, {
          subjectType: 'job_seeker',
          subjectId: hit.jobSeeker.id,
          fromStatus: hit.jobSeeker.status,
          toStatus: newStatus,
          changedByStaffId: actorId,
          reason: 'hit_reversed',
          changedAt: now,
        });
      }

      await this.auditService.log({
        actorId,
        action: 'job_seeker.hit_reversed',
        entityType: 'job_seeker_hit',
        entityCode: hit.id,
        before: {
          reversedAt: null,
          hitCount: hit.jobSeeker.hitCount,
          status: hit.jobSeeker.status,
        },
        after: {
          reversedAt: now,
          reversedByStaffId: actorId,
          reversalReason: reversalReason.trim(),
          hitCount: newHitCount,
          status: newStatus,
        },
        city: hit.jobSeeker.city,
      });

      return { updatedHit, updatedJobSeeker: withCurrentJobSeekerFields(updatedJobSeeker) };
    });

    if (this.reviewFlagService) {
      await this.reviewFlagService.raise({
        kind: 'hit_reversed',
        subjectType: 'job_seeker_hit',
        subjectId: hit.id,
        raisedForStaffId: actorId,
        details: {
          jobSeekerId: hit.jobSeeker.id,
          jobSeekerCode: hit.jobSeeker.code,
          reversalReason: reversalReason.trim(),
          originalReason: hit.reason,
          reversedByStaffId: actorId,
          reversedByRole: actorRole,
        },
      });
    }

    return {
      ...result.updatedHit,
      reason: normalizeHitReason(result.updatedHit.reason),
      jobSeeker: result.updatedJobSeeker,
    };
  }

  async getHit(hitId: string) {
    const hit = await this.prisma.jobSeekerHit.findUnique({
      where: { id: hitId },
    });
    if (!hit) {
      throw new NotFoundException(`Job seeker hit '${hitId}' not found`);
    }
    return {
      ...hit,
      reason: normalizeHitReason(hit.reason),
    };
  }

  async listHits(jobSeekerId: string) {
    const hits = await this.prisma.jobSeekerHit.findMany({
      where: { jobSeekerId },
      orderBy: { recordedAt: 'desc' },
    });
    return hits.map((h) => ({
      ...h,
      reason: normalizeHitReason(h.reason),
    }));
  }
}


