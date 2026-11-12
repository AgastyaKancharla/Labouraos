import { Prisma } from '@prisma/client';
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
import { decisionTime } from '../../common/time/decision-time';
import { IdService } from '../../common/id/id.service';
import { AuditService } from '../../common/audit/audit.service';
import { OtpService } from '../../common/otp/otp.service';
import { CreateJobSeekerDto } from './dto/create-job-seeker.dto';
import {
  assertNoRawAadhaar,
  validateJobSeekerRegistration,
} from './job-seeker.validator';
import {
  refundGuaranteeDeadline,
  isWithinRefundGuarantee,
} from '../../common/money/money';
import { evaluateJobSeekerRefundEligibility } from './job-seeker-refund-eligibility';
import { loadJobSeekerRefundGuards } from './job-seeker-refund-guards';
import { alreadyExists, isDuplicatePayout, lockSubject } from '../../common/money/one-per-subject';
import { currentGuaranteeRefundWhere } from '../../common/money/current-guarantee-refund';

import { PaymentService } from '../payment/payment.service';
import { UpiCollectionService } from '../payment/upi-collection.service';
import { PricingService } from '../pricing/pricing.service';
import { ConsentService } from '../consent/consent.service';
import { ReviewFlagService } from '../review-flag/review-flag.service';
import { ApproveJobSeekerRefundDto } from './dto/approve-refund.dto';
import { recordStatusChange } from '../../common/status-history/status-history.helper';
import { REACTIVATABLE_STATUSES, isJobSeekerStatus } from './job-seeker.status';
import { assertRejectionOverride, findRefundRejection, refundLockKey } from '../refund/refund-rejection';
import { markJobSeekerRefunded } from './job-seeker-refunded';
import { calculateAge, validateJobSeekerAge } from './job-seeker.validator';
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
import { AnonymisationService } from '../../common/anonymisation/anonymisation.service';
import { ConsentClock } from '../consent/consent-clock';
import { normalizeTradeName, tradeNameKey, TradeService } from '../trade/trade.service';
import {
  CANDIDATE_PHOTO_LINK_TTL_SECONDS,
  CANDIDATE_PHOTO_STORAGE,
  CandidatePhotoStorage,
} from './photo-storage';
import { KycRecoveryService } from '../../common/kyc/kyc-recovery.service';
import { PublicLinkStoreService } from '../../common/public-link-store.service';
import { MessagingService } from '../message/messaging.service';
import { publicPageLink } from '../../common/public-pages';
import {
  mobileLookupValues,
  optionalIndianMobile,
  requireIndianMobile,
  sameIndianMobile,
} from '../../common/phone/indian-mobile';

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

