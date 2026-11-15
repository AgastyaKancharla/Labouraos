import { OwnTeam, businessesOwnedBy } from '../../common/rbac/own-team';
import { isBusinessSuspended } from '../business/business-candidate-access';
import { chainRefundOf } from './chain-refund';
import { claimPausedMs, claimRefundPause, resumeEndedSuspensions } from './claim-clock';
import { invoiceGstSplit } from './invoice-gst-split';
import { assertRejectionOverride, findRefundRejection, refundLockKey } from '../refund/refund-rejection';
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
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
} from '../../common/money/money';
import { JobSeekerService } from '../job-seeker/job-seeker.service';
import { PaymentService } from '../payment/payment.service';
import { UpiCollectionService } from '../payment/upi-collection.service';
import { PricingService } from '../pricing/pricing.service';
import { RecordJoinedDto } from './dto/record-joined.dto';
import { ReportClaimDto } from './dto/report-claim.dto';
import { DecideClaimDto } from './dto/decide-claim.dto';
import { isValidClaimReason, isRejectClaimReason } from './claim-reasons';
import { addDays, daysBetween, istDayOf, istDayStart } from './claim-dates';
import { isAutoRejectionCode, isReviewRejectionCode, refileRule, rejectionCodeOf } from './claim-refile';
import { isUniqueViolation } from '../../common/money/utr-registry';
import { ApprovePlacementRefundDto } from './dto/approve-refund.dto';
import { evaluatePlacementRefundEligibility } from './placement-refund-eligibility';
import { businessRefundNeedsCeo, ceoApprovalMessage } from '../../common/money/approval-limits';
import { decisionTime } from '../../common/time/decision-time';
import { stripMoney } from '../../common/rbac/money-visibility';

/**
 * Who sees company money (placement fee, GST) on placements: the CEO and Finance.
 * Managers never see money; agents and Team Leads see none either (a field agent
 * selling in the shop works the fee out with the fee calculator, Master Guide).
 */
const PLACEMENT_MONEY_ROLES: ReadonlySet<string> = new Set(['ceo', 'finance']);
import {
  LIVE_PAYOUT_STATUSES,
  alreadyExists,
  isDuplicatePayout,
  lockSubject,
} from '../../common/money/one-per-subject';
import { recordStatusChange } from '../../common/status-history/status-history.helper';
import {
  GstInvoiceResponse,
  InvoiceCustomer,
  InvoicePlacementInfo,
  InvoiceSupplier,
} from './dto/gst-invoice.dto';
import { ExportPlacementsQueryDto, RegulatoryPlacementExportRow } from './dto/export-placements.dto';
import { EditPolicyService, EditActor } from '../../common/edit-policy/edit-policy.service';
import { ReviewFlagService } from '../review-flag/review-flag.service';
import { MessagingService } from '../message/messaging.service';
import { ReportingScopeService } from '../staff/reporting-scope.service';
import { CustomerNotificationService } from '../customer-notification/customer-notification.service';

export function calculateDaysElapsed(
  startDate: Date,
  asOfOrIsPaused?: boolean | Date,
  pausedAt?: Date | null,
  asOf: Date = new Date(),
): number {
  let effectiveEnd: Date;
  if (typeof asOfOrIsPaused === 'boolean') {
    effectiveEnd = asOfOrIsPaused && pausedAt ? pausedAt : asOf;
  } else if (asOfOrIsPaused instanceof Date) {
    effectiveEnd = asOfOrIsPaused;
  } else {
    effectiveEnd = asOf;
  }
  const diffMs = Math.max(0, effectiveEnd.getTime() - startDate.getTime());
  return Math.floor(diffMs / (1000 * 60 * 60 * 24));
}

@Injectable()
export class PlacementService {
  private readonly logger = new Logger(PlacementService.name);
  constructor(
    private readonly prisma: PrismaService,
    private readonly idService: IdService,
    private readonly auditService: AuditService,
    private readonly jobSeekerService: JobSeekerService,
    private readonly paymentService: PaymentService,
    private readonly pricingService: PricingService,
    private readonly upiCollectionService: UpiCollectionService,
    private readonly reviewFlags: ReviewFlagService,
    private readonly editPolicyService: EditPolicyService,
    @Optional() private readonly messaging?: MessagingService,
    @Optional() private readonly customerNotifications?: CustomerNotificationService,
    @Optional() private readonly reportingScope?: ReportingScopeService,
  ) {}

  async update(id: string, dto: Record<string, unknown>, actor: EditActor | string) {
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

    const { record, diff } = await this.editPolicyService.assertCanEdit({
      actor: editActor,
      entityType: 'placement',
      entityId: id,
      updates: dto,
      reason,
    });

    if (!diff || !diff.hasChange) {
      return record;
    }

    const data: Record<string, unknown> = {};
    for (const key of diff.changedFields) {
      if (['joiningDate', 'joinedDate'].includes(key)) {
        data[key] = dto[key] ? new Date(dto[key] as string) : null;
      } else {
        data[key] = dto[key];
      }
    }

    const updated = await this.prisma.placement.update({
      where: { id: record.id as string },
      data,
    });

    await this.editPolicyService.logEdit({
      actorId: editActor.id,
      entityType: 'placement',
      entityCode: record.code as string,
      diff,
      reason,
      city: record.city as string | undefined,
    });

    return updated;
  }

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

