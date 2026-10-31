import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.service';
import { IdService } from '../../common/id/id.service';
import { AuditService } from '../../common/audit/audit.service';
import { Prisma } from '@prisma/client';
import {
  calculatePlacementFee,
  calculateGst,
  formatINR,
  toRupees,
  isWithinReplacementGuarantee,
  replacementGuaranteeDeadline,
  REPLACEMENT_GUARANTEE_WINDOW_DAYS,
} from '../../common/money/money';
import { JobSeekerService } from '../job-seeker/job-seeker.service';
import { PaymentService } from '../payment/payment.service';
import { CreatePlacementDto } from './dto/create-placement.dto';
import { RespondPlacementDto } from './dto/respond-placement.dto';
import { RecordJoinedDto } from './dto/record-joined.dto';
import { RecordDropoutDto } from './dto/record-dropout.dto';
import { CreateReplacementCandidateDto } from './dto/create-replacement-candidate.dto';
import { RejectReplacementCandidateDto } from './dto/reject-replacement-candidate.dto';
import { ApprovePlacementRefundDto } from './dto/approve-refund.dto';
import { evaluatePlacementRefundEligibility } from './placement-refund-eligibility';
import {
  GstInvoiceResponse,
  InvoiceCustomer,
  InvoicePlacementInfo,
  InvoiceSupplier,
} from './dto/gst-invoice.dto';
import { ExportPlacementsQueryDto, RegulatoryPlacementExportRow } from './dto/export-placements.dto';

export function calculateDaysElapsed(
  startDate: Date,
  isPaused: boolean,
  pausedAt?: Date | null,
  asOf: Date = new Date(),
): number {
  const effectiveEnd = isPaused && pausedAt ? pausedAt : asOf;
  const diffMs = Math.max(0, effectiveEnd.getTime() - startDate.getTime());
  return Math.floor(diffMs / (1000 * 60 * 60 * 24));
}