/** Who pays through a payment-only link (design CA08e "Who is it?"). Never personal data beyond the relation. */
export const PAYMENT_PAYER_RELATIONS = ['brother', 'sister', 'parent', 'spouse', 'friend', 'other'] as const;

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
    private readonly anonymisationService: AnonymisationService,
    private readonly tradeService: TradeService,
    @Optional() private readonly consentService?: ConsentService,
    @Optional() private readonly reviewFlagService?: ReviewFlagService,
    @Optional() private readonly consentClock?: ConsentClock,
    @Optional() @Inject(CANDIDATE_PHOTO_STORAGE) private readonly photoStorage?: CandidatePhotoStorage,
    @Optional() private readonly kycRecovery?: KycRecoveryService,
    @Optional() private readonly publicLinks?: PublicLinkStoreService,
    @Optional() private readonly messagingService?: MessagingService,
  ) {}

  private async getPolicy() {
    return this.pricingService.current();
  }

  private async recalculateGuaranteeFloor(
    jobSeekerId: string,
    actorId: string,
  ): Promise<{ guaranteeFloorPaise: number | null } | null> {
    const policy = await this.getPolicy();
    const change = await this.prisma.$transaction(async (tx) => {
      const seeker = await tx.jobSeeker.findUnique({
        where: { id: jobSeekerId },
        include: { trades: true },
      });
      if (!seeker || seeker.paymentReceivedAt) return null;
      const primaryTrade = seeker.trades.find((trade) => trade.isPrimary);
      if (!primaryTrade) return null;
      const listedTrade = await tx.trade.findUnique({
        where: { nameKey: tradeNameKey(primaryTrade.trade) },
        select: { active: true, salaryMaxPaise: true },
      });
      const monthlyMinimum = seeker.salaryPeriod === 'daily'
        ? seeker.minSalary * policy.salaryDaysPerMonth
        : seeker.minSalary;
      if (!Number.isSafeInteger(monthlyMinimum)) {
        throw new BadRequestException('Monthly salary conversion exceeds the supported integer range');
      }
      const floor = listedTrade?.active
        ? Math.min(monthlyMinimum, listedTrade.salaryMaxPaise)
        : null;
      if (floor === seeker.guaranteeFloorPaise) return null;
      const updated = await tx.jobSeeker.updateMany({
        where: { id: seeker.id, paymentReceivedAt: null },
        data: { guaranteeFloorPaise: floor },
      });
      if (updated.count !== 1) return null;
      return {
        code: seeker.code,
        city: seeker.city,
        beforePaise: seeker.guaranteeFloorPaise,
        afterPaise: floor,
      };
    });
    if (!change) return null;
    await this.auditService.log({
      actorId,
      action: 'job_seeker.guarantee_floor_recalculated',
      entityType: 'job_seeker',
      entityCode: change.code,
      before: { guaranteeFloorPaise: change.beforePaise },
      after: { guaranteeFloorPaise: change.afterPaise },
      changedFields: ['guaranteeFloorPaise'],
      city: change.city,
    });
    return { guaranteeFloorPaise: change.afterPaise };
  }

  /**
   * ANTI-FRAUD NOTE: Candidate onboarding already carries mobile-number OTP verification,
   * which is the control that makes field-agent candidate capture safe.
   * Do not remove or weaken it, and do not add a bypass for field agents.
   */
  async create(dto: CreateJobSeekerDto, actorId: string) {
    assertNoRawAadhaar(dto);
    const policy = await this.getPolicy();
    const now = this.consentClock?.now();
    if (!now) throw new Error('ConsentClock is not configured');
    const form = validateJobSeekerRegistration(
      dto,
      policy.adultMinimumAge,
      now,
    );
    const phone = form.phone;

    const isVerified = await this.otpService.isVerified(dto.otpRequestId, phone);
    if (!isVerified) {
      throw new BadRequestException('Mobile number must pass OTP verification before registration');
    }

    if (dto.referredById && dto.heardFrom !== 'referral_partner') {
      throw new BadRequestException('referredById can only be used when heardFrom is referral_partner');
    }
    if (dto.heardFrom === 'referral_partner' && dto.referredById) {
      const referral = await this.prisma.referral.findUnique({
        where: { id: dto.referredById },
      });
      if (!referral) {
        throw new BadRequestException(`Referral partner with id '${dto.referredById}' does not exist`);
      }
      if (sameIndianMobile(referral.phone, phone)) {
        throw new BadRequestException('A referral partner cannot refer themselves');
      }
      if (referral.pausedAt) {
        // Guide, Referral partners: a paused partner's new referrals are refused.
        throw new BadRequestException(
          `Referral partner ${referral.code} is paused by the CEO and cannot take new referrals. Register this person without the partner, or ask the CEO.`,
        );
      }
    }

    const existing = await this.prisma.jobSeeker.findFirst({
      where: { phone: { in: mobileLookupValues(phone) } },
    });
    if (existing) {
      // Guide (Forms): a number already registered shows "Already registered — open it"
      // instead of creating a second record, so the answer names the existing record.
      throw new ConflictException({
        statusCode: 409,
        error: 'Conflict',
        message: 'Already registered — open it. A job seeker with this mobile number already exists',
        existingJobSeekerCode: existing.code,
      });
    }
    const code = await this.idService.generateCode('job_seeker');

    const primaryTrade = form.trades[0];
    const managedTrade = await this.prisma.trade.findUnique({
      where: { nameKey: tradeNameKey(primaryTrade.trade) },
      select: { active: true, salaryMinPaise: true, salaryMaxPaise: true },
    });
    const salaryDaysPerMonth = policy.salaryDaysPerMonth;
    const monthlyMinimum = dto.salaryPeriod === 'daily'
      ? dto.minSalary * salaryDaysPerMonth
      : dto.minSalary;
    if (!Number.isSafeInteger(monthlyMinimum)) {
      throw new BadRequestException('Monthly salary conversion exceeds the supported integer range');
    }
    const tradeSalaryRange = managedTrade?.active ? {
      minSalaryPaise: managedTrade.salaryMinPaise,
      maxSalaryPaise: managedTrade.salaryMaxPaise,
    } : null;
    const guaranteeFloorPaise = tradeSalaryRange
      ? Math.min(monthlyMinimum, tradeSalaryRange.maxSalaryPaise)
      : null;
    const warnings = tradeSalaryRange && monthlyMinimum > tradeSalaryRange.maxSalaryPaise
      ? ['salary_above_market'] as const
      : [] as const;

    /**
     * RATIONALE FOR AGENT ATTRIBUTION (Phase 6.7 Task 1):
     * registeredByStaffId records which staff member onboarded this candidate.
     * These columns are what make per-agent measurement possible at all, and they
     * are what makes the §4 anti-fraud controls investigable — a geofence flag or
     * a duplicate-selfie detection is only actionable if the record names who created it.
     * They are NOT for pay: agents are salaried, there is no commission.
     */
    const status = 'lead';

    const otpConsumed = await this.otpService.consumeVerified(dto.otpRequestId, phone);
    if (!otpConsumed) {
      throw new BadRequestException('This verified OTP request has already been used or expired');
    }

    const jobSeeker = await this.prisma.$transaction(async (tx) => {
      const created = await tx.jobSeeker.create({
        data: {
          code,
          name: form.name,
          phone,
          phoneVerified: true,
          minSalary: dto.minSalary,
          maxSalary: dto.maxSalary,
          preferredCallWindowStart: form.preferredCallWindowStart,
          preferredCallWindowEnd: form.preferredCallWindowEnd,
          city: dto.city ?? 'Bengaluru',
          status,
          dateOfBirth: form.dateOfBirth,
          messageLanguage: dto.messageLanguage,
          heardFrom: dto.heardFrom,
          gender: dto.gender.trim(),
          locality: dto.locality.trim(),
          pincode: dto.pincode.trim(),
          latitude: dto.latitude,
          longitude: dto.longitude,
          travelDistanceKm: dto.travelDistanceKm,
          availableFrom: form.availableFrom,
          lookingSince: form.lookingSince,
          salaryPeriod: dto.salaryPeriod,
          shiftPreference: dto.shiftPreference,
          jobType: dto.jobType,
          guaranteeFloorPaise,
          referredById: dto.referredById ?? null,
          registeredByStaffId: actorId ?? null,
        },
      });

      for (const [index, trade] of form.trades.entries()) {
        await tx.jobSeekerTrade.create({
          data: {
            jobSeekerId: created.id,
            trade: normalizeTradeName(trade.trade),
            yearsExperience: trade.yearsExperience,
            isPrimary: index === 0,
          },
        });
        await this.tradeService.recordSuggestion(tx, trade.trade, actorId ?? null, 'job_seeker', created.id);
      }
      await tx.jobSeekerLanguage.createMany({
        data: form.spokenLanguages.map((language) => ({
          jobSeekerId: created.id,
          language,
          speaks: true,
          reads: false,
          writes: false,
        })),
      });

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
      after: { created: true, status: 'lead' },
      changedFields: [
        'name', 'phone', 'messageLanguage', 'bestTimeToCall', 'dateOfBirth', 'gender', 'heardFrom',
        'locality', 'pincode', 'latitude', 'longitude', 'travelDistanceKm', 'trades', 'availableFrom',
        'lookingSince', 'salaryRange', 'salaryPeriod', 'shiftPreference', 'jobType', 'spokenLanguages',
        'referredById', 'guaranteeFloorPaise',
      ],
      city: jobSeeker.city,
    });

    return {
      ...jobSeeker,
      warnings: [...warnings],
      ...(tradeSalaryRange ? { salaryRange: tradeSalaryRange } : {}),
    };
  }

  /**
   * The job seeker list. A Team Lead sees only the job seekers their own team
   * registered (themselves and the agents who report to them) — the role
   * table's "own team" (M3). `limit`/`offset` page the list when given.
   */
  async findAll(actor?: { id: string; role: string }, page: { limit?: number; offset?: number } = {}) {
    const where: Prisma.JobSeekerWhereInput = {};
    if (actor?.role === 'team_lead') {
      const team = await this.prisma.staff.findMany({ where: { teamLeadId: actor.id }, select: { id: true } });
      where.registeredByStaffId = { in: [actor.id, ...team.map((t) => t.id)] };
    }
    const take = page.limit !== undefined ? Math.min(Math.max(Math.trunc(page.limit), 1), 500) : undefined;
    const skip = page.offset !== undefined ? Math.max(Math.trunc(page.offset), 0) : undefined;
    const seekers = await this.prisma.jobSeeker.findMany({
      where,
      include: {
        trades: true,
        identityVerifications: { orderBy: { createdAt: 'desc' }, take: 1 },
      },
      orderBy: { createdAt: 'desc' },
      ...(take !== undefined ? { take } : {}),
      ...(skip !== undefined ? { skip } : {}),
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

    if (jobSeeker.status === 'deactivated' || jobSeeker.status === 'refunded') {
      throw new BadRequestException(
        `Job seeker is ${jobSeeker.status}. Use /job-seekers/:id/reactivate to reactivate`,
      );
    }

    const policy = await this.getPolicy();
    await this.assertAdultBeforePayment(jobSeeker, policy.adultMinimumAge);

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

  /** Under 18 stops registration before any payment (Master Guide, ID check). */
  private async assertAdultBeforePayment(
    jobSeeker: { id: string; dateOfBirth: Date | null },
    adultMinimumAge: number,
  ) {
    const now = this.consentClock?.now() ?? new Date();
    if (jobSeeker.dateOfBirth && calculateAge(jobSeeker.dateOfBirth, now) < adultMinimumAge) {
      throw new BadRequestException('Registration stops before payment: the job seeker is under 18');
    }
    const latest = await this.prisma.identityVerification.findFirst({
      where: { jobSeekerId: jobSeeker.id },
      orderBy: { createdAt: 'desc' },
      select: { isAdult: true },
    });
    if (latest?.isAdult === false) {
      throw new BadRequestException('Registration stops before payment: the ID check shows the job seeker is under 18');
    }
  }

  /**
   * The registration link's last step (Phase 20 Task 5): the exact terms he agrees to before paying —
   * trade, distance, shift and the salary floor. Refused until consent, selfie and ID are done, and while his
   * only trade is an unlisted Other (no floor yet).
   */
  async registrationTerms(jobSeekerId: string) {
    const seeker = await this.prisma.jobSeeker.findUnique({
      where: { id: jobSeekerId },
      include: { trades: true },
    });
    if (!seeker) throw new NotFoundException(`Job seeker '${jobSeekerId}' not found`);
    const policy = await this.getPolicy();
    if (!this.consentService || !(await this.consentService.hasAllRequired('job_seeker', seeker.id))) {
      throw new BadRequestException('Consent comes first: finish the consent step');
    }
    if (!seeker.photoStoragePath) throw new BadRequestException('Take the selfie first');
    const verification = await this.prisma.identityVerification.findFirst({
      where: { jobSeekerId: seeker.id },
      orderBy: { createdAt: 'desc' },
    });
    if (!verification || verification.status !== 'verified' || verification.nameMatches === false) {
      throw new BadRequestException('Finish the ID check first');
    }
    await this.assertAdultBeforePayment(seeker, policy.adultMinimumAge);
    if (seeker.guaranteeFloorPaise === null) {
      throw new BadRequestException('Waiting for the new trade to be added in the Command Center');
    }
    const primary = seeker.trades.find((trade) => trade.isPrimary) ?? seeker.trades[0];
    return {
      jobSeekerCode: seeker.code,
      trade: primary?.trade ?? null,
      travelDistanceKm: seeker.travelDistanceKm,
      locality: seeker.locality ?? null,
      shiftPreference: seeker.shiftPreference,
      jobType: seeker.jobType ?? null,
      guaranteeFloorPaise: seeker.guaranteeFloorPaise,
      guaranteeDays: policy.jobSeekerGuaranteeDays,
      amountPaise: policy.activationFeePaise,
      termsAcceptedAt: seeker.termsAcceptedAt,
    };
  }

  /** He ticks to agree to the terms shown; the ₹499 payment request is then created (or the open one returned). */
  async acceptTermsAndCreatePayment(jobSeekerId: string, acceptTerms: unknown) {
    if (acceptTerms !== true) throw new BadRequestException('Tick to agree to the terms before paying');
    const terms = await this.registrationTerms(jobSeekerId);
    const now = this.consentClock?.now() ?? new Date();
    await this.prisma.jobSeeker.updateMany({
      where: { id: jobSeekerId, paymentReceivedAt: null },
      data: { termsAcceptedAt: now, termsAcceptedFloorPaise: terms.guaranteeFloorPaise },
    });
    const seeker = await this.prisma.jobSeeker.findUniqueOrThrow({ where: { id: jobSeekerId } });
    await this.auditService.log({
      actorId: 'system',
      action: 'job_seeker.terms_accepted',
      entityType: 'job_seeker',
      entityCode: seeker.code,
      after: { termsAcceptedAt: now.toISOString(), guaranteeFloorPaise: terms.guaranteeFloorPaise },
      changedFields: ['termsAcceptedAt', 'termsAcceptedFloorPaise'],
      city: seeker.city,
    });
    const payment = await this.createActivationPayment(jobSeekerId);
    return { terms: { ...terms, termsAcceptedAt: now }, payment };
  }

  async reactivate(jobSeekerId: string, actorId: string) {
    const jobSeeker = await this.prisma.jobSeeker.findUnique({
      where: { id: jobSeekerId },
    });
    if (!jobSeeker) {
      throw new NotFoundException(`Job seeker '${jobSeekerId}' not found`);
    }

    // Deactivated after 3 hits, closed after finding a job on his own, or refunded: he
    // comes back by paying ₹499 again, which resets the hits and starts a fresh 30-day
    // guarantee (Master Guide; the win-back list asks refunded people to register again).
    if (!REACTIVATABLE_STATUSES.includes(jobSeeker.status)) {
      throw new BadRequestException(
        `Job seeker must be deactivated, closed or refunded to be reactivated. Current status: '${jobSeeker.status}'`,
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

    // "Not picked up" comes only from the phone system (Master Guide): the automated
    // sweep records it from call-webhook and messaging attempts. No staff role can.
    const isHumanActor = Boolean(actorId && actorId !== 'system');
    if (isHumanActor && reason === 'no_pickup') {
      const refusalMessage =
        "'Not picked up' hits come only from the phone system and the automated sweep. Staff may record only 'offer_declined' (or 'offer_rejected'), 'offer_no_reply' or 'interview_no_show' hits.";

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

  /**
   * Master Guide (decided 9 Nov): a job seeker who finds a job on his own (not through
   * Laboura) gets no refund; his profile is closed and he can come back later. Because
   * this costs him the ₹499 refund it is backed by an answered, recorded call with him.
   */
  async recordFoundOwnJob(
    jobSeekerId: string,
    actorId: string,
    input: { reason?: string | null; callRecordId?: string | null; followUpTaskId?: string | null },
  ) {
    const reason = input.reason?.trim();
    if (!reason) throw new BadRequestException('A reason is required to record that he found a job on his own');
    if (!input.callRecordId) {
      throw new BadRequestException('callRecordId of an answered call with him is required: it backs the end of his refund');
    }
    const seeker = await this.prisma.jobSeeker.findFirst({
      where: { OR: [{ id: jobSeekerId }, { code: jobSeekerId }] },
    });
    if (!seeker) throw new NotFoundException(`Job seeker '${jobSeekerId}' not found`);
    if (['closed', 'placed', 'deactivated'].includes(seeker.status)) {
      throw new BadRequestException(`Job seeker '${seeker.code}' is '${seeker.status}' and cannot be closed as found a job on his own`);
    }
    const call = await this.prisma.callRecord.findUnique({ where: { id: input.callRecordId } });
    if (!call || call.subjectType !== 'job_seeker' || call.subjectId !== seeker.id || !call.answered) {
      throw new BadRequestException('The call must be an answered call with this job seeker');
    }

    const now = this.consentClock?.now() ?? new Date();
    const updated = await this.prisma.$transaction(async (tx) => {
      const moved = await tx.jobSeeker.updateMany({
        where: { id: seeker.id, status: seeker.status },
        data: { status: 'closed', foundOwnJobAt: now },
      });
      if (moved.count !== 1) throw new ConflictException('The job seeker changed while saving; try again');
      await recordStatusChange(tx, {
        subjectType: 'job_seeker',
        subjectId: seeker.id,
        fromStatus: seeker.status,
        toStatus: 'closed',
        changedByStaffId: actorId,
        reason: 'found_own_job',
        changedAt: now,
      });
      return tx.jobSeeker.findUniqueOrThrow({
        where: { id: seeker.id },
        include: { trades: true, identityVerifications: { orderBy: { createdAt: 'desc' }, take: 1 } },
      });
    });
    await this.auditService.log({
      actorId,
      action: 'job_seeker.found_own_job',
      entityType: 'job_seeker',
      entityCode: seeker.code,
      before: { status: seeker.status, foundOwnJobAt: null },
      after: {
        status: 'closed',
        foundOwnJobAt: now.toISOString(),
        refund: 'blocked',
        callRecordId: call.id,
        followUpTaskId: input.followUpTaskId ?? null,
      },
      changedFields: ['status', 'foundOwnJobAt'],
      reason,
      city: seeker.city,
    });
    return withCurrentJobSeekerFields(updated);
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

    // A caller's asOf stands in for the clock only in tests; production uses the server clock.
    const now = decisionTime(dto?.asOf);

    const guards = await loadJobSeekerRefundGuards(this.prisma, jobSeeker);

    const policy = await this.getPolicy();
    const activationPayment = await this.prisma.payment.findFirst({
      where: {
        jobSeekerId: jobSeeker.id,
        type: { in: ['activation', 'reactivation'] },
        status: { in: ['completed', 'succeeded'] },
      },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    });

    // A refund in his current guarantee: the one that gives back his latest paid ₹499
    // (by link; timestamps only for refunds made before the link existed). Paying again
    // after a refund starts a new guarantee (Master Guide), which may end in a refund of
    // its own. A payout the bank refused is retried, never made again.
    const existingRefundWhere = currentGuaranteeRefundWhere(jobSeeker.id, {
      latestPaidActivationId: activationPayment?.id ?? null,
      paymentReceivedAt: jobSeeker.paymentReceivedAt,
    });
    const existingRefund = await this.prisma.payment.findFirst({ where: existingRefundWhere });

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

    // Goodwill (outside the rules): the CEO alone can give a ₹499 refund the rules do not
    // allow, with a written reason, audited (Master Guide: "Any refund outside the rules
    // (goodwill) always needs the CEO"). Finance cannot. Only the basics are checked: he
    // paid, and nothing has been refunded in this guarantee already.
    const goodwill = dto?.goodwill === true;
    const note = typeof dto?.reason === 'string' && dto.reason.trim() ? dto.reason.trim().slice(0, 500) : null;
    if (goodwill) {
      if (actor.role !== 'ceo') {
        throw new ForbiddenException({
          statusCode: 403,
          error: 'Forbidden',
          code: 'goodwill_needs_ceo',
          message: 'A ₹499 refund outside the rules (goodwill) is the CEO\'s decision. Finance cannot approve one.',
        });
      }
      if (!note) {
        throw new BadRequestException('A refund outside the rules (goodwill) needs a written reason');
      }
      if (!jobSeeker.paymentReceivedAt || !activationPayment) {
        throw new BadRequestException(`Job seeker '${jobSeeker.code}' has no ₹499 received, so nothing can be refunded`);
      }
      if (existingRefund) {
        throw alreadyExists(`A refund for job seeker ${jobSeeker.code}`, existingRefund);
      }
    }

    // R4: say so first when this guarantee's refund was rejected (checked again under the lock below).
    if (jobSeeker.paymentReceivedAt) {
      const rejected = await findRefundRejection(this.prisma, { jobSeekerId: jobSeeker.id, guaranteeStartedAt: jobSeeker.paymentReceivedAt });
      assertRejectionOverride(rejected, actor, { overrideRejection: dto?.overrideRejection, reason: note });
    }

    const eligibilityResult = goodwill
      ? null
      : evaluateJobSeekerRefundEligibility(
          {
            code: jobSeeker.code,
            paymentReceivedAt: jobSeeker.paymentReceivedAt,
            status: jobSeeker.status,
            hasOfferRejectedHit: guards.hasOfferRejectedHit,
            hasExistingRefund: Boolean(existingRefund),
            activationPaymentPaise: activationPayment?.amount,
            guaranteeDays: policy.jobSeekerGuaranteeDays,
            hasWithdrawnEssentialConsent: Boolean(withdrawnConsent),
            hasOpenBypassFlag: Boolean(openBypassFlag),
            hasWorkingAtIntroducedBusinessFollowUp: Boolean(bypassFollowUp),
            refundCheckRecorded: guards.refundCheckRecorded,
            refundCheckWorkingElsewhere: guards.refundCheckWorkingElsewhere,
            hasOpenOfferReply: guards.hasOpenOfferReply,
          },
          now,
        );

    if (eligibilityResult && !eligibilityResult.eligible) {
      throw new BadRequestException(eligibilityResult.ineligibleReason!);
    }
    // The stored ₹499 he paid (old records never change), under the rules or as goodwill.
    const refundAmount = eligibilityResult ? eligibilityResult.amountPaise : activationPayment!.amount;

    const paymentCode = await this.idService.generateCode('payment');
    // H2: one refund per ₹499 even when Approve is tapped twice or retried. The lock
    // makes the second request wait for the first; it then finds the refund and stops.
    // The partial unique index on refundsPaymentId refuses a second one in any case.
    let payment;
    try {
      payment = await this.prisma.$transaction(async (tx) => {
        await lockSubject(tx, refundLockKey.jobSeeker(jobSeeker.id));
        const again = await tx.payment.findFirst({ where: existingRefundWhere });
        if (again) throw alreadyExists(`A refund for job seeker ${jobSeeker.code}`, again);
        // R4: a refund rejected for this guarantee is raised again only by the CEO, overriding with a reason.
        if (jobSeeker.paymentReceivedAt) {
          const rejected = await findRefundRejection(tx, { jobSeekerId: jobSeeker.id, guaranteeStartedAt: jobSeeker.paymentReceivedAt });
          assertRejectionOverride(rejected, actor, { overrideRejection: dto?.overrideRejection, reason: note });
        }

        const p = await tx.payment.create({
          data: {
            code: paymentCode,
            city: jobSeeker.city,
            type: 'refund',
            amount: refundAmount,
            status: 'approved',
            approvedByStaffId: actor.id,
            approvedAt: now,
            gatewayReference: null,
            subjectType: 'job_seeker',
            subjectId: jobSeeker.id,
            jobSeekerId: jobSeeker.id,
            refundsPaymentId: activationPayment?.id ?? null,
            outsideRules: goodwill,
            approvalNote: goodwill ? note : null,
          },
        });

        await recordStatusChange(tx, {
          subjectType: 'payment',
          subjectId: p.id,
          fromStatus: null,
          toStatus: 'approved',
          changedByStaffId: actor.id,
          reason: goodwill ? 'goodwill_refund_approved_by_ceo' : 'job_seeker_guarantee_refund',
        });

        // His ₹499 goes back, so he leaves the matching pool until he pays again.
        await markJobSeekerRefunded(tx, jobSeeker, actor.id, now);

        return p;
      });
    } catch (error) {
      if (isDuplicatePayout(error)) {
        throw alreadyExists(
          `A refund for job seeker ${jobSeeker.code}`,
          await this.prisma.payment.findFirst({ where: existingRefundWhere }),
        );
      }
      throw error;
    }

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
        outsideRules: goodwill,
        approvedByRole: actor.role,
        refundsPaymentId: payment.refundsPaymentId,
      },
      ...(goodwill ? { reason: note! } : {}),
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

    const res = await this.anonymisationService.anonymise(
      'job_seeker',
      id,
      'DPDP erasure request',
      actorId,
    );
    if (res.message.includes('already')) {
      return {
        message: 'Job seeker already erased',
        id: res.id,
        code: res.code,
        anonymisedAt: res.anonymisedAt,
      };
    }

    const updated = await this.prisma.jobSeeker.findUniqueOrThrow({
      where: { id: res.id },
      include: {
        trades: true,
        identityVerifications: { orderBy: { createdAt: 'desc' }, take: 1 },
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
    if (targetStatus === 'closed') {
      throw new BadRequestException("Use 'found a job on his own' to close a profile; it records why the refund ends");
    }
    // These come only from what happened, never by hand: "refunded" from an approved ₹499
    // refund, "deactivated" from the third hit (guide check 12 Nov).
    if (targetStatus === 'refunded') {
      throw new BadRequestException('A profile becomes refunded only when his ₹499 refund is approved');
    }
    if (targetStatus === 'deactivated') {
      throw new BadRequestException('A profile is deactivated only by the third hit');
    }

    const seeker = await this.prisma.jobSeeker.findUnique({
      where: { id: jobSeekerId },
    });
    if (!seeker) {
      throw new NotFoundException(`Job seeker '${jobSeekerId}' not found`);
    }
    // Coming back from deactivated, closed or refunded takes a new ₹499 payment, which
    // resets the hits and starts a new guarantee: use reactivate, never a plain status change.
    if (targetStatus === 'active' && REACTIVATABLE_STATUSES.includes(seeker.status)) {
      throw new BadRequestException(
        `A ${seeker.status} profile becomes active again only when he pays ₹499 again: use /job-seekers/:id/reactivate`,
      );
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
    // Numbers are compared and saved as +91 and 10 digits, so "9876543210" for a
    // saved "+919876543210" is no change (and needs no OTP).
    if (typeof filteredDto.phone === 'string' && filteredDto.phone.trim()) {
      filteredDto.phone = requireIndianMobile(filteredDto.phone, 'phone');
    }
    if ('whatsappPhone' in filteredDto) {
      filteredDto.whatsappPhone = optionalIndianMobile(filteredDto.whatsappPhone, 'whatsappPhone');
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

    // Master Guide: if his number changes, the agent checks the NEW number by OTP, and
    // the live registration link (which carries the old number) is switched off.
    let phoneChange: { otpRequestId: string; phone: string } | null = null;
    if (diff.changedFields.includes('phone')) {
      const newPhone = typeof filteredDto.phone === 'string' ? filteredDto.phone.trim() : '';
      if (!newPhone) throw new BadRequestException('A new mobile number is required');
      const otpRequestId = typeof dto.phoneOtpRequestId === 'string' ? dto.phoneOtpRequestId
        : typeof dto.otpRequestId === 'string' ? dto.otpRequestId : null;
      if (!otpRequestId) {
        throw new BadRequestException('Changing the mobile number needs an OTP check on the new number: send an OTP to it and pass phoneOtpRequestId');
      }
      if (!(await this.otpService.isVerified(otpRequestId, newPhone))) {
        throw new BadRequestException('The new mobile number must pass OTP verification before it is saved');
      }
      const taken = await this.prisma.jobSeeker.findFirst({
        where: { phone: { in: mobileLookupValues(newPhone) }, id: { not: record.id as string } },
        select: { id: true, code: true },
      });
      if (taken && taken.id !== record.id) {
        throw new ConflictException({
          statusCode: 409,
          error: 'Conflict',
          message: 'Already registered — open it. A job seeker with this mobile number already exists',
          existingJobSeekerCode: taken.code,
        });
      }
      filteredDto.phone = newPhone;
      phoneChange = { otpRequestId, phone: newPhone };
    }
    if (phoneChange && !(await this.otpService.consumeVerified(phoneChange.otpRequestId, phoneChange.phone))) {
      throw new BadRequestException('This verified OTP request has already been used or expired');
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
      data: phoneChange ? { ...data, phoneVerified: true } : data,
      include: { trades: true, identityVerifications: { orderBy: { createdAt: 'desc' }, take: 1 } },
    });

    if (phoneChange) {
      const now = this.consentClock?.now() ?? new Date();
      const revoked = this.publicLinks
        ? await this.publicLinks.revokeActive('registration', 'job_seeker', updated.id, now)
        : { count: 0 };
      await this.auditService.log({
        actorId: editActor.id,
        action: 'job_seeker.phone_changed',
        entityType: 'job_seeker',
        entityCode: updated.code,
        after: { phoneVerifiedByOtp: true, registrationLinksRevoked: revoked.count },
        // The number itself is logged (as "[changed]") by the job_seeker.update entry.
        changedFields: ['phoneVerified'],
        reason: reason ?? 'Mobile number changed after OTP on the new number',
        city: updated.city,
      });
    }

    let guaranteeFloorPaise = updated.guaranteeFloorPaise;
    if (diff.changedFields.some((field) => ['minSalary', 'salaryPeriod'].includes(field))) {
      const recalculated = await this.recalculateGuaranteeFloor(updated.id, editActor.id);
      if (recalculated) guaranteeFloorPaise = recalculated.guaranteeFloorPaise;
    }

    await this.editPolicyService.logEdit({
      actorId: editActor.id,
      entityType: 'job_seeker',
      entityCode: record.code as string,
      diff,
      reason,
      city: record.city as string | undefined,
    });

    return withCurrentJobSeekerFields({ ...updated, guaranteeFloorPaise });
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

  async getRegistrationStatus(jobSeekerId: string) {
    const seeker = await this.prisma.jobSeeker.findUnique({
      where: { id: jobSeekerId },
      include: {
        identityVerifications: { orderBy: { createdAt: 'desc' }, take: 1 },
        payments: { where: { type: 'activation' }, orderBy: { createdAt: 'desc' }, take: 1 },
      },
    });
    if (!seeker) throw new NotFoundException(`Job seeker '${jobSeekerId}' not found`);
    const now = this.consentClock?.now() ?? new Date();
    const [consents, link, paymentOnlyLink, idService] = await Promise.all([
      this.prisma.consent.findMany({
        where: { subjectType: 'job_seeker', subjectId: seeker.id, granted: true, withdrawnAt: null },
        orderBy: { grantedAt: 'desc' },
      }),
      this.prisma.publicLink.findFirst({
        where: { purpose: 'registration', subjectType: 'job_seeker', subjectId: seeker.id, revokedAt: null, usedAt: null, expiresAt: { gt: now } },
        orderBy: { createdAt: 'desc' },
        select: { expiresAt: true },
      }),
      this.prisma.publicLink.findFirst({
        where: { purpose: 'payment_only', subjectType: 'job_seeker', subjectId: seeker.id, revokedAt: null, usedAt: null, expiresAt: { gt: now } },
        orderBy: { createdAt: 'desc' },
        select: { expiresAt: true },
      }),
      this.prisma.kycServiceState.findUnique({ where: { id: 'id-check' } }),
    ]);
    const latestVerification = seeker.identityVerifications[0];
    const latestPayment = seeker.payments[0];
    const requiredConsents = ['job_matching', 'profile_sharing', 'call_recording', 'aadhaar_verification', 'job_updates'];
    const consentCount = requiredConsents.filter((purpose) => consents.some((consent) => consent.purpose === purpose)).length;
    const phone = { state: seeker.phoneVerified ? 'done' : 'not_started', time: seeker.phoneVerified ? seeker.createdAt : null, reason: null };
    const consent = {
      state: consentCount === requiredConsents.length ? 'done' : consentCount > 0 ? 'in_progress' : 'not_started',
      time: consents[0]?.grantedAt ?? null,
      reason: null,
    };
    const selfie = {
      state: seeker.photoStoragePath ? 'done' : 'not_started',
      time: seeker.photoTakenAt,
      reason: null,
    };
    const idCheck = {
      state: latestVerification?.status === 'verified' ? 'done' : idService?.status === 'down' ? 'stuck' : latestVerification ? 'in_progress' : 'not_started',
      time: latestVerification?.verifiedAt ?? latestVerification?.createdAt ?? null,
      reason: idService?.status === 'down' ? 'ID check service is temporarily unavailable' : latestVerification?.failureReason ?? null,
    };
    const payment = {
      state: latestPayment?.status === 'succeeded' || latestPayment?.status === 'completed'
        ? 'done'
        : seeker.guaranteeFloorPaise === null
          ? 'stuck'
          : latestPayment?.status === 'pending'
            ? 'in_progress'
            : 'not_started',
      time: latestPayment?.confirmedAt ?? latestPayment?.createdAt ?? null,
      reason: seeker.guaranteeFloorPaise === null ? 'Waiting for the new trade to be added in the Command Center' : null,
    };
    return {
      jobSeekerId: seeker.id,
      steps: { phone, consent, selfie, idCheck, payment },
      registrationLinkExpiresAt: link?.expiresAt ?? null,
      paymentOnlyLink: { live: Boolean(paymentOnlyLink), expiresAt: paymentOnlyLink?.expiresAt ?? null },
    };
  }

  async createPaymentOnlyLink(jobSeekerId: string, recipientPhone: string, actorId: string, relation?: string) {
    if (!this.publicLinks || !this.messagingService) throw new BadRequestException('Payment-only links are not configured');
    if (relation !== undefined && relation !== null && !(PAYMENT_PAYER_RELATIONS as readonly string[]).includes(relation)) {
      throw new BadRequestException(`relation must be one of: ${PAYMENT_PAYER_RELATIONS.join(', ')}`);
    }
    const phone = requireIndianMobile(recipientPhone, 'phone');
    const seeker = await this.prisma.jobSeeker.findUnique({ where: { id: jobSeekerId } });
    if (!seeker) throw new NotFoundException(`Job seeker '${jobSeekerId}' not found`);
    if (sameIndianMobile(phone, seeker.phone)) {
      throw new BadRequestException('The payment-only link must use another number');
    }
    const payment = await this.prisma.payment.findFirst({
      where: { jobSeekerId: seeker.id, type: 'activation', status: 'pending', expectedAmountPaise: { not: null } },
      orderBy: { createdAt: 'desc' },
    });
    if (!payment) throw new BadRequestException('A pending activation payment is required before sending a payment-only link');

    const now = this.consentClock?.now() ?? new Date();
    await this.publicLinks.revokeActive('payment_only', 'job_seeker', seeker.id, now);
    const expiresAt = new Date(now.getTime() + 15 * 60 * 1000);
    const { token } = await this.publicLinks.create({
      purpose: 'payment_only',
      subjectType: 'job_seeker',
      subjectId: seeker.id,
      phone,
      language: seeker.messageLanguage ?? 'en',
      expiresAt,
      createdByStaffId: actorId,
      metadata: { paymentId: payment.id, ...(relation ? { relation } : {}) },
    });
    await this.messagingService.send({
      channel: 'sms',
      template: 'payment_only_link',
      subjectType: 'job_seeker',
      subjectId: seeker.id,
      recipientPhone: phone,
      variables: {
        link: publicPageLink('paymentOnly', token),
        firstName: seeker.name.trim().split(/\s+/)[0] ?? seeker.name,
        code: seeker.code,
        amountPaise: String(payment.expectedAmountPaise),
      },
    });
    await this.auditService.log({
      actorId,
      action: 'job_seeker.payment_only_link_created',
      entityType: 'job_seeker',
      entityCode: seeker.code,
      before: null,
      after: { expiresAt: expiresAt.toISOString(), ...(relation ? { relation } : {}) },
      changedFields: ['paymentOnlyLink'],
      city: seeker.city,
    });
    return { success: true, expiresAt };
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

    const normalizedTrade = normalizeTradeName(dto.trade);
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

    const created = await this.prisma.$transaction(async (tx) => {
      const row = await tx.jobSeekerTrade.create({
        data: {
          jobSeekerId,
          trade: normalizedTrade,
          yearsExperience: dto.yearsExperience ?? 0,
          isPrimary,
        },
      });
      await this.tradeService.recordSuggestion(tx, normalizedTrade, actorId ?? null, 'job_seeker', jobSeekerId);
      return row;
    });

    if (isPrimary) {
      await this.recalculateGuaranteeFloor(jobSeekerId, actorId ?? 'system');
    }

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
      const normalized = normalizeTradeName(dto.trade);
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
    if (typeof data.trade === 'string') {
      await this.prisma.$transaction((tx) => this.tradeService.recordSuggestion(
        tx,
        data.trade as string,
        actorId ?? null,
        'job_seeker',
        jobSeekerId,
      ));
    }
    if (trade.isPrimary || dto.isPrimary === true || typeof data.trade === 'string') {
      await this.recalculateGuaranteeFloor(jobSeekerId, actorId ?? 'system');
    }

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
      await this.recalculateGuaranteeFloor(jobSeekerId, actorId ?? 'system');
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

  async verifyIdentityWithProvider(jobSeekerId: string, dto: Record<string, unknown>, actorId: string) {
    assertNoRawAadhaar(dto);
    if (!this.kycRecovery) throw new BadRequestException('KYC provider is not available');
    const seeker = await this.prisma.jobSeeker.findUnique({ where: { id: jobSeekerId } });
    if (!seeker) throw new NotFoundException(`Job seeker not found: ${jobSeekerId}`);
    if (!this.consentService || !(await this.consentService.hasConsent('job_seeker', seeker.id, 'aadhaar_verification'))) {
      throw new BadRequestException('Consent for aadhaar_verification is required before identity verification can be requested');
    }

    const result = await this.kycRecovery.verify({
      ...dto,
      candidateName: seeker.name,
      dateOfBirth: seeker.dateOfBirth?.toISOString().slice(0, 10),
    });
    const verification = await this.createIdentityVerification(jobSeekerId, {
      method: dto.method ?? 'digilocker',
      vendor: 'configured_kyc_provider',
      vendorReference: result.vendorReference,
      status: result.status,
      last4: result.last4,
      nameMatches: result.nameMatches,
      isAdult: result.isAdult,
      failureReason: result.error,
    }, actorId);
    if (result.nameMatches === false && this.reviewFlagService) {
      await this.reviewFlagService.raise({
        kind: 'name_check',
        subjectType: 'job_seeker',
        subjectId: seeker.id,
        raisedForStaffId: seeker.registeredByStaffId,
        details: { identityVerificationId: verification.id, reviewRequired: true },
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
    if (hit.supersededAt) {
      throw new BadRequestException(
        `Hit '${hitId}' is from an earlier guarantee that was reset when he paid ₹499 again; it no longer counts`,
      );
    }

    let role = actorRole;
    if (!role) {
      const actorStaff = await this.prisma.staff.findUnique({ where: { id: actorId }, select: { role: true } });
      role = actorStaff?.role;
    }
    if (role === 'team_lead') {
      await this.assertTeamLeadMayReverseHit(hit, actorId, reversalReason.trim());
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

  /**
   * Master Guide: a Team Lead handles hit removals for their own team, and a third hit
   * removal on one job seeker goes to the Manager. "Own team" is the team of the staff
   * member who registered the job seeker (or the Team Lead themself).
   */
  private async assertTeamLeadMayReverseHit(
    hit: { id: string; reason: string; jobSeekerId: string; jobSeeker: { id: string; code: string; registeredByStaffId: string | null } },
    teamLeadId: string,
    reversalReason: string,
  ) {
    const registrarId = hit.jobSeeker.registeredByStaffId;
    const registrar = registrarId && registrarId !== teamLeadId
      ? await this.prisma.staff.findUnique({ where: { id: registrarId }, select: { teamLeadId: true } })
      : null;
    const ownTeam = registrarId === teamLeadId || registrar?.teamLeadId === teamLeadId;
    if (!ownTeam) {
      throw new ForbiddenException('Team Leads may reverse hits only for job seekers handled by their own team');
    }

    const earlierReversals = await this.prisma.jobSeekerHit.count({
      where: { jobSeekerId: hit.jobSeekerId, reversedAt: { not: null } },
    });
    if (earlierReversals < 2) return;

    const teamLead = await this.prisma.staff.findUnique({ where: { id: teamLeadId }, select: { reportsToId: true } });
    let flagCode: string | null = null;
    if (this.reviewFlagService) {
      const open = await this.prisma.reviewFlag.findFirst({
        where: { kind: 'hit_reversal_needs_manager', subjectType: 'job_seeker_hit', subjectId: hit.id, status: 'open' },
        select: { code: true },
      });
      flagCode = open?.code ?? (await this.reviewFlagService.raise({
        kind: 'hit_reversal_needs_manager',
        subjectType: 'job_seeker_hit',
        subjectId: hit.id,
        raisedForStaffId: teamLeadId,
        details: {
          jobSeekerId: hit.jobSeeker.id,
          jobSeekerCode: hit.jobSeeker.code,
          originalReason: hit.reason,
          requestedByStaffId: teamLeadId,
          managerStaffId: teamLead?.reportsToId ?? null,
          reversalReason,
          earlierReversals,
        },
      })).code;
    }
    throw new ForbiddenException(
      `This would be hit removal number ${earlierReversals + 1} for job seeker ${hit.jobSeeker.code}: a third hit removal goes to the Manager` +
        (flagCode ? ` (request ${flagCode} sent)` : ''),
    );
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


