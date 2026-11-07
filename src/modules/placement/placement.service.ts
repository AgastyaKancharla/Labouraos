import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  Optional,
} from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.service';
import { IdService } from '../../common/id/id.service';
import { AuditService } from '../../common/audit/audit.service';
import { randomUUID } from 'node:crypto';
import { Prisma } from '@prisma/client';
import {
  calculatePlacementFee,
  calculateGst,
  formatINR,
  toRupees,
  isWithinReplacementGuarantee,
  replacementGuaranteeDeadline,
} from '../../common/money/money';
import { JobSeekerService } from '../job-seeker/job-seeker.service';
import { PaymentService } from '../payment/payment.service';
import { UpiCollectionService } from '../payment/upi-collection.service';
import { PricingService } from '../pricing/pricing.service';
import { RecordJoinedDto } from './dto/record-joined.dto';
import { RecordDropoutDto } from './dto/record-dropout.dto';
import { CreateReplacementCandidateDto } from './dto/create-replacement-candidate.dto';
import { RejectReplacementCandidateDto } from './dto/reject-replacement-candidate.dto';
import { ApprovePlacementRefundDto } from './dto/approve-refund.dto';
import { evaluatePlacementRefundEligibility } from './placement-refund-eligibility';
import { recordStatusChange } from '../../common/status-history/status-history.helper';
import {
  GstInvoiceResponse,
  InvoiceCustomer,
  InvoicePlacementInfo,
  InvoiceSupplier,
} from './dto/gst-invoice.dto';
import { ExportPlacementsQueryDto, RegulatoryPlacementExportRow } from './dto/export-placements.dto';
import { ReviewFlagService } from '../review-flag/review-flag.service';

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
    private readonly pricingService: PricingService,
    @Optional() private readonly reviewFlags?: ReviewFlagService,
    @Optional() private readonly upiCollectionService?: UpiCollectionService,
  ) {}

  private async getPolicy() {
    return this.pricingService.current();
  }

  async createAwaitingPaymentFromInterview(interviewId: string, now: Date) {
    const created = await this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw(Prisma.sql`SELECT "id" FROM "Interview" WHERE "id" = ${interviewId} FOR UPDATE`);
      const interview = await tx.interview.findUnique({
        where: { id: interviewId },
        include: { business: true, jobSeeker: true, vacancy: true },
      });
      if (!interview || interview.result !== 'selected' || interview.status !== 'completed' || !interview.resultRecordedAt) {
        throw new BadRequestException('A completed selected interview is required to create a placement');
      }

      const existing = await tx.placement.findUnique({
        where: { interviewId },
        include: { payments: true, business: true, jobSeeker: true, vacancy: true },
      });
      if (existing) {
        const payment = existing.payments.find((row) => row.type === 'placement_fee');
        return {
          placement: existing, payment, paymentLink: null, existing: true,
          totalAmount: existing.placementFee + existing.gstAmount,
          actorId: existing.createdByStaffId ?? interview.proposedByStaffId,
        };
      }

      const agreement = await tx.businessAgreement.findFirst({
        where: { businessId: interview.businessId },
        orderBy: [{ signedAt: 'desc' }, { createdAt: 'desc' }],
      });
      if (!agreement) {
        throw new BadRequestException('A signed business agreement is required before a selected interview can create a placement');
      }
      if (!interview.selectedSalaryPaise || !interview.selectedJoiningDate) {
        throw new BadRequestException('The selected interview must include salary and joining date');
      }

      const policy = await this.getPolicy();
      const placementFee = calculatePlacementFee(interview.selectedSalaryPaise, agreement.feePercent);
      const gstAmount = calculateGst(placementFee, agreement.gstPercent);
      const totalAmount = placementFee + gstAmount;
      const id = randomUUID();
      const code = await this.idService.generateCode('placement');
      const paymentDueAt = new Date(now.getTime() + policy.placementPaymentDueHours * 60 * 60 * 1000);
      const placement = await tx.placement.create({
        data: {
          id,
          code,
          city: interview.vacancy.city,
          vacancyId: interview.vacancyId,
          jobSeekerId: interview.jobSeekerId,
          businessId: interview.businessId,
          createdByStaffId: interview.proposedByStaffId,
          interviewId: interview.id,
          selectedAt: now,
          paymentDueAt,
          joiningDate: interview.selectedJoiningDate,
          rootPlacementId: id,
          replacementNumber: 0,
          feePercentAtCreation: agreement.feePercent,
          gstPercentAtCreation: agreement.gstPercent,
          agreedSalary: interview.selectedSalaryPaise,
          placementFee,
          gstAmount,
          status: 'awaiting_payment',
        },
        include: { business: true, jobSeeker: true, vacancy: true, payments: true },
      });
      await recordStatusChange(tx, {
        subjectType: 'placement', subjectId: placement.id, fromStatus: null, toStatus: 'awaiting_payment',
        changedByStaffId: interview.proposedByStaffId, changedAt: now, reason: 'owner_selected_candidate',
      });
      return {
        placement, totalAmount, existing: false,
        actorId: interview.proposedByStaffId,
      };
    });

    let payment = created.placement.payments?.find((p) => p.type === 'placement_fee') ?? null;
    let paymentLink: string | null = null;

    if (!created.existing) {
      if (this.upiCollectionService) {
        const upiRequest = await this.upiCollectionService.createRequest({
          type: 'placement_fee',
          subjectType: 'placement',
          subjectId: created.placement.id,
          amountPaise: created.totalAmount,
          city: created.placement.city,
          businessId: created.placement.businessId,
          placementId: created.placement.id,
          notifySubjectType: 'business',
          notifySubjectId: created.placement.businessId,
        });
        payment = await this.prisma.payment.findUnique({ where: { id: upiRequest.paymentId } });
        paymentLink = upiRequest.paymentLink;
      } else {
        const charge = await this.paymentService.createCharge(created.totalAmount, 'placement', created.placement.id);
        const paymentCode = await this.idService.generateCode('payment');
        payment = await this.prisma.payment.create({
          data: {
            code: paymentCode,
            city: created.placement.city,
            type: 'placement_fee',
            amount: created.totalAmount,
            status: 'pending',
            gatewayReference: charge.gatewayReference,
            subjectType: 'placement',
            subjectId: created.placement.id,
            businessId: created.placement.businessId,
            placementId: created.placement.id,
            jobSeekerId: null,
          },
        });
        paymentLink = charge.paymentLink;
      }

      await this.auditService.log({
        action: 'placement.awaiting_payment_created', entityType: 'Placement', entityCode: created.placement.code,
        actorId: created.actorId, city: created.placement.city,
        after: {
          status: created.placement.status, interviewId, selectedAt: now.toISOString(),
          paymentDueAt: created.placement.paymentDueAt?.toISOString(), agreedSalary: created.placement.agreedSalary,
          feePercentAtCreation: created.placement.feePercentAtCreation,
          gstPercentAtCreation: created.placement.gstPercentAtCreation,
          placementFee: created.placement.placementFee, gstAmount: created.placement.gstAmount,
          paymentId: payment?.id,
        },
      });
    }
    const effectivePayment = payment ?? created.payment;
    return {
      ...created.placement,
      payment: effectivePayment ? {
        id: effectivePayment.id,
        code: effectivePayment.code,
        amount: effectivePayment.amount,
        status: effectivePayment.status,
        paymentLink: paymentLink ?? created.paymentLink,
        gatewayReference: effectivePayment.gatewayReference,
        upiReference: effectivePayment.upiReference,
      } : null,
    };
  }

  async processPaymentDeadlines(now = new Date()) {
    const due = await this.prisma.placement.findMany({
      where: { status: 'awaiting_payment', paymentDueAt: { lte: now } },
      include: { business: true },
      orderBy: { paymentDueAt: 'asc' },
    });
    let raised = 0;
    for (const placement of due) {
      const existing = await this.prisma.reviewFlag.findFirst({
        where: { kind: 'payment_overdue', subjectType: 'placement', subjectId: placement.id },
        select: { id: true },
      });
      if (existing) continue;
      if (!this.reviewFlags) throw new Error('ReviewFlagService is required to process placement payment deadlines');
      await this.reviewFlags.raise({
        kind: 'payment_overdue', subjectType: 'placement', subjectId: placement.id,
        raisedForStaffId: placement.business.accountAgentId ?? placement.business.leadCreatedByStaffId,
        details: { placementId: placement.id, businessId: placement.businessId, paymentDueAt: placement.paymentDueAt?.toISOString() },
      });
      raised += 1;
    }
    return { raised };
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

    if (actor.role === 'field_agent' && placement.business.accountAgentId !== actor.id) {
      throw new ForbiddenException('Field agents may only manage placements for their account businesses');
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

    const updated = await this.prisma.$transaction(async (tx) => {
      const up = await tx.placement.update({
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

      await recordStatusChange(tx, {
        subjectType: 'placement',
        subjectId: placement.id,
        fromStatus: placement.status,
        toStatus: 'active',
        changedByStaffId: actor.id,
      });

      return up;
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

    if (actor.role === 'field_agent' && placement.business.accountAgentId !== actor.id) {
      throw new ForbiddenException('Field agents may only manage placements for their account businesses');
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
      const policy = await this.getPolicy();
      if (!isWithinReplacementGuarantee(placement.joinedDate, dropoutReportedAt, policy.replacementWindowDays)) {
        const deadline = replacementGuaranteeDeadline(placement.joinedDate, policy.replacementWindowDays);
        const refusalMessage = `Replacement guarantee expired on ${deadline.toISOString()} (${policy.replacementWindowDays} days from joinedDate ${placement.joinedDate.toISOString()}). Dropout reported at ${dropoutReportedAt.toISOString()} is outside the replacement guarantee window.`;

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

    const updated = await this.prisma.$transaction(async (tx) => {
      const up = await tx.placement.update({
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

      await recordStatusChange(tx, {
        subjectType: 'placement',
        subjectId: placement.id,
        fromStatus: placement.status,
        toStatus: 'dropped_out',
        changedByStaffId: actor.id,
        reason: 'candidate_dropout',
      });

      return up;
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

    if (actor.role === 'field_agent' && placement.business.accountAgentId !== actor.id) {
      throw new ForbiddenException('Field agents may only manage placements for their account businesses');
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

    if (actor.role === 'field_agent' && placement.business.accountAgentId !== actor.id) {
      throw new ForbiddenException('Field agents may only manage placements for their account businesses');
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
    const policy = await this.getPolicy();
    const newRejectionCount = placement.replacementRejectionCount + 1;
    const shouldPause = newRejectionCount > policy.maxReplacementRejections;

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
        OR: [{ id: placementId }, { code: placementId }],
      },
      include: {
        business: true,
      },
    });
    if (!placement) {
      throw new NotFoundException(`Placement '${placementId}' not found`);
    }

    if (actor.role === 'field_agent' && placement.business.accountAgentId !== actor.id) {
      throw new ForbiddenException('Field agents may only manage placements for their account businesses');
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

    const [updatedCandidate, updatedPlacement] = await this.prisma.$transaction(async (tx) => {
      const c = await tx.replacementCandidate.update({
        where: { id: candidate.id },
        data: {
          status: 'accepted',
          acceptedAt: now,
        },
      });

      const p = await tx.placement.update({
        where: { id: placement.id },
        data: {
          status: 'replaced',
        },
      });
      await recordStatusChange(tx, {
        subjectType: 'placement',
        subjectId: placement.id,
        fromStatus: placement.status,
        toStatus: 'replaced',
        changedByStaffId: actor.id,
      });

      await tx.jobSeeker.update({
        where: { id: candidate.jobSeekerId },
        data: {
          status: 'placed',
        },
      });
      await recordStatusChange(tx, {
        subjectType: 'job_seeker',
        subjectId: candidate.jobSeekerId,
        fromStatus: 'active',
        toStatus: 'placed',
        changedByStaffId: actor.id,
        reason: 'replacement_accepted',
      });

      return [c, p];
    });

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
        acceptedAt: now.toISOString(),
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
    if (actor.role === 'team_lead') {
      const team = await this.prisma.staff.findMany({ where: { teamLeadId: actor.id }, select: { id: true } });
      const teamIds = team.map(({ id }) => id);
      where.business = {
        OR: [
          { accountAgentId: { in: teamIds } },
          { leadCreatedByStaffId: { in: teamIds } },
        ],
      };
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

    const policy = await this.getPolicy();
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
        searchDays: policy.replacementSearchDays,
      },
      now,
    );

    if (!eligibilityResult.eligible) {
      throw new BadRequestException(eligibilityResult.ineligibleReason!);
    }

    const refundAmount = eligibilityResult.amountPaise;
    const daysElapsed = eligibilityResult.daysElapsed;

    const paymentCode = await this.idService.generateCode('payment');
    const payment = await this.prisma.$transaction(async (tx) => {
      const p = await tx.payment.create({
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

      await recordStatusChange(tx, {
        subjectType: 'payment',
        subjectId: p.id,
        fromStatus: null,
        toStatus: 'completed',
        changedByStaffId: actor.id,
        reason: 'placement_guarantee_refund',
      });

      return p;
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

    // Re-use stored placement fee and GST from placement record at creation, never today's policy!
    const policy = await this.getPolicy();
    const gstPercent = placement.gstPercentAtCreation ?? policy.gstPercent;
    const feePercent = placement.feePercentAtCreation ?? policy.placementFeePercent;
    const baseAmountPaise = placement.placementFee || calculatePlacementFee(placement.agreedSalary, feePercent);
    const totalTaxPaise = placement.gstAmount || calculateGst(baseAmountPaise, gstPercent);
    const totalAmountPaise = baseAmountPaise + totalTaxPaise;

    const cgstRatePercent = Math.floor(gstPercent / 2);
    const sgstRatePercent = gstPercent - cgstRatePercent;
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
      locality: placement.business.locality,
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
          description: `Placement fee for trade: ${placement.vacancy.tradeSkill} (${feePercent}% of monthly salary)`,
          sacCode: '9985',
          baseAmountPaise,
          taxRatePercent: gstPercent,
          cgstRatePercent,
          cgstAmountPaise,
          sgstRatePercent,
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

    if (query.locality) {
      where.business = { locality: query.locality };
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
      locality: p.business.locality,
      city: p.city,
    }));
  }
}