      if (interview.vacancy.replacementForPlacementId) {
        const droppedPlacement = await tx.placement.findUniqueOrThrow({
          where: { id: interview.vacancy.replacementForPlacementId },
        });
        const rootId = droppedPlacement.rootPlacementId ?? droppedPlacement.id;
        const rootPlacement = await tx.placement.findUniqueOrThrow({
          where: { id: rootId },
        });

        if (rootPlacement.guaranteeEndedReason) {
          throw new BadRequestException(
            `Guarantee has ended for this placement: ${rootPlacement.guaranteeEndedReason}`,
          );
        }

        // D2 (rev 176): replacing a selected candidate who never joined does not use up a free
        // replacement — it takes the same place in the chain and is not counted.
        const neverJoinedSwap = !droppedPlacement.joinedDate;
        const previousReplacements = await tx.placement.count({
          where: { rootPlacementId: rootId, replacementNumber: { gt: 0 }, countsAsReplacement: true },
        });
        const replacementNumber = neverJoinedSwap ? droppedPlacement.replacementNumber : previousReplacements + 1;
        const policy = await this.getPolicy();
        if (!neverJoinedSwap && replacementNumber > policy.maxFreeReplacements) {
          throw new BadRequestException(
            `A third replacement is refused; maximum free replacements is ${policy.maxFreeReplacements}`,
          );
        }

        // D3 (rev 181): a replacement hired above the HIGHEST salary the business already paid a fee on in
        // this chain (the first placement, and any salary difference paid since) pays the fee percent of the
        // positive difference plus GST before release. ₹25,000 (fee) → ₹20,000 → ₹25,000: nothing more;
        // ₹12,000 → ₹14,000 (difference paid) → ₹15,000: a fee on ₹1,000.
        const paidInChain = await tx.placement.findMany({
          where: { rootPlacementId: rootId, salaryUpgradeDifferencePaise: { not: null }, paidAt: { not: null }, status: { not: 'cancelled' } },
          select: { agreedSalary: true },
        });
        const highestPaidSalary = Math.max(rootPlacement.agreedSalary, ...(paidInChain ?? []).map((p) => p.agreedSalary));
        const upgradeDifference = Math.max(0, interview.selectedSalaryPaise - highestPaidSalary);
        const upgradeFee = upgradeDifference > 0 ? calculatePlacementFee(upgradeDifference, rootPlacement.feePercentAtCreation ?? agreement.feePercent) : 0;
        const upgradeGst = upgradeFee > 0 ? calculateGst(upgradeFee, rootPlacement.gstPercentAtCreation ?? agreement.gstPercent) : 0;
        const upgradeDue = upgradeFee > 0;

        const id = randomUUID();
        const code = await this.idService.generateCode('placement');
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
            paymentDueAt: upgradeDue ? new Date(now.getTime() + policy.placementPaymentDueHours * 60 * 60 * 1000) : null,
            paidAt: upgradeDue ? null : now,
            joiningDate: interview.selectedJoiningDate,
            rootPlacementId: rootId,
            replacementNumber,
            countsAsReplacement: !neverJoinedSwap,
            // The highest salary already paid a fee on in the chain (the invoice line says "more than" this).
            replacedSalaryPaise: highestPaidSalary,
            salaryUpgradeDifferencePaise: upgradeDue ? upgradeDifference : null,
            feePercentAtCreation: rootPlacement.feePercentAtCreation,
            gstPercentAtCreation: rootPlacement.gstPercentAtCreation,
            agreedSalary: interview.selectedSalaryPaise,
            placementFee: upgradeFee,
            gstAmount: upgradeGst,
            // Released (joining date confirmed) only once the difference is paid.
            status: upgradeDue ? 'awaiting_payment' : 'confirmed',
          },
          include: { business: true, jobSeeker: true, vacancy: true, payments: true },
        });

        await recordStatusChange(tx, {
          subjectType: 'placement',
          subjectId: placement.id,
          fromStatus: null,
          toStatus: upgradeDue ? 'awaiting_payment' : 'confirmed',
          changedByStaffId: interview.proposedByStaffId,
          changedAt: now,
          reason: upgradeDue ? 'replacement_salary_upgrade_payment_due' : neverJoinedSwap ? 'never_joined_replacement_selected' : 'free_replacement_selected',
        });

        // Job seeker becomes placed at selection — unless a salary-upgrade payment (D3) is due:
        // then the payment confirms the placement and places him (PaymentService.onPaymentSucceeded).
        if (!upgradeDue) {
          await tx.jobSeeker.update({
            where: { id: interview.jobSeekerId },
            data: { status: 'placed' },
          });
          await recordStatusChange(tx, {
            subjectType: 'job_seeker',
            subjectId: interview.jobSeekerId,
            fromStatus: 'active',
            toStatus: 'placed',
            changedByStaffId: interview.proposedByStaffId,
            changedAt: now,
            reason: 'placed_via_replacement',
          });
        }

        // Update replacement candidate row
        await tx.replacementCandidate.updateMany({
          where: { interviewId: interview.id },
          data: {
            status: 'accepted',
            acceptedAt: now,
          },
        });

        // Close the replacement vacancy
        await tx.vacancy.update({
          where: { id: interview.vacancyId },
          data: { status: 'filled' },
        });

        return {
          placement,
          totalAmount: upgradeFee + upgradeGst,
          existing: false,
          isReplacement: true,
          upgradeDue,
          actorId: interview.proposedByStaffId,
        };
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

    if (created.isReplacement) {
      await this.auditService.log({
        action: created.upgradeDue ? 'placement.replacement_upgrade_payment_requested' : 'placement.replacement_confirmed',
        entityType: 'Placement',
        entityCode: created.placement.code,
        actorId: created.actorId,
        city: created.placement.city,
        after: {
          status: created.placement.status,
          rootPlacementId: created.placement.rootPlacementId,
          replacementNumber: created.placement.replacementNumber,
          countsAsReplacement: created.placement.countsAsReplacement,
          salaryUpgradeDifferencePaise: created.placement.salaryUpgradeDifferencePaise ?? null,
          placementFee: created.placement.placementFee,
          gstAmount: created.placement.gstAmount,
        },
      });
      if (!created.upgradeDue) {
        return {
          ...created.placement,
          payment: null,
        };
      }
      // D3: the salary-upgrade difference is collected like a placement fee (UPI request, Finance sees it).
      const upgradeBranch = created.placement.vacancy?.branchId
        ? await this.prisma.businessBranch.findUnique({ where: { id: created.placement.vacancy.branchId } })
        : null;
      const upgradeRequest = await this.upiCollectionService.createRequest({
        type: 'replacement_upgrade',
        subjectType: 'placement',
        subjectId: created.placement.id,
        amountPaise: created.totalAmount,
        city: created.placement.city,
        businessId: created.placement.businessId,
        placementId: created.placement.id,
        notifySubjectType: 'business',
        notifySubjectId: created.placement.businessId,
        notifyRecipientPhone: upgradeBranch?.contactPersonPhone,
      });
      const upgradePayment = await this.prisma.payment.findUnique({ where: { id: upgradeRequest.paymentId } });
      return {
        ...created.placement,
        payment: upgradePayment ? {
          id: upgradePayment.id,
          code: upgradePayment.code,
          amount: upgradePayment.amount,
          status: upgradePayment.status,
          paymentLink: upgradeRequest.paymentLink,
          gatewayReference: upgradePayment.gatewayReference,
          upiReference: upgradePayment.upiReference,
        } : null,
      };
    }

    let payment = created.placement.payments?.find((p) => p.type === 'placement_fee') ?? null;
    let paymentLink: string | null = null;

    if (!created.existing) {
      const branchId = created.placement.vacancy?.branchId;
      const branch = branchId
        ? await this.prisma.businessBranch.findUnique({ where: { id: branchId } })
        : null;
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
        notifyRecipientPhone: branch?.contactPersonPhone,
      });
      payment = await this.prisma.payment.findUnique({ where: { id: upiRequest.paymentId } });
      paymentLink = upiRequest.paymentLink;

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

  async resendPaymentLink(placementId: string) {
    const placement = await this.prisma.placement.findFirst({
      where: {
        OR: [{ id: placementId }, { code: placementId }],
      },
      include: {
        business: true,
        vacancy: true,
      },
    });
    if (!placement) {
      throw new NotFoundException(`Placement '${placementId}' not found`);
    }
    const payment = await this.prisma.payment.findFirst({
      where: {
        placementId: placement.id,
        status: 'pending',
      },
      orderBy: { createdAt: 'desc' },
    });
    if (!payment) {
      throw new NotFoundException(`No pending payment found for placement '${placement.code}'`);
    }
    if (!this.upiCollectionService) {
      throw new BadRequestException('UpiCollectionService is not configured');
    }
    const branchId = placement.vacancy?.branchId;
    const branch = branchId
      ? await this.prisma.businessBranch.findUnique({ where: { id: branchId } })
      : null;
    return this.upiCollectionService.resendRequest(payment.id, 'business', placement.businessId, branch?.contactPersonPhone);
  }

  async recordJoined(id: string, _dto?: RecordJoinedDto, actorId?: string, now = new Date()) {
    if (!actorId) {
      throw new BadRequestException('actorId is required');
    }
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

    if (actor && actor.role === 'field_agent' && placement.business.accountAgentId !== actor.id) {
      throw new ForbiddenException('Field agents may only manage placements for their account businesses');
    }

    if (placement.status !== 'confirmed') {
      throw new BadRequestException(
        `Placement must be in 'confirmed' status to record joining. Current status: '${placement.status}'`,
      );
    }

    if (!placement.joiningDate) {
      throw new BadRequestException('Placement does not have a confirmed joining date');
    }

    if (now.getTime() < placement.joiningDate.getTime()) {
      throw new BadRequestException(
        `Cannot record joining before the joining date (${placement.joiningDate.toISOString()})`,
      );
    }

    // Both worker and business joining confirmation calls must be answered and made on or after joiningDate
    const workerCall = await this.prisma.callRecord.findFirst({
      where: {
        subjectType: 'job_seeker',
        subjectId: placement.jobSeekerId,
        purpose: 'joining_confirmation',
        answered: true,
        OR: [
          { relatedId: placement.id },
          { relatedId: null },
        ],
        AND: [
          {
            OR: [
              { startedAt: { gte: placement.joiningDate } },
              { answeredAt: { gte: placement.joiningDate } },
              { createdAt: { gte: placement.joiningDate } },
            ],
          },
        ],
      },
      orderBy: [{ startedAt: 'desc' }, { createdAt: 'desc' }],
    });

    const businessCall = await this.prisma.callRecord.findFirst({
      where: {
        subjectType: 'business',
        subjectId: placement.businessId,
        purpose: 'joining_confirmation',
        answered: true,
        OR: [
          { relatedId: placement.id },
          { relatedId: null },
        ],
        AND: [
          {
            OR: [
              { startedAt: { gte: placement.joiningDate } },
              { answeredAt: { gte: placement.joiningDate } },
              { createdAt: { gte: placement.joiningDate } },
            ],
          },
        ],
      },
      orderBy: [{ startedAt: 'desc' }, { createdAt: 'desc' }],
    });

    if (!workerCall && !businessCall) {
      throw new BadRequestException(
        'Both worker and business joining confirmation calls are missing or unanswered',
      );
    }
    if (!workerCall) {
      throw new BadRequestException(
        'Worker joining confirmation call is missing or was not answered',
      );
    }
    if (!businessCall) {
      throw new BadRequestException(
        'Business joining confirmation call is missing or was not answered',
      );
    }

    // joinedDate = the day both were confirmed — never a date typed by an agent
    const workerCallTime = workerCall.answeredAt ?? workerCall.startedAt ?? workerCall.createdAt;
    const businessCallTime = businessCall.answeredAt ?? businessCall.startedAt ?? businessCall.createdAt;
    const joinedDate = new Date(Math.max(workerCallTime.getTime(), businessCallTime.getTime()));

    const before = {
      status: placement.status,
      joinedDate: placement.joinedDate,
      joiningWorkerCallId: placement.joiningWorkerCallId,
      joiningBusinessCallId: placement.joiningBusinessCallId,
    };

    const updated = await this.prisma.$transaction(async (tx) => {
      const up = await tx.placement.update({
        where: { id: placement.id },
        data: {
          status: 'active',
          joinedDate,
          joiningWorkerCallId: workerCall.id,
          joiningBusinessCallId: businessCall.id,
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
        changedByStaffId: actor?.id ?? null,
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
        joiningWorkerCallId: updated.joiningWorkerCallId,
        joiningBusinessCallId: updated.joiningBusinessCallId,
      },
    });

    // Phase 6 Task 1: Trigger referral payout if candidate was referred (flat ₹200 on joining)
    if (updated.jobSeeker?.referredById) {
      await this.paymentService.createReferralPayout(updated.id, actor.id);
    }

    // Phase 18 Task 4: Automatically send payout details link to worker if no account
    if (this.paymentService?.sendPayoutDetailsLinkIfNoAccount) {
      await this.paymentService.sendPayoutDetailsLinkIfNoAccount(
        'job_seeker',
        updated.jobSeekerId,
        actor.id,
        actor.role,
      );
    }

    return updated;
  }

  async completeDay60Placements(now = new Date()): Promise<number> {
    const policy = await this.pricingService.current();
    const windowDays = policy.replacementWindowDays;

    const activePlacements = await this.prisma.placement.findMany({
      where: {
        status: 'active',
        joinedDate: { not: null },
      },
      include: {
        business: true,
      },
    });

    let completedCount = 0;

    for (const placement of activePlacements) {
      if (placement.guaranteeEndedReason) {
        continue;
      }

      let rootJoinedDate = placement.joinedDate;
      if (placement.rootPlacementId && placement.rootPlacementId !== placement.id) {
        const root = await this.prisma.placement.findUnique({
          where: { id: placement.rootPlacementId },
          select: { joinedDate: true, guaranteeEndedReason: true, status: true },
        });
        if (root?.guaranteeEndedReason || root?.status === 'guarantee_ended') {
          continue;
        }
        // D2: a root who never joined — the guarantee runs from the first worker who did.
        const chainStart = root?.joinedDate ?? (root ? await this.firstJoinedInChain(placement.rootPlacementId) : null);
        if (chainStart) {
          rootJoinedDate = chainStart;
        }
      }

      if (!rootJoinedDate) {
        continue;
      }

      // Check open claims
      const openClaim = await this.prisma.replacementClaim.findFirst({
        where: {
          placementId: placement.id,
          decision: null,
        },
      });
      if (openClaim) {
        continue;
      }

      const expiryThreshold = new Date(rootJoinedDate.getTime() + windowDays * 24 * 60 * 60 * 1000);
      if (now.getTime() >= expiryThreshold.getTime()) {
        await this.prisma.$transaction(async (tx) => {
          await tx.placement.update({
            where: { id: placement.id },
            data: { status: 'completed' },
          });

          await recordStatusChange(tx, {
            subjectType: 'placement',
            subjectId: placement.id,
            fromStatus: 'active',
            toStatus: 'completed',
            changedByStaffId: null,
            reason: 'replacement_guarantee_window_completed',
          });
        });

        const systemStaff =
          (await this.prisma.staff.findFirst({
            where: { role: 'ceo' },
            select: { id: true },
          })) ?? (await this.prisma.staff.findFirst({ select: { id: true } }));

        if (systemStaff) {
          await this.auditService.log({
            action: 'placement_completed',
            entityType: 'Placement',
            entityCode: placement.code,
            actorId: systemStaff.id,
            city: placement.city,
            before: { status: 'active' },
            after: { status: 'completed' },
          });
        }

        completedCount++;
      }
    }

    return completedCount;
  }

  async queueJoiningRewards(now = new Date()): Promise<number> {
    const policy = await this.pricingService.current();
    const rewardDays = policy.joiningRewardAfterDays;
    const rewardAmount = policy.joiningRewardPaise;

    const placements = await this.prisma.placement.findMany({
      where: {
        status: 'active',
        joinedDate: { not: null },
      },
      include: {
        replacementClaims: {
          where: { decision: 'accepted' },
        },
      },
    });

    let queuedCount = 0;

    for (const placement of placements) {
      if (!placement.joinedDate) continue;

      const daysElapsed = Math.floor(
        (now.getTime() - placement.joinedDate.getTime()) / (24 * 60 * 60 * 1000),
      );
      if (daysElapsed < rewardDays) {
        continue;
      }

      // Worker is still there: no accepted replacement claim on this placement
      if (placement.replacementClaims && placement.replacementClaims.length > 0) {
        continue;
      }

      // Once per placement: check if joining_reward already exists
      const existing = await this.prisma.payment.findFirst({
        where: { placementId: placement.id, type: 'joining_reward' },
      });
      if (existing) {
        continue;
      }

      const payment = await this.createJoiningReward(placement, rewardAmount);
      if (!payment) continue;

      await this.auditService.log({
        action: 'joining_reward_queued',
        entityType: 'payment',
        entityCode: payment.code,
        actorId: placement.createdByStaffId ?? placement.jobSeekerId,
        city: placement.city,
        after: {
          code: payment.code,
          placementId: placement.id,
          jobSeekerId: placement.jobSeekerId,
          amount: rewardAmount,
          status: 'pending',
        },
      });

      queuedCount++;
    }

    return queuedCount;
  }

  /**
   * Queues the ₹200 joining reward for one placement, once. H2: two runs of the job
   * at once (or a manual run during the nightly one) still queue one reward: the lock
   * makes the second wait and look again, and the partial unique index on placementId
   * refuses a second reward in any case. Null when the placement already has one.
   */
  async createJoiningReward(
    placement: { id: string; city: string; jobSeekerId: string },
    rewardAmountPaise: number,
  ) {
    const existingWhere = { placementId: placement.id, type: 'joining_reward' };
    const code = await this.idService.generateCode('payment');
    try {
      return await this.prisma.$transaction(async (tx) => {
        await lockSubject(tx, `joining_reward:${placement.id}`);
        if (await tx.payment.findFirst({ where: existingWhere })) return null;
        return tx.payment.create({
          data: {
            code,
            city: placement.city,
            type: 'joining_reward',
            amount: rewardAmountPaise,
            status: 'pending',
            subjectType: 'job_seeker',
            subjectId: placement.jobSeekerId,
            jobSeekerId: placement.jobSeekerId,
            placementId: placement.id,
          },
        });
      });
    } catch (error) {
      if (isDuplicatePayout(error)) return null;
      throw error;
    }
  }

  async triggerReferralPayout(placementId: string, actorId?: string) {
    return this.paymentService.createReferralPayout(placementId, actorId);
  }

  /**
   * Staff whose calls a person may pick as the claim's owner call — the same
   * people GET /calls shows them: everyone's for the CEO and Managers, their
   * team's for a Team Lead, their own for agents.
   */
  async claimCallStaffIds(actor: { id: string; role: string }): Promise<string[] | null> {
    if (actor.role === 'ceo' || actor.role === 'manager') return null;
    if (actor.role === 'team_lead') {
      // The shared own-team definition (OwnTeam), the Team Lead included.
      return new OwnTeam(this.prisma).memberIds(actor.id);
    }
    return [actor.id];
  }

  /** Call agents and Team Leads report only on placements they may see (GET /placements scope); outside it → 404. */
  async assertClaimScope(actor: { id: string; role: string }, placement: { id: string; code: string }): Promise<void> {
    if (actor.role !== 'call_agent' && actor.role !== 'team_lead') return;
    const scope = await this.placementListScope(actor);
    const visible = await this.prisma.placement.findFirst({ where: { AND: [scope, { id: placement.id }] }, select: { id: true } });
    if (!visible) throw new NotFoundException(`Placement '${placement.code}' not found`);
  }

  async reportClaim(
    placementIdOrCode: string,
    dto: ReportClaimDto,
    actorId: string,
    now = new Date(),
  ) {
    if (!actorId) throw new BadRequestException('actorId is required');

    const actor = await this.prisma.staff.findUnique({ where: { id: actorId } });
    if (!actor) throw new NotFoundException(`Staff '${actorId}' not found`);

    const allowedRoles = ['field_agent', 'call_agent', 'team_lead', 'manager', 'ceo'];
    if (!allowedRoles.includes(actor.role)) {
      throw new ForbiddenException(`Role '${actor.role}' cannot report replacement claims`);
    }

    const placement = await this.prisma.placement.findFirst({
      where: {
        OR: [{ id: placementIdOrCode }, { code: placementIdOrCode }],
      },
      include: {
        business: true,
        jobSeeker: true,
        vacancy: true,
        payments: true,
      },
    });

    if (!placement) {
      throw new NotFoundException(`Placement '${placementIdOrCode}' not found`);
    }

    if (actor.role === 'field_agent' && placement.business.accountAgentId !== actor.id) {
      throw new ForbiddenException('Field agents may only report claims for their account businesses');
    }
    await this.assertClaimScope(actor, placement);

    // D2 (rev 176): a selected, paid candidate who never joined (confirmed, no joining recorded) is
    // reported with "never_joined" on or after the joining day; the replacement does not count.
    const neverJoined = dto.reason === 'never_joined' && placement.status === 'confirmed' && !placement.joinedDate && Boolean(placement.joiningDate);
    if (placement.status !== 'active' && !neverJoined) {
      throw new BadRequestException(
        `Cannot report claim on placement in status '${placement.status}'; placement must be active`,
      );
    }

    const rootPlacement = placement.rootPlacementId
      ? await this.prisma.placement.findUnique({
          where: { id: placement.rootPlacementId },
          include: { payments: true },
        })
      : placement;

    // The 60 days run from the first employee's joining day: the root's, or — when the root never
    // joined and was swapped (D2) — the first joining recorded in the chain.
    const guaranteeStart = rootPlacement
      ? rootPlacement.joinedDate ?? (await this.firstJoinedInChain(rootPlacement.id))
      : null;
    if (!rootPlacement || (!guaranteeStart && !neverJoined)) {
      throw new BadRequestException(
        'Placement has no recorded joinedDate; cannot evaluate replacement claim',
      );
    }

    // Indian calendar days: the guarantee counts from the first worker's joining
    // day; a replacement worker cannot leave before his own joining day.
    const leftDay = istDayOf(dto.workerLeftOn ?? '');
    if (!dto.workerLeftOn || !leftDay) {
      throw new BadRequestException('Invalid workerLeftOn date');
    }
    const workerLeftOn = new Date(dto.workerLeftOn);
    const policy = await this.pricingService.current();
    const windowDays = policy.replacementWindowDays;
    const rootJoinedDay = guaranteeStart ? istDayOf(guaranteeStart)! : null;
    const ownJoinedDay = istDayOf(placement.joinedDate ?? (neverJoined ? placement.joiningDate! : guaranteeStart!))!;
    const today = istDayOf(now)!;

    if (leftDay < ownJoinedDay) {
      throw new BadRequestException(
        neverJoined
          ? `A candidate who never joined is reported on or after the joining day (${ownJoinedDay})`
          : `workerLeftOn cannot be earlier than the joining day (${ownJoinedDay}); employee cannot leave before they started`,
      );
    }

    if (rootJoinedDay && leftDay > addDays(rootJoinedDay, windowDays)) {
      throw new BadRequestException(
        `Worker left outside the ${windowDays}-day replacement guarantee window`,
      );
    }

    if (leftDay > today) {
      throw new BadRequestException('workerLeftOn cannot be in the future');
    }

    if (!dto.callRecordId) {
      throw new BadRequestException('callRecordId is required');
    }

    const ownerCall = await this.prisma.callRecord.findUnique({
      where: { id: dto.callRecordId },
    });

    if (
      !ownerCall ||
      !ownerCall.answered ||
      ownerCall.subjectType !== 'business' ||
      ownerCall.subjectId !== placement.businessId
    ) {
      throw new BadRequestException(
        'Claim must be recorded on an answered call with the owner',
      );
    }

    // The call is the evidence: made on or after the day the worker left (not
    // an older call), not in the future, by someone whose calls this person
    // may use, and not already the evidence of another claim.
    const callAt = ownerCall.createdAt ?? ownerCall.startedAt;
    if (!callAt || callAt.getTime() < istDayStart(leftDay).getTime() || callAt.getTime() > now.getTime()) {
      throw new BadRequestException('The owner call must be made on or after the day the worker left');
    }
    const callStaff = await this.claimCallStaffIds(actor);
    if (callStaff && (!ownerCall.staffId || !callStaff.includes(ownerCall.staffId))) {
      throw new ForbiddenException('Pick a call made by you or your team');
    }
    const usedBy = await this.prisma.replacementClaim.findFirst({ where: { callRecordId: ownerCall.id }, select: { code: true } });
    if (usedBy) {
      throw new ConflictException(`This call is already the evidence of claim ${usedBy.code}`);
    }

    if (!isValidClaimReason(dto.reason)) {
      throw new BadRequestException(`Invalid claim reason '${dto.reason}'`);
    }

    // After a rejection: once more for a fixable mistake (within the original
    // 7 days), never after a late / unpaid / not-covered rejection, and only by
    // a Manager or the CEO after a person reviewed and rejected it.
    const pastClaims = (await this.prisma.replacementClaim.findMany({
      where: { placementId: placement.id, decision: { not: null } },
      select: { code: true, workerLeftOn: true, reportedAt: true, decision: true, decisionReason: true, rejectionCode: true, decidedByStaffId: true, overruledByStaffId: true },
    })) ?? [];
    const refile = refileRule(pastClaims, actor.role, today, policy.claimReportDays);
    if (!refile.allowed) {
      throw new ForbiddenException(refile.message ?? 'This claim cannot be reported again');
    }

    const reportedAt = now;
    const diffDays = daysBetween(leftDay, today);
    const reportedWithinDeadline = diffDays <= policy.claimReportDays;

    const rootFeePayment = rootPlacement.payments?.find(
      (p) => p.type === 'placement_fee' && p.status === 'succeeded',
    );
    const feePaidInFull = rootPlacement.paidAt !== null || !!rootFeePayment;

    const inRejectList = isRejectClaimReason(dto.reason);

    let decision: string | null = null;
    let decisionReason: string | null = null;
    let decidedAt: Date | null = null;
    let rejectionCode: string | null = null;

    if (!reportedWithinDeadline) {
      decision = 'rejected';
      decisionReason = `Auto-rejected: Reported ${diffDays} days after worker left; deadline is ${policy.claimReportDays} days`;
      decidedAt = reportedAt;
      rejectionCode = 'reported_late';
    } else if (!feePaidInFull) {
      decision = 'rejected';
      decisionReason = 'Auto-rejected: Root placement fee is not paid in full';
      decidedAt = reportedAt;
      rejectionCode = 'fee_unpaid';
    } else if (inRejectList) {
      decision = 'rejected';
      decisionReason = `Auto-rejected: Reason '${dto.reason}' is in the non-eligible rejection list`;
      decidedAt = reportedAt;
      rejectionCode = 'reason_not_covered';
    }

    const decisionDueHours = policy.claimDecisionHours;
    const decisionDueAt = new Date(
      reportedAt.getTime() + decisionDueHours * 60 * 60 * 1000,
    );

    const code = await this.idService.generateCode('replacement_claim');

    // One claim waiting per placement: the placement row is locked while we
    // look and create, and a partial unique index (migration
    // 20261129000000_claims_and_set_aside) refuses a second undecided claim even so.
    const openClaimExists = () => new ConflictException('A claim on this placement is already waiting for a decision');
    let claim;
    try {
      claim = await this.prisma.$transaction(async (tx) => {
        await tx.$queryRaw(Prisma.sql`SELECT "id" FROM "Placement" WHERE "id" = ${placement.id} FOR UPDATE`);
        const waiting = await tx.replacementClaim.findFirst({ where: { placementId: placement.id, decision: null }, select: { id: true } });
        if (waiting) throw openClaimExists();
        return tx.replacementClaim.create({
          data: {
            code,
            placementId: placement.id,
            workerLeftOn,
            reportedAt,
            reportedWithinDeadline,
            feePaidInFull,
            reason: dto.reason,
            evidencePaths: dto.evidencePaths ?? [],
            exitCallRecordId: dto.exitCallRecordId ?? null,
            callRecordId: dto.callRecordId,
            reportedByStaffId: actor.id,
            decision,
            decisionReason,
            rejectionCode,
            decidedByStaffId: null,
            decidedAt,
            decisionDueAt,
            // M10 (rev 178): reported while the business is suspended — its 15-day clock starts paused.
            searchPausedAt: placement.business && isBusinessSuspended(placement.business, reportedAt) ? reportedAt : null,
          },
          include: {
            placement: true,
            callRecord: true,
            exitCallRecord: true,
            decidedByStaff: true,
            overruledByStaff: true,
          },
        });
      });
    } catch (error) {
      if (isUniqueViolation(error)) {
        // The other unique index: the same owner call used by a claim made at the same moment.
        const target = JSON.stringify((error as { meta?: unknown }).meta ?? '');
        if (/call/i.test(target)) throw new ConflictException('This call is already the evidence of another claim');
        throw openClaimExists();
      }
      throw error;
    }

    await this.auditService.log({
      action: 'replacement_claim_reported',
      entityType: 'ReplacementClaim',
      entityCode: claim.code,
      actorId: actor.id,
      city: placement.city,
      after: {
        code: claim.code,
        placementId: placement.id,
        reason: claim.reason,
        decision: claim.decision,
        decisionReason: claim.decisionReason,
        decisionDueAt: claim.decisionDueAt,
      },
    });

    if (!decision && !dto.exitCallRecordId && this.prisma.followUpTask) {
      const taskCode = await this.idService.generateCode('follow_up_task');
      await this.prisma.followUpTask.create({
        data: {
          code: taskCode,
          kind: 'exit_call',
          subjectType: 'job_seeker',
          subjectId: placement.jobSeekerId,
          relatedType: 'replacement_claim',
          relatedId: claim.id,
          dueAt: decisionDueAt,
          assignedStaffId: placement.business.accountAgentId ?? actor.id,
          status: 'pending',
        },
      });
    }

    return claim;
  }

  /** The first joining day recorded among a root placement's chain (the root itself never joined). */
  /**
   * D2: when the first selected candidate never joined, the 60 days count from the
   * first worker in the chain who did join (a never-joined swap takes his place).
   */
  async firstJoinedInChain(rootId: string): Promise<Date | null> {
    const first = await this.prisma.placement.findFirst({
      where: { rootPlacementId: rootId, joinedDate: { not: null } },
      orderBy: { joinedDate: 'asc' },
      select: { joinedDate: true },
    });
    return first?.joinedDate ?? null;
  }

  async decideClaim(
    placementIdOrCode: string,
    claimIdOrCode: string,
    dto: DecideClaimDto,
    actorId: string,
    now = new Date(),
  ) {
    if (!actorId) throw new BadRequestException('actorId is required');

    const actor = await this.prisma.staff.findUnique({ where: { id: actorId } });
    if (!actor) throw new NotFoundException(`Staff '${actorId}' not found`);

    if (!['team_lead', 'manager', 'ceo'].includes(actor.role)) {
      throw new ForbiddenException(
        `Role '${actor.role}' cannot decide replacement claims; requires team_lead, manager or ceo`,
      );
    }

    const claim = await this.prisma.replacementClaim.findFirst({
      where: {
        OR: [{ id: claimIdOrCode }, { code: claimIdOrCode }],
      },
      include: {
        placement: {
          include: {
            business: true,
            jobSeeker: true,
            vacancy: true,
          },
        },
      },
    });

    if (!claim) {
      throw new NotFoundException(`ReplacementClaim '${claimIdOrCode}' not found`);
    }

    if (claim.placementId !== placementIdOrCode && claim.placement.code !== placementIdOrCode) {
      throw new BadRequestException('Claim does not belong to the specified placement');
    }

    if (actor.role === 'team_lead') {
      // businessOwners (rev 170): the account agent's team, else the lead
      // creator's team; with neither, a Manager decides. Same check as the
      // route's own (RbacGuard, placement).
      const business = claim.placement.business;
      if (!(await new OwnTeam(this.prisma).ownsBusiness(actor.id, business))) {
        throw new ForbiddenException('Team Leads can only decide claims for their own team');
      }
    }

    if (claim.reportedByStaffId && claim.reportedByStaffId === actor.id) {
      throw new ForbiddenException('You reported this claim, so someone else decides it');
    }

    const isOverrule = claim.decision !== null;
    if (isOverrule && actor.role !== 'manager' && actor.role !== 'ceo') {
      throw new ForbiddenException('Only Manager or CEO can overrule an existing claim decision');
    }

    if (!['accepted', 'rejected'].includes(dto.decision)) {
      throw new BadRequestException(`Decision must be 'accepted' or 'rejected'; got '${dto.decision}'`);
    }

    if (!dto.decisionReason || dto.decisionReason.trim().length === 0) {
      throw new BadRequestException('decisionReason is required');
    }
    if (dto.rejectionCode !== undefined && dto.rejectionCode !== null && dto.decision === 'rejected' && !isReviewRejectionCode(dto.rejectionCode)) {
      throw new BadRequestException("rejectionCode is one of 'wrong_details', 'no_owner_call' or 'reviewed'");
    }

    const before = {
      decision: claim.decision,
      decisionReason: claim.decisionReason,
      decidedByStaffId: claim.decidedByStaffId,
      decidedAt: claim.decidedAt,
      overruledByStaffId: claim.overruledByStaffId,
      overruleReason: claim.overruleReason,
      placementStatus: claim.placement.status,
    };

    // An automatic rejection (late, fee unpaid, not covered) that is overruled
    // but stays rejected keeps its automatic code: it is never reported again.
    // (Overruling it to accepted stays allowed: owner decision 14 Nov.)
    const currentCode = rejectionCodeOf(claim);
    const keepsAutoCode = dto.decision === 'rejected' && currentCode !== null && isAutoRejectionCode(currentCode);
    const rejectionCode =
      dto.decision !== 'rejected' ? null : keepsAutoCode ? currentCode : isReviewRejectionCode(dto.rejectionCode) ? dto.rejectionCode : 'reviewed';

    const updatedClaim = await this.prisma.$transaction(async (tx) => {
      const updateData: Prisma.ReplacementClaimUncheckedUpdateManyInput = {
        decision: dto.decision,
        decisionReason: dto.decisionReason,
        decidedAt: now,
        rejectionCode,
      };

      if (isOverrule) {
        updateData.overruledByStaffId = actor.id;
        updateData.overruleReason = dto.decisionReason;
      } else {
        updateData.decidedByStaffId = actor.id;
      }

      // Only if nobody decided or overruled it since we read it: an accept and a
      // reject at the same moment never both apply (409 for the second).
      const claimed = await tx.replacementClaim.updateMany({
        where: { id: claim.id, decision: claim.decision, overruledByStaffId: claim.overruledByStaffId },
        data: updateData,
      });
      if (claimed.count !== 1) {
        throw new ConflictException('This claim was decided by someone else meanwhile; reload');
      }
      const updated = await tx.replacementClaim.findUniqueOrThrow({
        where: { id: claim.id },
        include: {
          placement: true,
          decidedByStaff: true,
          overruledByStaff: true,
        },
      });

      if (dto.decision === 'accepted') {
        const policy = await this.getPolicy();
        const rootId = claim.placement.rootPlacementId ?? claim.placementId;
        const rootPlacement = claim.placement.rootPlacementId
          ? await tx.placement.findUniqueOrThrow({ where: { id: rootId } })
          : claim.placement;
        // D2: a candidate who never joined is replaced without using a free replacement.
        const neverJoined = claim.reason === 'never_joined' && claim.placement.status === 'confirmed' && !claim.placement.joinedDate;
        const lastReplacement = !neverJoined && claim.placement.replacementNumber >= policy.maxFreeReplacements;

        // Only an active placement can be accepted: two acceptances (or an
        // accept after the worker was already replaced) never create a second
        // replacement vacancy.
        const moved = await tx.placement.updateMany({
          where: { id: claim.placementId, status: neverJoined ? 'confirmed' : 'active' },
          data: lastReplacement
            ? { status: 'guarantee_ended', guaranteeEndedReason: 'second_replacement_left', dropoutReportedAt: claim.reportedAt }
            : { status: 'dropped_out', dropoutReportedAt: claim.reportedAt },
        });
        if (moved.count !== 1) {
          throw new ConflictException('This placement is no longer active; the claim cannot be accepted');
        }

        if (lastReplacement) {
          if (claim.placementId !== rootId) {
            await tx.placement.update({
              where: { id: rootId },
              data: {
                status: 'guarantee_ended',
                guaranteeEndedReason: 'second_replacement_left',
              },
            });
          }
          await recordStatusChange(tx, {
            subjectType: 'placement',
            subjectId: rootId,
            fromStatus: rootPlacement.status,
            toStatus: 'guarantee_ended',
            changedByStaffId: actor.id,
            reason: 'second_replacement_left',
          });
        } else {
          await recordStatusChange(tx, {
            subjectType: 'placement',
            subjectId: claim.placementId,
            fromStatus: claim.placement.status,
            toStatus: 'dropped_out',
            changedByStaffId: actor.id,
          });

          const origVacancy =
            claim.placement.vacancy ??
            (await tx.vacancy.findUniqueOrThrow({
              where: { id: claim.placement.vacancyId },
            }));
          const replacementVacancyCode = await this.idService.generateCode('vacancy');
          await tx.vacancy.create({
            data: {
              code: replacementVacancyCode,
              city: origVacancy.city,
              businessId: origVacancy.businessId,
              capturedByStaffId: origVacancy.capturedByStaffId,
              replacementForPlacementId: claim.placementId,
              tradeSkill: origVacancy.tradeSkill,
              roleTitle: origVacancy.roleTitle,
              salaryMinPaise: origVacancy.salaryMinPaise,
              salaryMaxPaise: origVacancy.salaryMaxPaise,
              salaryPeriod: origVacancy.salaryPeriod,
              headcount: 1,
              description: origVacancy.description,
              locality: origVacancy.locality,
              latitude: origVacancy.latitude,
              longitude: origVacancy.longitude,
              shift: origVacancy.shift,
              weeklyOff: origVacancy.weeklyOff,
              workingHours: origVacancy.workingHours,
              extras: origVacancy.extras ?? [],
              experienceRequiredYears: origVacancy.experienceRequiredYears,
              educationRequired: origVacancy.educationRequired,
              languagesRequired: origVacancy.languagesRequired ?? [],
              licencesRequired: origVacancy.licencesRequired ?? [],
              ageMin: origVacancy.ageMin,
              ageMax: origVacancy.ageMax,
              genderRequirement: origVacancy.genderRequirement,
              genderReason: origVacancy.genderReason,
              startDate: origVacancy.startDate,
              urgency: origVacancy.urgency,
              probationDays: origVacancy.probationDays,
              interviewType: origVacancy.interviewType,
              interviewContactName: origVacancy.interviewContactName,
              capturedChannel: origVacancy.capturedChannel,
              status: 'open',
            },
          });
        }
      } else if (
        dto.decision === 'rejected' &&
        isOverrule &&
        claim.decision === 'accepted' &&
        claim.placement.status === 'dropped_out' &&
        claim.placement.dropoutReportedAt?.getTime() === claim.reportedAt.getTime()
      ) {
        // Overruling an acceptance puts the placement back only when this
        // claim is the one that dropped it out.
        const back = await tx.placement.updateMany({
          where: { id: claim.placementId, status: 'dropped_out', dropoutReportedAt: claim.reportedAt },
          data: { status: 'active', dropoutReportedAt: null },
        });
        if (back.count === 1) await recordStatusChange(tx, {
          subjectType: 'placement',
          subjectId: claim.placementId,
          fromStatus: 'dropped_out',
          toStatus: 'active',
          changedByStaffId: actor.id,
        });
      }

      return updated;
    });

    await this.auditService.log({
      action: isOverrule ? 'replacement_claim_overruled' : 'replacement_claim_decided',
      entityType: 'ReplacementClaim',
      entityCode: updatedClaim.code,
      actorId: actor.id,
      city: claim.placement.city,
      before,
      after: {
        decision: updatedClaim.decision,
        decisionReason: updatedClaim.decisionReason,
        decidedByStaffId: updatedClaim.decidedByStaffId,
        overruledByStaffId: updatedClaim.overruledByStaffId,
        overruleReason: updatedClaim.overruleReason,
      },
    });

    return updatedClaim;
  }

  /** A placement's claims. Agents and Team Leads see only placements in their GET /placements scope (404 outside). */
  async listClaims(placementIdOrCode: string, actor?: { id: string; role: string }) {
    const placement = await this.prisma.placement.findFirst({
      where: { OR: [{ id: placementIdOrCode }, { code: placementIdOrCode }] },
    });
    if (!placement) throw new NotFoundException(`Placement '${placementIdOrCode}' not found`);
    if (actor && ['call_agent', 'field_agent', 'team_lead'].includes(actor.role)) {
      const scope = await this.placementListScope(actor);
      const visible = await this.prisma.placement.findFirst({ where: { AND: [scope, { id: placement.id }] }, select: { id: true } });
      if (!visible) throw new NotFoundException(`Placement '${placementIdOrCode}' not found`);
    }

    return this.prisma.replacementClaim.findMany({
      where: { placementId: placement.id },
      include: {
        callRecord: true,
        exitCallRecord: true,
        decidedByStaff: { select: { id: true, code: true, name: true, role: true } },
        overruledByStaff: { select: { id: true, code: true, name: true, role: true } },
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  async checkOverdueClaims(now = new Date()): Promise<number> {
    const overdueClaims = await this.prisma.replacementClaim.findMany({
      where: {
        decision: null,
        decisionDueAt: { lte: now },
      },
      include: {
        placement: true,
      },
    });

    let raisedCount = 0;
    const manager = await this.prisma.staff.findFirst({
      where: { role: 'manager', status: 'active' },
    });

    for (const claim of overdueClaims) {
      const existing = await this.prisma.reviewFlag.findFirst({
        where: {
          kind: 'claim_decision_overdue',
          subjectType: 'replacement_claim',
          subjectId: claim.id,
          status: 'open',
        },
      });

      if (!existing) {
        await this.reviewFlags.raise({
          kind: 'claim_decision_overdue',
          subjectType: 'replacement_claim',
          subjectId: claim.id,
          raisedForStaffId: manager?.id ?? null,
          details: {
            claimCode: claim.code,
            placementId: claim.placementId,
            decisionDueAt: claim.decisionDueAt.toISOString(),
          },
        });
        raisedCount++;
      }
    }

    return raisedCount;
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
    const claim = await this.prisma.replacementClaim.findFirst({
      where: {
        placementId: placement.id,
        decision: 'accepted',
      },
      orderBy: { decidedAt: 'desc' },
    });
    // The 15-day replacement clock starts at the dropout report, not the claim decision.
    const startDate = claim?.reportedAt ?? placement.dropoutReportedAt ?? claim?.decidedAt;
    if (!startDate) {
      return 0;
    }
    const effectiveNow = asOf ?? new Date();
    const diffMs = Math.max(0, effectiveNow.getTime() - startDate.getTime());
    return Math.floor(diffMs / (1000 * 60 * 60 * 24));
  }

  async findAll(actorId: string) {
    const actor = await this.prisma.staff.findUnique({
      where: { id: actorId },
    });
    if (!actor) {
      throw new NotFoundException(`Staff '${actorId}' not found`);
    }

    const where = await this.placementListScope(actor);

    const placements = await this.prisma.placement.findMany({
      where,
      include: {
        business: true,
        jobSeeker: true,
        vacancy: true,
        joiningWorkerCall: true,
        joiningBusinessCall: true,
        replacementClaims: {
          include: {
            callRecord: true,
            exitCallRecord: true,
            decidedByStaff: { select: { id: true, code: true, name: true, role: true } },
          },
          orderBy: { createdAt: 'desc' },
        },
        replacementCandidates: {
          include: {
            jobSeeker: true,
          },
        },
      },
      orderBy: { createdAt: 'desc' },
    });

    if (!Array.isArray(placements)) {
      return placements;
    }

    const rootIds = Array.from(new Set(placements.map(p => p.rootPlacementId).filter((id): id is string => Boolean(id))));
    const rootPlacements = rootIds.length > 0 && typeof this.prisma.placement?.findMany === 'function'
      ? await this.prisma.placement.findMany({
          where: { id: { in: rootIds } },
          select: { id: true, code: true, joinedDate: true, guaranteeEndedReason: true, status: true },
        })
      : [];
    const rootMap = new Map(rootPlacements.map(r => [r.id, r]));

    const policy = await this.getPolicy();
    const guaranteeDays = policy.replacementWindowDays;

    return placements.map(p => {
      const root = p.rootPlacementId ? (rootMap.get(p.rootPlacementId) ?? p) : p;
      const rootJoinedDate = root?.joinedDate ?? p.joinedDate ?? null;
      let guaranteeDaysLeft: number | null = null;
      if (rootJoinedDate) {
        const elapsed = Math.floor((Date.now() - new Date(rootJoinedDate).getTime()) / (1000 * 60 * 60 * 24));
        guaranteeDaysLeft = Math.max(0, guaranteeDays - elapsed);
      }
      const claims = p.replacementClaims || [];
      const openClaim = claims.find((c: { decision: string | null }) => c.decision === null) || null;
      const candidates = p.replacementCandidates || [];
      const rejectionsUsed = candidates.filter((rc: { status: string }) => rc.status === 'rejected').length;
      const row = {
        ...p,
        rootJoinedDate,
        guaranteeDaysLeft,
        openClaim,
        rejectionsUsed,
      };
      return PLACEMENT_MONEY_ROLES.has(actor.role) ? row : stripMoney(row);
    });
  }

  /**
   * Whose placements a person lists (GET /placements). The CEO, Managers and Finance:
   * all. A call or field agent: the placements they are involved in, as the account
   * agent of the business, the agent who registered the candidate or introduced him
   * for that vacancy, who proposed the interview, or who created the placement. A Team
   * Lead: the same for anyone on their team (and themselves).
   */
  /** What a person may see of placements (GET /placements; also the "Report worker left" finder). */
  async placementListScope(actor: { id: string; role: string }): Promise<Prisma.PlacementWhereInput> {
    let staffIds: string[];
    if (actor.role === 'call_agent' || actor.role === 'field_agent') {
      staffIds = [actor.id];
    } else if (actor.role === 'team_lead') {
      staffIds = await new OwnTeam(this.prisma).memberIds(actor.id);
    } else {
      return {};
    }
    const introductions = await this.prisma.candidateIntroduction.findMany({
      where: { shownByStaffId: { in: staffIds } },
      select: { vacancyId: true, jobSeekerId: true },
      distinct: ['vacancyId', 'jobSeekerId'],
      take: 5000,
    });
    return {
      OR: [
        { createdByStaffId: { in: staffIds } },
        { business: businessesOwnedBy(staffIds) },
        { jobSeeker: { registeredByStaffId: { in: staffIds } } },
        { interview: { proposedByStaffId: { in: staffIds } } },
        ...introductions.map((i) => ({ vacancyId: i.vacancyId, jobSeekerId: i.jobSeekerId })),
      ],
    };
  }

  /**
   * M2 (Master Guide rev 178): a replacement whose salary-difference request
   * (D3) is not paid within Settings' upgradePaymentCancelDays (7 by default)
   * of the selection is cancelled by the daily job; a Manager or the CEO can
   * cancel it at once ("Cancel now", with a reason). Cancelling closes the
   * payment request, reopens the replacement vacancy, frees the job seeker,
   * takes the candidate off "accepted" and never counts as a free replacement
   * (countsAsReplacement false), so the claim's replacement search — and its
   * 15-day refund check — carry on as if he had not been selected.
   */
  async cancelUnpaidUpgrades(now = new Date()): Promise<number> {
    const policy = await this.getPolicy();
    const cutoff = new Date(now.getTime() - policy.upgradePaymentCancelDays * 24 * 60 * 60 * 1000);
    const due = await this.prisma.placement.findMany({
      where: { status: 'awaiting_payment', salaryUpgradeDifferencePaise: { not: null }, rootPlacementId: { not: null }, selectedAt: { lte: cutoff } },
      select: { id: true },
    });
    let cancelled = 0;
    try {
      for (const row of due) {
        // One bad row never stops the others (logged; the next daily run tries it again).
        try {
          if (await this.cancelUpgrade(row.id, null, `Salary difference not paid within ${policy.upgradePaymentCancelDays} days of the selection`, now)) cancelled += 1;
        } catch (error) {
          this.logger.error(`Could not cancel the unpaid replacement ${row.id}: ${(error as Error).message}`);
        }
      }
    } finally {
      // M10: suspensions that ended on their date resume their claims' replacement clocks — always.
      await resumeEndedSuspensions(this.prisma, now);
    }
    return cancelled;
  }

  /** "Cancel now" (Manager / CEO, audited). */
  async cancelUpgradeNow(idOrCode: string, actorId: string, body: { reason?: unknown }, now = new Date()) {
    const actor = await this.prisma.staff.findUnique({ where: { id: actorId }, select: { id: true, role: true } });
    if (!actor) throw new NotFoundException('Staff not found');
    if (actor.role !== 'manager' && actor.role !== 'ceo') throw new ForbiddenException('Only a Manager or the CEO cancels a replacement waiting for its salary difference');
    const reason = typeof body?.reason === 'string' ? body.reason.trim() : '';
    if (reason.length < 5) throw new BadRequestException('Write the reason (at least 5 characters)');
    // The CEO: any placement. A Manager: only placements of their own tree (the people below them).
    let scope: Prisma.PlacementWhereInput = {};
    if (actor.role === 'manager') {
      const tree = [actor.id, ...((await this.reportingScope?.peopleUnder(actor.id)) ?? [])];
      scope = {
        OR: [
          { createdByStaffId: { in: tree } },
          { business: businessesOwnedBy(tree) },
          { jobSeeker: { registeredByStaffId: { in: tree } } },
          { interview: { proposedByStaffId: { in: tree } } },
        ],
      };
    }
    const placement = await this.prisma.placement.findFirst({ where: { AND: [scope, { OR: [{ id: idOrCode }, { code: idOrCode }] }] }, select: { id: true, status: true, salaryUpgradeDifferencePaise: true } });
    if (!placement) throw new NotFoundException('Placement not found');
    if (placement.status !== 'awaiting_payment' || placement.salaryUpgradeDifferencePaise === null) {
      throw new BadRequestException('Only a replacement waiting for its salary-difference payment can be cancelled here');
    }
    const done = await this.cancelUpgrade(placement.id, actor.id, reason.slice(0, 500), now);
    if (!done) throw new ConflictException('This replacement is no longer waiting for its payment');
    return { cancelled: true, placementId: placement.id };
  }

  private async cancelUpgrade(placementId: string, actorId: string | null, reason: string, now: Date): Promise<boolean> {
    const placement = await this.prisma.placement.findUnique({
      where: { id: placementId },
      include: { business: { select: { id: true, name: true, phone: true, city: true } }, jobSeeker: { select: { id: true, status: true } } },
    });
    if (!placement) return false;
    const done = await this.prisma.$transaction(async (tx) => {
      // Lock order (C1): the placement row first, then its payment — as PaymentService.onPaymentSucceeded.
      if (tx.$queryRaw) await tx.$queryRaw(Prisma.sql`SELECT "id" FROM "Placement" WHERE "id" = ${placement.id} FOR UPDATE`);
      const changed = await tx.placement.updateMany({
        where: { id: placement.id, status: 'awaiting_payment' },
        data: { status: 'cancelled', countsAsReplacement: false, paymentDueAt: null },
      });
      if (changed.count !== 1) return false;
      await recordStatusChange(tx, { subjectType: 'placement', subjectId: placement.id, fromStatus: 'awaiting_payment', toStatus: 'cancelled', changedByStaffId: actorId, reason: 'replacement_upgrade_not_paid', changedAt: now });
      // The payment request closes: a late payment is not taken as this fee.
      const open = await tx.payment.findMany({ where: { placementId: placement.id, type: 'replacement_upgrade', status: 'pending' }, select: { id: true } });
      if (open.length) {
        await tx.payment.updateMany({ where: { id: { in: open.map((p) => p.id) }, status: 'pending' }, data: { status: 'failed' } });
        for (const p of open) await recordStatusChange(tx, { subjectType: 'payment', subjectId: p.id, fromStatus: 'pending', toStatus: 'failed', changedByStaffId: actorId, reason: 'replacement_upgrade_cancelled', changedAt: now });
      }
      // The replacement search goes on: the vacancy reopens and the candidate is no longer "accepted".
      await tx.vacancy.updateMany({ where: { id: placement.vacancyId, status: 'filled' }, data: { status: 'open' } });
      if (placement.interviewId) {
        await tx.replacementCandidate.updateMany({ where: { interviewId: placement.interviewId, status: 'accepted' }, data: { status: 'cancelled' } });
      }
      // He goes back to the available pool (he was never placed by an unpaid upgrade; an older record may
      // say so) — unless another placement of his is confirmed or running (H3).
      const elsewhere = placement.jobSeeker?.status === 'placed'
        ? await tx.placement.count({ where: { jobSeekerId: placement.jobSeekerId, id: { not: placement.id }, status: { in: ['confirmed', 'active'] } } })
        : 0;
      if (placement.jobSeeker?.status === 'placed' && elsewhere === 0) {
        await tx.jobSeeker.update({ where: { id: placement.jobSeekerId }, data: { status: 'active' } });
        await recordStatusChange(tx, { subjectType: 'job_seeker', subjectId: placement.jobSeekerId, fromStatus: 'placed', toStatus: 'active', changedByStaffId: actorId, reason: 'replacement_upgrade_cancelled', changedAt: now });
      }
      return true;
    });
    if (!done) return false;
    const auditActor = actorId ?? (await this.prisma.staff.findFirst({ where: { role: 'ceo' }, select: { id: true } }))?.id ?? null;
    if (auditActor) {
      await this.auditService.log({
        actorId: auditActor,
        action: 'placement.replacement_upgrade_cancelled',
        entityType: 'Placement',
        entityCode: placement.code,
        city: placement.city,
        before: { status: 'awaiting_payment', countsAsReplacement: placement.countsAsReplacement },
        after: { status: 'cancelled', countsAsReplacement: false, automatic: actorId === null },
        reason,
      });
    }
    // The business and the selected job seeker hear it in the app and by SMS.
    await this.customerNotifications?.notify({ businessId: placement.businessId }, 'replacement_cancelled', {}, { dedupeKey: `replacement_cancelled:${placement.id}` }).catch(() => undefined);
    await this.customerNotifications?.notify({ jobSeekerId: placement.jobSeekerId }, 'selection_cancelled', {}, { dedupeKey: `selection_cancelled:${placement.id}` }).catch(() => undefined);
    await this.messaging?.send({
      channel: 'sms', template: 'replacement_upgrade_cancelled', subjectType: 'business', subjectId: placement.businessId,
      relatedType: 'placement', relatedId: placement.id, variables: { businessName: placement.business?.name ?? '' },
    }).catch(() => undefined);
    await this.messaging?.send({
      channel: 'sms', template: 'selection_cancelled', subjectType: 'job_seeker', subjectId: placement.jobSeekerId,
      relatedType: 'placement', relatedId: placement.id, variables: {},
    }).catch(() => undefined);
    return true;
  }

  /**
   * M10: claims whose 15-day replacement clock stands still because the
   * business is suspended for good (Manager / CEO list).
   */
  async suspendedBusinessClaims(now = new Date()) {
    const claims = await this.prisma.replacementClaim.findMany({
      // Only searches still open: no replacement accepted, guarantee not ended.
      where: { searchPausedAt: { not: null }, placement: { guaranteeEndedReason: null, replacementCandidates: { none: { status: 'accepted' } }, business: { suspendedAt: { not: null }, suspendedUntil: null } } },
      select: {
        id: true, code: true, reportedAt: true, decision: true, searchPausedAt: true, searchPausedSeconds: true,
        placement: { select: { id: true, code: true, business: { select: { id: true, code: true, name: true, suspendedAt: true, suspendedUntil: true, suspensionReason: true } } } },
      },
      orderBy: { searchPausedAt: 'asc' },
    });
    return claims.map((c) => ({
      claimId: c.id,
      claimCode: c.code,
      decision: c.decision,
      reportedAt: c.reportedAt,
      pausedSince: c.searchPausedAt,
      pausedDays: Math.floor(claimPausedMs(c, c.placement.business, now) / (24 * 60 * 60 * 1000)),
      placement: { id: c.placement.id, code: c.placement.code },
      business: { id: c.placement.business.id, code: c.placement.business.code, name: c.placement.business.name, suspendedAt: c.placement.business.suspendedAt, reason: c.placement.business.suspensionReason },
    }));
  }

  async listPendingClaims(actorId: string) {
    const actor = await this.prisma.staff.findUnique({
      where: { id: actorId },
    });
    if (!actor) {
      throw new NotFoundException(`Staff '${actorId}' not found`);
    }

    const where: Record<string, unknown> = {
      decision: null,
    };

    if (actor.role === 'team_lead') {
      // The business's team decides (businessOwners: account agent, else lead creator).
      where.placement = { business: businessesOwnedBy(await new OwnTeam(this.prisma).memberIds(actor.id)) };
    }

    return this.prisma.replacementClaim.findMany({
      where,
      include: {
        placement: {
          include: {
            business: true,
            jobSeeker: true,
            vacancy: true,
          },
        },
        callRecord: true,
        exitCallRecord: true,
      },
      orderBy: { decisionDueAt: 'asc' },
    });
  }

  async findById(id: string, actorId: string) {
    const actor = await this.prisma.staff.findUnique({
      where: { id: actorId },
    });
    if (!actor) {
      throw new NotFoundException(`Staff '${actorId}' not found`);
    }

    // The same who-can-see rule as the list: out of scope answers 404, as if it did not exist.
    const scope = await this.placementListScope(actor);
    const placement = await this.prisma.placement.findFirst({
      where: {
        AND: [{ OR: [{ id }, { code: id }] }, scope],
      },
      include: {
        business: true,
        jobSeeker: true,
        vacancy: true,
        joiningWorkerCall: true,
        joiningBusinessCall: true,
        replacementClaims: {
          include: {
            callRecord: true,
            exitCallRecord: true,
            decidedByStaff: { select: { id: true, code: true, name: true, role: true } },
          },
          orderBy: { createdAt: 'desc' },
        },
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

    // Company money (fee, GST) only for the CEO and Finance; agents use the fee calculator.
    return PLACEMENT_MONEY_ROLES.has(actor.role) ? placement : stripMoney(placement);
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

    if (!['ceo', 'finance'].includes(actor.role)) {
      throw new ForbiddenException(
        `Role '${actor.role}' cannot approve placement refunds; requires ceo or finance`,
      );
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

    const rootId = placement.rootPlacementId ?? placement.id;
    const rootPlacement = placement.rootPlacementId
      ? await this.prisma.placement.findUniqueOrThrow({
          where: { id: rootId },
          include: { replacementCandidates: true },
        })
      : placement;

    // A caller's asOf stands in for the clock only in tests; production uses the server clock.
    const now = decisionTime(dto?.asOf);

    const goodwill = dto?.goodwill === true;
    const note = typeof dto?.reason === 'string' && dto.reason.trim() ? dto.reason.trim() : null;
    if (goodwill && !note) {
      throw new BadRequestException('A refund outside the rules (goodwill) needs a written reason');
    }

    const selectedReplacement = await this.prisma.placement.findFirst({
      where: {
        rootPlacementId: rootId,
        replacementNumber: { gt: 0 },
        // M6: a replacement waiting for its salary-difference payment is selected too (no refund meanwhile).
        status: { in: ['awaiting_payment', 'confirmed', 'active', 'completed'] },
      },
    });
    const hasAcceptedReplacement = Boolean(
      selectedReplacement ||
        placement.replacementCandidates.some((rc) => rc.status === 'accepted') ||
        rootPlacement.replacementCandidates?.some((rc) => rc.status === 'accepted'),
    );

    // A payout the bank refused is retried, never made again, so it still counts.
    const existingRefundWhere = {
      placementId: { in: [placement.id, rootId] },
      type: 'refund',
      status: { in: [...LIVE_PAYOUT_STATUSES] },
    };
    const existingRefund = await this.prisma.payment.findFirst({ where: existingRefundWhere });
    const refundWithCeo =
      existingRefund && existingRefund.status === 'pending' && existingRefund.ceoApprovalReason
        ? existingRefund
        : null;

    if (refundWithCeo && actor.role !== 'ceo') {
      throw new ForbiddenException({
        statusCode: 403,
        error: 'Forbidden',
        code: 'refund_with_ceo',
        message: `Refund ${refundWithCeo.code} is already with the CEO for approval.`,
        paymentId: refundWithCeo.id,
        paymentCode: refundWithCeo.code,
      });
    }

    // Once the CEO has turned a refund down, Finance cannot approve one for the same
    // placement on its own; only the CEO decides from then on.
    if (actor.role !== 'ceo' && !refundWithCeo) {
      const rejectedByCeo = await this.prisma.payment.findFirst({
        where: { placementId: { in: [placement.id, rootId] }, type: 'refund', status: 'rejected' },
      });
      if (rejectedByCeo && dto?.sendToCeo !== true) {
        throw new ForbiddenException({
          statusCode: 403,
          error: 'Forbidden',
          code: 'refund_rejected_by_ceo',
          message: `The CEO rejected refund ${rejectedByCeo.code} for this placement. Only the CEO can approve a refund for it now; send it to the CEO.`,
          paymentId: rejectedByCeo.id,
          paymentCode: rejectedByCeo.code,
        });
      }
    }

    // R4: say so first when this placement's refund was rejected (checked again under the lock below).
    if (!refundWithCeo) {
      assertRejectionOverride(await findRefundRejection(this.prisma, { placementId: rootId }), actor, { overrideRejection: dto?.overrideRejection, reason: note });
    }

    const claim = await this.prisma.replacementClaim.findFirst({
      where: {
        placement: { OR: [{ id: rootId }, { rootPlacementId: rootId }] },
        decision: 'accepted',
      },
      orderBy: { decidedAt: 'desc' },
    });

    // Guide: "No replacement within 15 days of the dropout report" — the clock starts
    // when the dropout was reported, not when the claim was decided.
    const claimAcceptedAt = claim?.decidedAt ?? null;
    const dropoutReportedAt = claim?.reportedAt ?? placement.dropoutReportedAt;

    const policy = await this.getPolicy();
    const outsideRules = refundWithCeo ? refundWithCeo.outsideRules : goodwill;
    let refundAmount: number;
    let daysElapsed = 0;
    // M4 (rev 178): 100% means the first fee and every salary difference paid in the chain.
    const chain = await chainRefundOf(this.prisma, rootId);
    const chainFeePaise = chain.feePaise || rootPlacement.placementFee;
    // Saved on the refund (review M1): the credit notes and FN-Refund read the parts, never a single row's fee.
    const refundParts = (chain.parts.length ? chain.parts : [{ placementId: rootId, kind: 'placement_fee', feePaise: rootPlacement.placementFee, gstPaise: rootPlacement.gstAmount }]) as unknown as Prisma.InputJsonValue;

    if (outsideRules) {
      // A goodwill refund skips the guarantee rules, so check the basics here: the fee
      // was paid, nothing has been refunded already, and the amount is within the fee.
      if (existingRefund && !refundWithCeo) {
        throw new BadRequestException(`A refund has already been issued for placement '${rootPlacement.code}'`);
      }
      if (!rootPlacement.paidAt) {
        throw new BadRequestException(`The placement fee for '${rootPlacement.code}' has not been paid, so nothing can be refunded`);
      }
      refundAmount = refundWithCeo
        ? refundWithCeo.amount
        : dto?.amountPaise ?? chainFeePaise;
      if (!Number.isSafeInteger(refundAmount) || refundAmount <= 0 || refundAmount > chainFeePaise) {
        throw new BadRequestException(
          `amountPaise must be a whole number of paise between 1 and the placement fee (${chainFeePaise})`,
        );
      }
    } else {
      const eligibilityResult = evaluatePlacementRefundEligibility(
        {
          code: rootPlacement.code,
          status: placement.status,
          hasAcceptedReplacement,
          hasSelectedReplacement: Boolean(selectedReplacement),
          claimAcceptedAt,
          dropoutReportedAt,
          placementFee: chainFeePaise,
          hasExistingRefund: Boolean(existingRefund) && !refundWithCeo,
          searchDays: policy.replacementSearchDays,
          guaranteeEndedReason: rootPlacement.guaranteeEndedReason,
          // M10: the clock stands still while the business is suspended.
          ...claimRefundPause(claim, placement.business, now),
        },
        now,
      );

      if (!eligibilityResult.eligible) {
        throw new BadRequestException(eligibilityResult.ineligibleReason!);
      }
      refundAmount = eligibilityResult.amountPaise;
      daysElapsed = eligibilityResult.daysElapsed;
    }

    const limitPaise = policy.financeBusinessRefundLimitPaise;
    const ceoReason = refundWithCeo
      ? null
      : businessRefundNeedsCeo({
          actorRole: actor.role,
          amountPaise: refundAmount,
          limitPaise,
          outsideRules,
          sendToCeo: dto?.sendToCeo === true,
        });

    // H2: a double tap or a retry creates one refund. The lock on the root placement
    // makes a second request wait, then find the first refund and stop; the partial
    // unique index on placementId refuses a second live refund in any case.
    const refundLock = refundLockKey.placement(rootId);
    const refundWhat = `A refund for placement ${rootPlacement.code}`;
    const duplicateRefund = async (error: unknown): Promise<never> => {
      if (isDuplicatePayout(error)) {
        throw alreadyExists(refundWhat, await this.prisma.payment.findFirst({ where: existingRefundWhere }));
      }
      throw error;
    };

    if (ceoReason) {
      const sentCode = await this.idService.generateCode('payment');
      const sent = await this.prisma.$transaction(async (tx) => {
        await lockSubject(tx, refundLock);
        const again = await tx.payment.findFirst({ where: existingRefundWhere });
        if (again) throw alreadyExists(refundWhat, again);
        assertRejectionOverride(await findRefundRejection(tx, { placementId: rootId }), actor, { overrideRejection: dto?.overrideRejection, reason: note });
        const p = await tx.payment.create({
          data: {
            code: sentCode,
            city: placement.city,
            type: 'refund',
            amount: refundAmount,
            status: 'pending',
            gatewayReference: null,
            subjectType: 'placement',
            subjectId: placement.id,
            placementId: placement.id,
            businessId: placement.businessId,
            ceoApprovalReason: ceoReason,
            sentToCeoByStaffId: actor.id,
            sentToCeoAt: now,
            outsideRules,
            approvalNote: note,
            refundParts,
          },
        });
        await recordStatusChange(tx, {
          subjectType: 'payment',
          subjectId: p.id,
          fromStatus: null,
          toStatus: 'pending',
          changedByStaffId: actor.id,
          reason: `refund_sent_to_ceo_${ceoReason}`,
        });
        return p;
      }).catch(duplicateRefund);

      await this.auditService.log({
        action: 'refund_sent_to_ceo',
        entityType: 'Placement',
        entityCode: rootPlacement.code,
        actorId: actor.id,
        city: placement.city,
        after: {
          paymentId: sent.id,
          paymentCode: sent.code,
          amount: sent.amount,
          ceoApprovalReason: ceoReason,
          financeLimitPaise: limitPaise,
          outsideRules,
          sentToCeoByStaffId: actor.id,
        },
        reason: note ?? undefined,
      });

      const message = ceoApprovalMessage(ceoReason, refundAmount, limitPaise, sent.code);
      if (ceoReason === 'sent_by_finance') {
        return { ...sent, message };
      }
      throw new ForbiddenException({
        statusCode: 403,
        error: 'Forbidden',
        code: 'refund_sent_to_ceo',
        message,
        ceoApprovalReason: ceoReason,
        paymentId: sent.id,
        paymentCode: sent.code,
      });
    }

    const paymentCode = refundWithCeo ? refundWithCeo.code : await this.idService.generateCode('payment');
    const payment = await this.prisma.$transaction(async (tx) => {
      let p;
      if (!refundWithCeo) {
        await lockSubject(tx, refundLock);
        const again = await tx.payment.findFirst({ where: existingRefundWhere });
        if (again) throw alreadyExists(refundWhat, again);
        // R4: a refund rejected for this placement is raised again only by the CEO, overriding with a reason.
        assertRejectionOverride(await findRefundRejection(tx, { placementId: rootId }), actor, { overrideRejection: dto?.overrideRejection, reason: note });
      }
      if (refundWithCeo) {
        const claimed = await tx.payment.updateMany({
          where: { id: refundWithCeo.id, status: 'pending' },
          data: { status: 'approved', approvedByStaffId: actor.id, approvedAt: now },
        });
        if (claimed.count !== 1) {
          throw new BadRequestException(`Refund ${refundWithCeo.code} has already been decided`);
        }
        p = await tx.payment.findUniqueOrThrow({ where: { id: refundWithCeo.id } });
      } else {
        p = await tx.payment.create({
          data: {
            code: paymentCode,
            city: placement.city,
            type: 'refund',
            amount: refundAmount,
            status: 'approved',
            approvedByStaffId: actor.id,
            approvedAt: now,
            gatewayReference: null,
            subjectType: 'placement',
            subjectId: placement.id,
            placementId: placement.id,
            businessId: placement.businessId,
            outsideRules,
            approvalNote: note,
            refundParts,
          },
        });
      }

      await recordStatusChange(tx, {
        subjectType: 'payment',
        subjectId: p.id,
        fromStatus: refundWithCeo ? 'pending' : null,
        toStatus: 'approved',
        changedByStaffId: actor.id,
        reason: outsideRules ? 'goodwill_refund_approved_by_ceo' : 'placement_guarantee_refund',
      });

      // A refund under the guarantee rules ends the guarantee. A goodwill refund is a
      // CEO decision outside the rules and leaves the placement as it is.
      if (!outsideRules) {
        await tx.placement.update({
          where: { id: rootId },
          data: {
            status: 'guarantee_ended',
            guaranteeEndedReason: 'refunded',
          },
        });

        if (placement.id !== rootId) {
          await tx.placement.update({
            where: { id: placement.id },
            data: {
              status: 'guarantee_ended',
              guaranteeEndedReason: 'refunded',
            },
          });
        }

        await recordStatusChange(tx, {
          subjectType: 'placement',
          subjectId: rootId,
          fromStatus: rootPlacement.status,
          toStatus: 'guarantee_ended',
          changedByStaffId: actor.id,
          reason: 'refunded',
        });
      }

      return p;
    }).catch(duplicateRefund);

    await this.auditService.log({
      action: 'refund_approved',
      entityType: 'Placement',
      entityCode: rootPlacement.code,
      actorId: actor.id,
      city: placement.city,
      before: {
        status: placement.status,
        guaranteeEndedReason: rootPlacement.guaranteeEndedReason,
      },
      after: {
        paymentId: payment.id,
        paymentCode: payment.code,
        amount: payment.amount,
        type: 'refund',
        reason: note ?? '60-day replacement guarantee cash refund',
        daysElapsed,
        guaranteeEndedReason: outsideRules ? rootPlacement.guaranteeEndedReason : 'refunded',
        approvedByStaffId: actor.id,
        approvedByRole: actor.role,
        financeLimitPaise: limitPaise,
        outsideRules,
        ceoApprovalReason: refundWithCeo?.ceoApprovalReason ?? null,
        sentToCeoByStaffId: refundWithCeo?.sentToCeoByStaffId ?? null,
      },
    });

    // Phase 18 Task 4: When a refund becomes owed and the receiver has no account, send link
    if (this.paymentService?.sendPayoutDetailsLinkIfNoAccount) {
      await this.paymentService.sendPayoutDetailsLinkIfNoAccount(
        'business',
        placement.businessId,
        actor.id,
        actor.role,
        now,
      );
    }

    return payment;
  }

  async getInvoice(id: string, actorId: string): Promise<GstInvoiceResponse> {
    const actor = await this.prisma.staff.findUnique({
      where: { id: actorId },
    });
    if (!actor) {
      throw new NotFoundException(`Staff '${actorId}' not found`);
    }
    return this.buildInvoice(id, actor.id);
  }

  /**
   * The business's own copy, opened from the signed link sent after it paid
   * (invoice-link.ts). Same invoice as staff see; the token was checked by the caller.
   */
  async getInvoiceForBusiness(id: string): Promise<GstInvoiceResponse> {
    return this.buildInvoice(id, 'system');
  }

  private async buildInvoice(id: string, actorId: string): Promise<GstInvoiceResponse> {
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
        actorId,
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

    const { cgstRatePercent, sgstRatePercent, cgstAmountPaise, sgstAmountPaise } = invoiceGstSplit(totalTaxPaise, gstPercent);

    // Company details come from Settings (entered by the CEO). Environment values are
    // only a fallback, used when the Settings value is empty.
    const supplier: InvoiceSupplier = {
      legalName: policy.companyLegalName?.trim() || process.env.COMPANY_LEGAL_NAME?.trim() || 'Laboura Private Limited',
      gstin: policy.companyGstin?.trim() || process.env.COMPANY_GSTIN || 'GSTIN_PENDING_REGISTRATION',
      address: policy.companyAddress?.trim() || process.env.COMPANY_ADDRESS || 'Bengaluru, Karnataka, India',
      state: 'Karnataka',
      stateCode: '29',
    };

    const customer: InvoiceCustomer = {
      businessId: placement.business.id,
      businessCode: placement.business.code,
      businessName: placement.business.name,
      contactName: placement.business.ownerName || placement.business.additionalContactName || null,
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
      // D17 (rev 176): the candidate's phone is never on the business's invoice (masked until the joining day).
      tradeSkill: placement.vacancy.tradeSkill,
      monthlySalaryPaise: placement.agreedSalary,
      joinedDate: placement.joinedDate ? placement.joinedDate.toISOString() : null,
    };

    // The invoice is dated on the day the fee was paid (the bank-confirmed payment),
    // not the joining date.
    const feePayment = (placement.payments ?? [])
      .filter((p) => p.type === 'placement_fee' && ['succeeded', 'completed'].includes(p.status) && p.confirmedAt)
      .sort((a, b) => a.confirmedAt!.getTime() - b.confirmedAt!.getTime())[0];
    const invoiceDate = (feePayment?.confirmedAt ?? placement.paidAt ?? placement.updatedAt ?? new Date()).toISOString();

    return {
      invoiceNumber,
      invoiceDate,
      supplier,
      customer,
      placement: placementInfo,
      lineItems: [
        {
          itemNumber: 1,
          // D3: a replacement hired at a higher salary is invoiced for the fee on the difference only.
          description: placement.salaryUpgradeDifferencePaise
            ? `Replacement salary difference for trade: ${placement.vacancy.tradeSkill} (${feePercent}% of ${formatINR(placement.salaryUpgradeDifferencePaise)} a month more than ${formatINR(placement.replacedSalaryPaise ?? 0)})`
            : `Placement fee for trade: ${placement.vacancy.tradeSkill} (${feePercent}% of monthly salary)`,
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