@Injectable()
export class PlacementService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly idService: IdService,
    private readonly auditService: AuditService,
    private readonly jobSeekerService: JobSeekerService,
    private readonly paymentService: PaymentService,
  ) {}

  async create(vacancyId: string, dto: CreatePlacementDto, actorId: string) {
    const actor = await this.prisma.staff.findUnique({
      where: { id: actorId },
    });
    if (!actor) {
      throw new NotFoundException(`Staff '${actorId}' not found`);
    }

    const vacancy = await this.prisma.vacancy.findFirst({
      where: {
        OR: [{ id: vacancyId }, { code: vacancyId }],
      },
      include: { business: true },
    });
    if (!vacancy) {
      throw new NotFoundException(`Vacancy '${vacancyId}' not found`);
    }

    // Field agents can only place for vacancies in their assigned area
    if (actor.role === 'field_agent') {
      if (!actor.area || vacancy.business.area !== actor.area) {
        throw new ForbiddenException(
          `Field agent can only create placements for vacancies in their own area '${actor.area}', but vacancy belongs to '${vacancy.business.area}'`,
        );
      }
    }

    const agreedSalary = dto.agreedSalary ?? dto.monthlySalary;
    if (agreedSalary === undefined || agreedSalary <= 0 || !Number.isInteger(agreedSalary)) {
      throw new BadRequestException('agreedSalary must be a positive integer in paise');
    }

    if (!dto.jobSeekerId || typeof dto.jobSeekerId !== 'string') {
      throw new BadRequestException('jobSeekerId is required');
    }

    const jobSeeker = await this.prisma.jobSeeker.findFirst({
      where: {
        OR: [{ id: dto.jobSeekerId }, { code: dto.jobSeekerId }],
      },
    });
    if (!jobSeeker) {
      throw new NotFoundException(`Job seeker '${dto.jobSeekerId}' not found`);
    }

    if (jobSeeker.status === 'placed') {
      throw new BadRequestException(
        `Job seeker '${jobSeeker.code}' is already placed and cannot receive another offer`,
      );
    }

    if (jobSeeker.status === 'deactivated') {
      throw new BadRequestException(
        `Job seeker '${jobSeeker.code}' is deactivated and cannot receive an offer`,
      );
    }

    const placementFee = calculatePlacementFee(agreedSalary);
    const gstAmount = calculateGst(placementFee);
    const code = await this.idService.generateCode('placement');

    const placement = await this.prisma.placement.create({
      data: {
        code,
        city: vacancy.city,
        vacancyId: vacancy.id,
        jobSeekerId: jobSeeker.id,
        businessId: vacancy.businessId,
        agreedSalary,
        placementFee,
        gstAmount,
        status: 'offered',
      },
      include: {
        vacancy: true,
        jobSeeker: true,
        business: true,
      },
    });

    await this.auditService.log({
      action: 'placement_created',
      entityType: 'Placement',
      entityCode: placement.code,
      actorId: actor.id,
      city: placement.city,
      after: {
        status: placement.status,
        agreedSalary: placement.agreedSalary,
        placementFee: placement.placementFee,
        gstAmount: placement.gstAmount,
        vacancyId: vacancy.id,
        jobSeekerId: jobSeeker.id,
        businessId: vacancy.businessId,
      },
    });

    return placement;
  }

  async respond(id: string, dto: RespondPlacementDto, actorId: string) {
    const actor = await this.prisma.staff.findUnique({
      where: { id: actorId },
    });
    if (!actor) {
      throw new NotFoundException(`Staff '${actorId}' not found`);
    }

    const placement = await this.prisma.placement.findFirst({
      where: {
        OR: [{ id }, { code: id }],
      },
      include: {
        business: true,
        jobSeeker: true,
        vacancy: true,
      },
    });
    if (!placement) {
      throw new NotFoundException(`Placement '${id}' not found`);
    }

    if (actor.role === 'field_agent') {
      if (!actor.area || placement.business.area !== actor.area) {
        throw new ForbiddenException(
          `Field agent can only manage placements in their own area '${actor.area}', but placement belongs to '${placement.business.area}'`,
        );
      }
    }

    if (placement.status !== 'offered') {
      throw new BadRequestException(
        `Placement must be in 'offered' status to respond. Current status: '${placement.status}'`,
      );
    }

    if (dto.response !== 'accepted' && dto.response !== 'rejected') {
      throw new BadRequestException("response must be either 'accepted' or 'rejected'");
    }

    const before = { status: placement.status };

    if (dto.response === 'rejected') {
      const note = dto.rejectionReason ?? dto.note ?? 'Offer rejected';
      // Record hit on job seeker (Phase 3 hit cycle: 3 hits deactivate)
      await this.jobSeekerService.recordHit(
        placement.jobSeekerId,
        'offer_rejected',
        note,
        actor.id,
      );

      const updated = await this.prisma.placement.update({
        where: { id: placement.id },
        data: { status: 'rejected' },
        include: { business: true, jobSeeker: true, vacancy: true },
      });

      await this.auditService.log({
        action: 'placement_rejected',
        entityType: 'Placement',
        entityCode: placement.code,
        actorId: actor.id,
        city: placement.city,
        before,
        after: { status: updated.status, rejectionReason: note },
      });

      return updated;
    }

    // dto.response === 'accepted'
    // Calculate 50% placement fee and 18% GST using money module helpers
    const placementFee = calculatePlacementFee(placement.agreedSalary);
    const gstAmount = calculateGst(placementFee);
    const totalAmount = placementFee + gstAmount;

    // Create payment charge via provider
    const charge = await this.paymentService.createCharge(
      totalAmount,
      'placement',
      placement.id,
    );
    const paymentCode = await this.idService.generateCode('payment');

    // Update placement to confirmed, job seeker to placed, and create payment in transaction
    const [updated, payment] = await this.prisma.$transaction([
      this.prisma.placement.update({
        where: { id: placement.id },
        data: {
          status: 'confirmed',
          placementFee,
          gstAmount,
        },
        include: { business: true, jobSeeker: true, vacancy: true, payments: true },
      }),
      this.prisma.payment.create({
        data: {
          code: paymentCode,
          city: placement.city,
          type: 'placement_fee',
          amount: totalAmount,
          status: 'pending',
          gatewayReference: charge.gatewayReference,
          subjectType: 'placement',
          subjectId: placement.id,
          businessId: placement.businessId,
          placementId: placement.id,
          // Never billed to or deducted from the job seeker
          jobSeekerId: null,
        },
      }),
      this.prisma.jobSeeker.update({
        where: { id: placement.jobSeekerId },
        data: { status: 'placed' },
      }),
    ]);

    await this.auditService.log({
      action: 'placement_confirmed',
      entityType: 'Placement',
      entityCode: placement.code,
      actorId: actor.id,
      city: placement.city,
      before,
      after: {
        status: updated.status,
        jobSeekerStatus: 'placed',
        paymentId: payment.id,
        paymentCode: payment.code,
        placementFee,
        gstAmount,
        totalAmount,
      },
    });

    return {
      ...updated,
      payment: {
        id: payment.id,
        code: payment.code,
        amount: payment.amount,
        placementFee,
        gstAmount,
        status: payment.status,
        paymentLink: charge.paymentLink,
        gatewayReference: charge.gatewayReference,
      },
    };
  }

  async recordJoined(id: string, dto: RecordJoinedDto, actorId: string) {
    const actor = await this.prisma.staff.findUnique({
      where: { id: actorId },
    });
    if (!actor) {
      throw new NotFoundException(`Staff '${actorId}' not found`);
    }

    const placement = await this.prisma.placement.findFirst({
      where: {
        OR: [{ id }, { code: id }],
      },
      include: {
        business: true,
        jobSeeker: true,
        vacancy: true,
      },
    });
    if (!placement) {
      throw new NotFoundException(`Placement '${id}' not found`);
    }

    if (actor.role === 'field_agent') {
      if (!actor.area || placement.business.area !== actor.area) {
        throw new ForbiddenException(
          `Field agent can only manage placements in their own area '${actor.area}', but placement belongs to '${placement.business.area}'`,
        );
      }
    }

    if (placement.status !== 'confirmed') {
      throw new BadRequestException(
        `Placement must be in 'confirmed' status to record joining. Current status: '${placement.status}'`,
      );
    }

    let joinedDate: Date;
    if (dto?.joinedDate) {
      joinedDate = new Date(dto.joinedDate);
      if (isNaN(joinedDate.getTime())) {
        throw new BadRequestException('joinedDate must be a valid date string');
      }
    } else {
      joinedDate = new Date();
    }

    const before = {
      status: placement.status,
      joinedDate: placement.joinedDate,
    };

    const updated = await this.prisma.placement.update({
      where: { id: placement.id },
      data: {
        status: 'active',
        joinedDate,
      },
      include: {
        business: true,
        jobSeeker: true,
        vacancy: true,
      },
    });

    await this.auditService.log({
      action: 'placement_joined',
      entityType: 'Placement',
      entityCode: placement.code,
      actorId: actor.id,
      city: placement.city,
      before,
      after: {
        status: updated.status,
        joinedDate: updated.joinedDate,
      },
    });

    // Phase 6 Task 1: Trigger referral payout if candidate was referred (flat ₹200 on joining)
    if (updated.jobSeeker?.referredById) {
      await this.paymentService.createReferralPayout(updated.id, actor.id);
    }

    return updated;
  }

  async triggerReferralPayout(placementId: string, actorId?: string) {
    return this.paymentService.createReferralPayout(placementId, actorId);
  }

  /**
   * Reports a candidate dropout on an active placement.
   *
   * ANTI-FRAUD CONTROL (Phase 6.5 Task 8):
   * The 15-day cash-refund clock runs from dropoutReportedAt. An unbounded or fraudulent
   * caller-supplied date is a direct money-affecting input: backdating it by 15 days makes
   * a cash refund immediately payable. This belongs with the §4 anti-fraud controls,
   * not with ordinary validation.
   *
   * Validations enforced:
   * 1. Refuse future dropoutReportedAt (strictly > server time now, no grace period/tolerance).
   * 2. Refuse dropoutReportedAt earlier than joinedDate (employee cannot leave before they started).
   * 3. For 'employee_left', refuse if joinedDate is missing or if dropoutReportedAt is outside
   *    the 60-day replacement guarantee window.
   *
   * Origin tracking:
   * Sets `dropoutDateCallerSupplied: true` if dropoutReportedAt was provided in the DTO,
   * or `false` if defaulted to the server clock.
   */
  async recordDropout(
    id: string,
    dto: RecordDropoutDto,
    actorId: string,
    now: Date = new Date(),
  ) {
    const actor = await this.prisma.staff.findUnique({
      where: { id: actorId },
    });
    if (!actor) {
      throw new NotFoundException(`Staff '${actorId}' not found`);
    }

    const placement = await this.prisma.placement.findFirst({
      where: {
        OR: [{ id }, { code: id }],
      },
      include: {
        business: true,
        jobSeeker: true,
        vacancy: true,
      },
    });
    if (!placement) {
      throw new NotFoundException(`Placement '${id}' not found`);
    }

    if (actor.role === 'field_agent') {
      if (!actor.area || placement.business.area !== actor.area) {
        throw new ForbiddenException(
          `Field agent can only manage placements in their own area '${actor.area}', but placement belongs to '${placement.business.area}'`,
        );
      }
    }

    if (placement.status !== 'active') {
      throw new BadRequestException(
        `Placement must be in 'active' status to report a dropout. Current status: '${placement.status}'`,
      );
    }

    if (
      !dto.eligibility ||
      (dto.eligibility !== 'employee_left' && dto.eligibility !== 'business_breach')
    ) {
      throw new BadRequestException(
        "eligibility must be either 'employee_left' or 'business_breach'",
      );
    }

    const callerSupplied = dto.dropoutReportedAt !== undefined && dto.dropoutReportedAt !== null;
    let dropoutReportedAt: Date;
    if (callerSupplied) {
      dropoutReportedAt = new Date(dto.dropoutReportedAt!);
      if (isNaN(dropoutReportedAt.getTime())) {
        throw new BadRequestException('dropoutReportedAt must be a valid date string');
      }
    } else {
      dropoutReportedAt = new Date(now.getTime());
    }

    // 1. Future date check (Strict server time; no tolerance window / clock skew backdoor)
    if (dropoutReportedAt.getTime() > now.getTime()) {
      const refusalMessage = `dropoutReportedAt ${dropoutReportedAt.toISOString()} cannot be in the future (server time is ${now.toISOString()})`;
      await this.auditService.log({
        action: 'placement_dropout_refused',
        entityType: 'Placement',
        entityCode: placement.code,
        actorId: actor.id,
        city: placement.city,
        before: {
          status: placement.status,
          dropoutReportedAt: placement.dropoutReportedAt,
          dropoutDateCallerSupplied: placement.dropoutDateCallerSupplied,
          eligibility: placement.eligibility,
        },
        after: {
          refusalReason: 'FUTURE_DROPOUT_DATE',
          message: refusalMessage,
          eligibility: dto.eligibility,
          dropoutReportedAt,
          serverTime: now.toISOString(),
          callerSupplied,
        },
      });
      throw new BadRequestException(refusalMessage);
    }

    // 2. Cannot report dropout before joinedDate (employee cannot leave before they started)
    if (placement.joinedDate && dropoutReportedAt.getTime() < placement.joinedDate.getTime()) {
      const refusalMessage = `dropoutReportedAt ${dropoutReportedAt.toISOString()} cannot be earlier than joinedDate ${placement.joinedDate.toISOString()} (employee cannot leave before they started)`;
      await this.auditService.log({
        action: 'placement_dropout_refused',
        entityType: 'Placement',
        entityCode: placement.code,
        actorId: actor.id,
        city: placement.city,
        before: {
          status: placement.status,
          dropoutReportedAt: placement.dropoutReportedAt,
          dropoutDateCallerSupplied: placement.dropoutDateCallerSupplied,
          eligibility: placement.eligibility,
        },
        after: {
          refusalReason: 'DROPOUT_BEFORE_JOINED_DATE',
          message: refusalMessage,
          eligibility: dto.eligibility,
          dropoutReportedAt,
          joinedDate: placement.joinedDate.toISOString(),
          callerSupplied,
        },
      });
      throw new BadRequestException(refusalMessage);
    }

    // 3. Employee_left eligibility checks:
    if (dto.eligibility === 'employee_left') {
      // 3a. joinedDate must not be null
      if (!placement.joinedDate) {
        await this.auditService.log({
          action: 'placement_dropout_refused',
          entityType: 'Placement',
          entityCode: placement.code,
          actorId: actor.id,
          city: placement.city,
          before: {
            status: placement.status,
            dropoutReportedAt: placement.dropoutReportedAt,
            dropoutDateCallerSupplied: placement.dropoutDateCallerSupplied,
            eligibility: placement.eligibility,
          },
          after: {
            refusalReason: 'MISSING_JOINED_DATE',
            message: `Placement '${placement.code}' has no joinedDate recorded; cannot evaluate 60-day replacement guarantee window`,
            eligibility: dto.eligibility,
            dropoutReportedAt,
            callerSupplied,
          },
        });
        throw new BadRequestException(
          `Placement '${placement.code}' has no joinedDate recorded; cannot evaluate 60-day replacement guarantee window`,
        );
      }

      // 3b. 60-day replacement guarantee window check
      // NOTE: Placement.clockPaused and clockPausedAt govern the 15-day replacement search window
      // AFTER a dropout is reported (when a business rejects 2 replacement candidates).
      // Clock pause does NOT extend this initial 60-day guarantee window, which runs strictly from joinedDate.
      if (!isWithinReplacementGuarantee(placement.joinedDate, dropoutReportedAt)) {
        const deadline = replacementGuaranteeDeadline(placement.joinedDate);
        const refusalMessage = `Replacement guarantee expired on ${deadline.toISOString()} (${REPLACEMENT_GUARANTEE_WINDOW_DAYS} days from joinedDate ${placement.joinedDate.toISOString()}). Dropout reported at ${dropoutReportedAt.toISOString()} is outside the replacement guarantee window.`;

        await this.auditService.log({
          action: 'placement_dropout_refused',
          entityType: 'Placement',
          entityCode: placement.code,
          actorId: actor.id,
          city: placement.city,
          before: {
            status: placement.status,
            dropoutReportedAt: placement.dropoutReportedAt,
            dropoutDateCallerSupplied: placement.dropoutDateCallerSupplied,
            eligibility: placement.eligibility,
          },
          after: {
            refusalReason: 'REPLACEMENT_GUARANTEE_EXPIRED',
            guaranteeExpiryDate: deadline.toISOString(),
            message: refusalMessage,
            eligibility: dto.eligibility,
            dropoutReportedAt,
            callerSupplied,
          },
        });

        throw new BadRequestException(refusalMessage);
      }
    }

    const before = {
      status: placement.status,
      dropoutReportedAt: placement.dropoutReportedAt,
      dropoutDateCallerSupplied: placement.dropoutDateCallerSupplied,
      eligibility: placement.eligibility,
    };

    const updated = await this.prisma.placement.update({
      where: { id: placement.id },
      data: {
        status: 'dropped_out',
        dropoutReportedAt,
        dropoutDateCallerSupplied: callerSupplied,
        eligibility: dto.eligibility,
      },
      include: {
        business: true,
        jobSeeker: true,
        vacancy: true,
      },
    });

    await this.auditService.log({
      action: 'placement_dropout',
      entityType: 'Placement',
      entityCode: placement.code,
      actorId: actor.id,
      city: placement.city,
      before,
      after: {
        status: updated.status,
        dropoutReportedAt: updated.dropoutReportedAt,
        dropoutDateCallerSupplied: updated.dropoutDateCallerSupplied,
        eligibility: updated.eligibility,
        reason: dto.reason,
      },
    });

    return updated;
  }

  async offerReplacementCandidate(
    id: string,
    dto: CreateReplacementCandidateDto,
    actorId: string,
  ) {
    const actor = await this.prisma.staff.findUnique({
      where: { id: actorId },
    });
    if (!actor) {
      throw new NotFoundException(`Staff '${actorId}' not found`);
    }

    const placement = await this.prisma.placement.findFirst({
      where: {
        OR: [{ id }, { code: id }],
      },
      include: {
        business: true,
        jobSeeker: true,
        vacancy: true,
        replacementCandidates: true,
      },
    });
    if (!placement) {
      throw new NotFoundException(`Placement '${id}' not found`);
    }

    if (actor.role === 'field_agent') {
      if (!actor.area || placement.business.area !== actor.area) {
        throw new ForbiddenException(
          `Field agent can only manage placements in their own area '${actor.area}', but placement belongs to '${placement.business.area}'`,
        );
      }
    }

    if (placement.status !== 'dropped_out') {
      throw new BadRequestException(
        `Placement must be in 'dropped_out' status to offer a replacement candidate. Current status: '${placement.status}'`,
      );
    }

    if (placement.eligibility === 'business_breach') {
      throw new BadRequestException(
        "Placement with eligibility 'business_breach' is ineligible for replacement guarantee remedy",
      );
    }

    if (!dto.jobSeekerId || typeof dto.jobSeekerId !== 'string') {
      throw new BadRequestException('jobSeekerId is required');
    }

    const jobSeeker = await this.prisma.jobSeeker.findFirst({
      where: {
        OR: [{ id: dto.jobSeekerId }, { code: dto.jobSeekerId }],
      },
    });
    if (!jobSeeker) {
      throw new NotFoundException(`Job seeker '${dto.jobSeekerId}' not found`);
    }

    if (jobSeeker.status === 'placed') {
      throw new BadRequestException(
        `Job seeker '${jobSeeker.code}' is already placed and cannot be offered as a replacement`,
      );
    }

    if (jobSeeker.status === 'deactivated') {
      throw new BadRequestException(
        `Job seeker '${jobSeeker.code}' is deactivated and cannot be offered as a replacement`,
      );
    }

    if (jobSeeker.id === placement.jobSeekerId) {
      throw new BadRequestException(
        'Cannot offer the original dropped-out candidate as their own replacement',
      );
    }

    const existingOffered = placement.replacementCandidates.find(
      (rc) => rc.jobSeekerId === jobSeeker.id && rc.status === 'offered',
    );
    if (existingOffered) {
      throw new BadRequestException(
        `Candidate '${jobSeeker.code}' is already currently offered as a replacement candidate`,
      );
    }

    const candidate = await this.prisma.replacementCandidate.create({
      data: {
        placementId: placement.id,
        jobSeekerId: jobSeeker.id,
        status: 'offered',
      },
      include: {
        jobSeeker: true,
      },
    });

    await this.auditService.log({
      action: 'replacement_candidate_offered',
      entityType: 'Placement',
      entityCode: placement.code,
      actorId: actor.id,
      city: placement.city,
      after: {
        replacementCandidateId: candidate.id,
        jobSeekerId: jobSeeker.id,
        jobSeekerCode: jobSeeker.code,
      },
    });

    return candidate;
  }

  async rejectReplacementCandidate(
    placementId: string,
    candidateId: string,
    dto: RejectReplacementCandidateDto,
    actorId: string,
  ) {
    const actor = await this.prisma.staff.findUnique({
      where: { id: actorId },
    });
    if (!actor) {
      throw new NotFoundException(`Staff '${actorId}' not found`);
    }

    const placement = await this.prisma.placement.findFirst({
      where: {
        OR: [{ id: placementId }, { code: placementId }],
      },
      include: {
        business: true,
      },
    });
    if (!placement) {
      throw new NotFoundException(`Placement '${placementId}' not found`);
    }

    if (actor.role === 'field_agent') {
      if (!actor.area || placement.business.area !== actor.area) {
        throw new ForbiddenException(
          `Field agent can only manage placements in their own area '${actor.area}', but placement belongs to '${placement.business.area}'`,
        );
      }
    }

    const candidate = await this.prisma.replacementCandidate.findFirst({
      where: {
        id: candidateId,
        placementId: placement.id,
      },
    });
    if (!candidate) {
      throw new NotFoundException(
        `Replacement candidate '${candidateId}' not found for placement '${placement.code}'`,
      );
    }

    if (candidate.status !== 'offered') {
      throw new BadRequestException(
        `Replacement candidate must be in 'offered' status to reject. Current status: '${candidate.status}'`,
      );
    }

    let rejectedAt: Date;
    if (dto?.rejectedAt) {
      rejectedAt = new Date(dto.rejectedAt);
      if (isNaN(rejectedAt.getTime())) {
        throw new BadRequestException('rejectedAt must be a valid date string');
      }
    } else {
      rejectedAt = new Date();
    }

    const reason = dto?.rejectionReason ?? dto?.reason ?? 'Rejected by business';
    const newRejectionCount = placement.replacementRejectionCount + 1;
    const shouldPause = newRejectionCount >= 3;

    const [updatedCandidate, updatedPlacement] = await this.prisma.$transaction([
      this.prisma.replacementCandidate.update({
        where: { id: candidate.id },
        data: {
          status: 'rejected',
          rejectedAt,
          rejectionReason: reason,
        },
      }),
      this.prisma.placement.update({
        where: { id: placement.id },
        data: {
          replacementRejectionCount: newRejectionCount,
          clockPaused: shouldPause ? true : placement.clockPaused,
          clockPausedAt: shouldPause
            ? placement.clockPausedAt ?? rejectedAt
            : placement.clockPausedAt,
        },
      }),
    ]);

    await this.auditService.log({
      action: 'replacement_candidate_rejected',
      entityType: 'Placement',
      entityCode: placement.code,
      actorId: actor.id,
      city: placement.city,
      before: {
        replacementRejectionCount: placement.replacementRejectionCount,
        clockPaused: placement.clockPaused,
      },
      after: {
        replacementCandidateId: candidate.id,
        rejectionReason: reason,
        replacementRejectionCount: newRejectionCount,
        clockPaused: updatedPlacement.clockPaused,
        clockPausedAt: updatedPlacement.clockPausedAt,
      },
    });

    return {
      candidate: updatedCandidate,
      placement: updatedPlacement,
    };
  }

  async acceptReplacementCandidate(
    placementId: string,
    candidateId: string,
    actorId: string,
  ) {
    const actor = await this.prisma.staff.findUnique({
      where: { id: actorId },
    });
    if (!actor) {
      throw new NotFoundException(`Staff '${actorId}' not found`);
    }

    const placement = await this.prisma.placement.findFirst({
      where: {
        OR: [{ id: placementId }, { code: placementId }],
      },
      include: {
        business: true,
      },
    });
    if (!placement) {
      throw new NotFoundException(`Placement '${placementId}' not found`);
    }

    if (actor.role === 'field_agent') {
      if (!actor.area || placement.business.area !== actor.area) {
        throw new ForbiddenException(
          `Field agent can only manage placements in their own area '${actor.area}', but placement belongs to '${placement.business.area}'`,
        );
      }
    }

    const candidate = await this.prisma.replacementCandidate.findFirst({
      where: {
        id: candidateId,
        placementId: placement.id,
      },
    });
    if (!candidate) {
      throw new NotFoundException(
        `Replacement candidate '${candidateId}' not found for placement '${placement.code}'`,
      );
    }

    if (candidate.status !== 'offered') {
      throw new BadRequestException(
        `Replacement candidate must be in 'offered' status to accept. Current status: '${candidate.status}'`,
      );
    }

    const [updatedCandidate, updatedPlacement] = await this.prisma.$transaction([
      this.prisma.replacementCandidate.update({
        where: { id: candidate.id },
        data: {
          status: 'accepted',
        },
      }),
      this.prisma.placement.update({
        where: { id: placement.id },
        data: {
          status: 'replaced',
        },
      }),
      this.prisma.jobSeeker.update({
        where: { id: candidate.jobSeekerId },
        data: {
          status: 'placed',
        },
      }),
    ]);

    await this.auditService.log({
      action: 'replacement_candidate_accepted',
      entityType: 'Placement',
      entityCode: placement.code,
      actorId: actor.id,
      city: placement.city,
      after: {
        replacementCandidateId: candidate.id,
        placementStatus: 'replaced',
        jobSeekerId: candidate.jobSeekerId,
      },
    });

    return {
      candidate: updatedCandidate,
      placement: updatedPlacement,
    };
  }

  async getPlacementDaysElapsed(placementId: string, asOf?: Date): Promise<number> {
    const placement = await this.prisma.placement.findFirst({
      where: {
        OR: [{ id: placementId }, { code: placementId }],
      },
    });
    if (!placement) {
      throw new NotFoundException(`Placement '${placementId}' not found`);
    }
    if (!placement.dropoutReportedAt) {
      return 0;
    }
    return calculateDaysElapsed(
      placement.dropoutReportedAt,
      placement.clockPaused,
      placement.clockPausedAt,
      asOf,
    );
  }

  async findAll(actorId: string) {
    const actor = await this.prisma.staff.findUnique({
      where: { id: actorId },
    });
    if (!actor) {
      throw new NotFoundException(`Staff '${actorId}' not found`);
    }

    const where: Record<string, unknown> = {};
    if (actor.role === 'field_agent') {
      where.business = { area: actor.area ?? undefined };
    }

    return this.prisma.placement.findMany({
      where,
      include: {
        business: true,
        jobSeeker: true,
        vacancy: true,
        replacementCandidates: {
          include: {
            jobSeeker: true,
          },
        },
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  async findById(id: string, actorId: string) {
    const actor = await this.prisma.staff.findUnique({
      where: { id: actorId },
    });
    if (!actor) {
      throw new NotFoundException(`Staff '${actorId}' not found`);
    }

    const placement = await this.prisma.placement.findFirst({
      where: {
        OR: [{ id }, { code: id }],
      },
      include: {
        business: true,
        jobSeeker: true,
        vacancy: true,
        replacementCandidates: {
          include: {
            jobSeeker: true,
          },
        },
      },
    });
    if (!placement) {
      throw new NotFoundException(`Placement '${id}' not found`);
    }

    if (actor.role === 'field_agent') {
      if (!actor.area || placement.business.area !== actor.area) {
        throw new ForbiddenException(
          `Field agent can only access placements in their own area '${actor.area}', but placement belongs to '${placement.business.area}'`,
        );
      }
    }

    return placement;
  }

  async approveRefund(
    id: string,
    dto: ApprovePlacementRefundDto,
    actorId: string,
  ) {
    const actor = await this.prisma.staff.findUnique({
      where: { id: actorId },
    });
    if (!actor) {
      throw new NotFoundException(`Staff '${actorId}' not found`);
    }

    const placement = await this.prisma.placement.findFirst({
      where: {
        OR: [{ id }, { code: id }],
      },
      include: {
        business: true,
        jobSeeker: true,
        vacancy: true,
        replacementCandidates: true,
      },
    });
    if (!placement) {
      throw new NotFoundException(`Placement '${id}' not found`);
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

    const hasAcceptedReplacement = placement.replacementCandidates.some(
      (rc) => rc.status === 'accepted',
    );

    const existingRefund = await this.prisma.payment.findFirst({
      where: {
        placementId: placement.id,
        type: 'refund',
        status: { in: ['pending', 'processing', 'completed', 'succeeded'] },
      },
    });

    const eligibilityResult = evaluatePlacementRefundEligibility(
      {
        code: placement.code,
        status: placement.status,
        eligibility: placement.eligibility,
        hasAcceptedReplacement,
        dropoutReportedAt: placement.dropoutReportedAt,
        clockPaused: placement.clockPaused,
        clockPausedAt: placement.clockPausedAt,
        placementFee: placement.placementFee,
        hasExistingRefund: Boolean(existingRefund),
      },
      now,
    );

    if (!eligibilityResult.eligible) {
      throw new BadRequestException(eligibilityResult.ineligibleReason!);
    }

    const refundAmount = eligibilityResult.amountPaise;
    const daysElapsed = eligibilityResult.daysElapsed;

    const paymentCode = await this.idService.generateCode('payment');
    const payment = await this.prisma.payment.create({
      data: {
        code: paymentCode,
        city: placement.city,
        type: 'refund',
        amount: refundAmount,
        status: 'completed',
        gatewayReference: `ref_pl_${placement.code}_${Date.now()}`,
        subjectType: 'placement',
        subjectId: placement.id,
        placementId: placement.id,
        businessId: placement.businessId,
      },
    });

    await this.auditService.log({
      action: 'refund_approved',
      entityType: 'Placement',
      entityCode: placement.code,
      actorId: actor.id,
      city: placement.city,
      before: {
        status: placement.status,
      },
      after: {
        paymentId: payment.id,
        paymentCode: payment.code,
        amount: payment.amount,
        type: 'refund',
        reason: dto?.reason ?? '60-day replacement guarantee cash refund',
        daysElapsed,
        dropoutDateCallerSupplied: placement.dropoutDateCallerSupplied,
      },
    });

    return {
      ...payment,
      dropoutDateCallerSupplied: placement.dropoutDateCallerSupplied,
    };
  }

  async getInvoice(id: string, actorId: string): Promise<GstInvoiceResponse> {
    const actor = await this.prisma.staff.findUnique({
      where: { id: actorId },
    });
    if (!actor) {
      throw new NotFoundException(`Staff '${actorId}' not found`);
    }

    const placement = await this.prisma.placement.findFirst({
      where: { id },
      include: {
        business: true,
        jobSeeker: true,
        vacancy: true,
        payments: true,
      },
    });

    if (!placement) {
      throw new NotFoundException(`Placement '${id}' not found`);
    }

    const eligibleStatuses = ['confirmed', 'active', 'completed', 'dropped_out', 'replaced'];
    if (!eligibleStatuses.includes(placement.status)) {
      throw new BadRequestException(
        `Invoice can only be generated for confirmed or active placements (current status: ${placement.status})`,
      );
    }

    // Determine sequential invoice number
    let invoiceNumber = placement.invoiceCode;
    if (!invoiceNumber) {
      invoiceNumber = await this.idService.generateCode('invoice');
      await this.prisma.placement.update({
        where: { id: placement.id },
        data: { invoiceCode: invoiceNumber },
      });

      await this.auditService.log({
        action: 'placement.invoice_generated',
        entityType: 'placement',
        entityCode: placement.code,
        actorId: actor.id,
        city: placement.city,
        after: {
          invoiceCode: invoiceNumber,
          placementId: placement.id,
        },
      });
    }

    // Re-use calculatePlacementFee and calculateGst from money module
    const baseAmountPaise = calculatePlacementFee(placement.agreedSalary);
    const totalTaxPaise = calculateGst(baseAmountPaise);
    const totalAmountPaise = baseAmountPaise + totalTaxPaise;

    // 18% GST split into 9% CGST and 9% SGST for intra-state supply
    const cgstAmountPaise = Math.floor(totalTaxPaise / 2);
    const sgstAmountPaise = totalTaxPaise - cgstAmountPaise;

    const supplier: InvoiceSupplier = {
      legalName: process.env.COMPANY_LEGAL_NAME || 'Laboura Blue-Collar Technologies Pvt Ltd',
      gstin: process.env.COMPANY_GSTIN || 'GSTIN_PENDING_REGISTRATION',
      address: process.env.COMPANY_ADDRESS || 'Bengaluru, Karnataka, India',
      state: 'Karnataka',
      stateCode: '29',
    };

    const customer: InvoiceCustomer = {
      businessId: placement.business.id,
      businessCode: placement.business.code,
      businessName: placement.business.name,
      contactName: placement.business.contactName ?? null,
      contactPhone: placement.business.phone,
      gstin: placement.business.gstNumber ?? null,
      address: placement.business.address,
      area: placement.business.area,
      city: placement.business.city,
      state: 'Karnataka',
      stateCode: '29',
    };

    const placementInfo: InvoicePlacementInfo = {
      placementId: placement.id,
      placementCode: placement.code,
      candidateCode: placement.jobSeeker.code,
      candidateName: placement.jobSeeker.name,
      candidatePhone: placement.jobSeeker.phone,
      tradeSkill: placement.vacancy.tradeSkill,
      monthlySalaryPaise: placement.agreedSalary,
      joinedDate: placement.joinedDate ? placement.joinedDate.toISOString() : null,
    };

    const invoiceDate = (placement.joinedDate ?? placement.updatedAt ?? new Date()).toISOString();

    return {
      invoiceNumber,
      invoiceDate,
      supplier,
      customer,
      placement: placementInfo,
      lineItems: [
        {
          itemNumber: 1,
          description: `Placement fee for trade: ${placement.vacancy.tradeSkill} (50% of monthly salary)`,
          sacCode: '9985',
          baseAmountPaise,
          taxRatePercent: 18,
          cgstRatePercent: 9,
          cgstAmountPaise,
          sgstRatePercent: 9,
          sgstAmountPaise,
          igstRatePercent: 0,
          igstAmountPaise: 0,
          totalAmountPaise,
        },
      ],
      summary: {
        subtotalPaise: baseAmountPaise,
        totalTaxPaise,
        totalAmountPaise,
        currency: 'INR',
        amountInWords: formatINR(totalAmountPaise),
      },
    };
  }

  async exportPlacements(
    query: ExportPlacementsQueryDto,
    actorId: string,
  ): Promise<RegulatoryPlacementExportRow[]> {
    const actor = await this.prisma.staff.findUnique({
      where: { id: actorId },
    });
    if (!actor) {
      throw new NotFoundException(`Staff '${actorId}' not found`);
    }

    const where: Prisma.PlacementWhereInput = {};

    if (query.status) {
      where.status = query.status;
    }

    if (query.area) {
      where.business = { area: query.area };
    }

    if (query.from || query.to) {
      where.joinedDate = {};
      if (query.from) {
        where.joinedDate.gte = new Date(query.from);
      }
      if (query.to) {
        where.joinedDate.lte = new Date(query.to);
      }
    }

    const placements = await this.prisma.placement.findMany({
      where,
      include: {
        business: true,
        jobSeeker: true,
        vacancy: true,
      },
      orderBy: { createdAt: 'desc' },
    });

    return placements.map((p) => ({
      placementCode: p.code,
      joinedDate: p.joinedDate ? p.joinedDate.toISOString().split('T')[0] : '',
      dropoutDate: p.dropoutReportedAt ? p.dropoutReportedAt.toISOString().split('T')[0] : '',
      tradeSkill: p.vacancy?.tradeSkill ?? '',
      candidateCode: p.jobSeeker.code,
      employerCode: p.business.code,
      employerName: p.business.name,
      monthlySalaryINR: toRupees(p.agreedSalary),
      placementFeeINR: toRupees(p.placementFee),
      status: p.status,
      area: p.business.area,
      city: p.city,
    }));
  }
}




