import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
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
import { ApprovePlacementRefundDto } from './dto/approve-refund.dto';
import { evaluatePlacementRefundEligibility } from './placement-refund-eligibility';
import { businessRefundNeedsCeo, ceoApprovalMessage } from '../../common/money/approval-limits';
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

        const previousReplacements = await tx.placement.count({
          where: { rootPlacementId: rootId, replacementNumber: { gt: 0 } },
        });
        const replacementNumber = previousReplacements + 1;
        const policy = await this.getPolicy();
        if (replacementNumber > policy.maxFreeReplacements) {
          throw new BadRequestException(
            `A third replacement is refused; maximum free replacements is ${policy.maxFreeReplacements}`,
          );
        }

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
            paymentDueAt: null,
            paidAt: now,
            joiningDate: interview.selectedJoiningDate,
            rootPlacementId: rootId,
            replacementNumber,
            feePercentAtCreation: rootPlacement.feePercentAtCreation,
            gstPercentAtCreation: rootPlacement.gstPercentAtCreation,
            agreedSalary: interview.selectedSalaryPaise,
            placementFee: 0,
            gstAmount: 0,
            status: 'confirmed',
          },
          include: { business: true, jobSeeker: true, vacancy: true, payments: true },
        });

        await recordStatusChange(tx, {
          subjectType: 'placement',
          subjectId: placement.id,
          fromStatus: null,
          toStatus: 'confirmed',
          changedByStaffId: interview.proposedByStaffId,
          changedAt: now,
          reason: 'free_replacement_selected',
        });

        // Job seeker becomes placed at selection
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
          totalAmount: 0,
          existing: false,
          isReplacement: true,
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
        action: 'placement.replacement_confirmed',
        entityType: 'Placement',
        entityCode: created.placement.code,
        actorId: created.actorId,
        city: created.placement.city,
        after: {
          status: 'confirmed',
          rootPlacementId: created.placement.rootPlacementId,
          replacementNumber: created.placement.replacementNumber,
          placementFee: 0,
          gstAmount: 0,
        },
      });
      return {
        ...created.placement,
        payment: null,
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
        if (root?.joinedDate) {
          rootJoinedDate = root.joinedDate;
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
        where: {
          placementId: placement.id,
          type: 'joining_reward',
        },
      });
      if (existing) {
        continue;
      }

      const code = await this.idService.generateCode('payment');
      const payment = await this.prisma.payment.create({
        data: {
          code,
          city: placement.city,
          type: 'joining_reward',
          amount: rewardAmount,
          status: 'pending',
          subjectType: 'job_seeker',
          subjectId: placement.jobSeekerId,
          jobSeekerId: placement.jobSeekerId,
          placementId: placement.id,
        },
      });

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

  async triggerReferralPayout(placementId: string, actorId?: string) {
    return this.paymentService.createReferralPayout(placementId, actorId);
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

    if (placement.status !== 'active') {
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

    if (!rootPlacement || !rootPlacement.joinedDate) {
      throw new BadRequestException(
        'Placement has no recorded joinedDate; cannot evaluate replacement claim',
      );
    }

    const workerLeftOn = new Date(dto.workerLeftOn);
    if (isNaN(workerLeftOn.getTime())) {
      throw new BadRequestException('Invalid workerLeftOn date');
    }

    const policy = await this.pricingService.current();
    const windowDays = policy.replacementWindowDays;
    const rootJoinedDate = rootPlacement.joinedDate;
    const guaranteeExpiry = new Date(
      rootJoinedDate.getTime() + windowDays * 24 * 60 * 60 * 1000,
    );

    if (workerLeftOn.getTime() < rootJoinedDate.getTime()) {
      throw new BadRequestException(
        `workerLeftOn cannot be earlier than joinedDate (${rootJoinedDate.toISOString()}); employee cannot leave before they started`,
      );
    }

    if (workerLeftOn.getTime() > guaranteeExpiry.getTime()) {
      throw new BadRequestException(
        `Worker left outside the ${windowDays}-day replacement guarantee window`,
      );
    }

    if (workerLeftOn.getTime() > now.getTime()) {
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

    if (!isValidClaimReason(dto.reason)) {
      throw new BadRequestException(`Invalid claim reason '${dto.reason}'`);
    }

    const reportedAt = now;
    const diffMs = reportedAt.getTime() - workerLeftOn.getTime();
    const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));
    const reportedWithinDeadline = diffDays <= policy.claimReportDays;

    const rootFeePayment = rootPlacement.payments?.find(
      (p) => p.type === 'placement_fee' && p.status === 'succeeded',
    );
    const feePaidInFull = rootPlacement.paidAt !== null || !!rootFeePayment;

    const inRejectList = isRejectClaimReason(dto.reason);

    let decision: string | null = null;
    let decisionReason: string | null = null;
    let decidedAt: Date | null = null;

    if (!reportedWithinDeadline) {
      decision = 'rejected';
      decisionReason = `Auto-rejected: Reported ${diffDays} days after worker left; deadline is ${policy.claimReportDays} days`;
      decidedAt = reportedAt;
    } else if (!feePaidInFull) {
      decision = 'rejected';
      decisionReason = 'Auto-rejected: Root placement fee is not paid in full';
      decidedAt = reportedAt;
    } else if (inRejectList) {
      decision = 'rejected';
      decisionReason = `Auto-rejected: Reason '${dto.reason}' is in the non-eligible rejection list`;
      decidedAt = reportedAt;
    }

    const decisionDueHours = policy.claimDecisionHours;
    const decisionDueAt = new Date(
      reportedAt.getTime() + decisionDueHours * 60 * 60 * 1000,
    );

    const code = await this.idService.generateCode('replacement_claim');

    const claim = await this.prisma.replacementClaim.create({
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
        decision,
        decisionReason,
        decidedByStaffId: null,
        decidedAt,
        decisionDueAt,
      },
      include: {
        placement: true,
        callRecord: true,
        exitCallRecord: true,
        decidedByStaff: true,
        overruledByStaff: true,
      },
    });

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
      const accountAgentId = claim.placement.business.accountAgentId;
      if (accountAgentId) {
        const accountAgent = await this.prisma.staff.findUnique({ where: { id: accountAgentId } });
        if (accountAgent && accountAgent.teamLeadId !== actor.id && accountAgent.id !== actor.id) {
          throw new ForbiddenException('Team Leads can only decide claims for their own team');
        }
      }
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

    const before = {
      decision: claim.decision,
      decisionReason: claim.decisionReason,
      decidedByStaffId: claim.decidedByStaffId,
      decidedAt: claim.decidedAt,
      overruledByStaffId: claim.overruledByStaffId,
      overruleReason: claim.overruleReason,
      placementStatus: claim.placement.status,
    };

    const updatedClaim = await this.prisma.$transaction(async (tx) => {
      const updateData: Prisma.ReplacementClaimUpdateInput = {
        decision: dto.decision,
        decisionReason: dto.decisionReason,
        decidedAt: now,
      };

      if (isOverrule) {
        updateData.overruledByStaff = { connect: { id: actor.id } };
        updateData.overruleReason = dto.decisionReason;
      } else {
        updateData.decidedByStaff = { connect: { id: actor.id } };
      }

      const updated = await tx.replacementClaim.update({
        where: { id: claim.id },
        data: updateData,
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

        if (claim.placement.replacementNumber >= policy.maxFreeReplacements) {
          await tx.placement.update({
            where: { id: rootId },
            data: {
              status: 'guarantee_ended',
              guaranteeEndedReason: 'second_replacement_left',
            },
          });
          if (claim.placementId !== rootId) {
            await tx.placement.update({
              where: { id: claim.placementId },
              data: {
                status: 'guarantee_ended',
                guaranteeEndedReason: 'second_replacement_left',
                dropoutReportedAt: claim.reportedAt,
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
          await tx.placement.update({
            where: { id: claim.placementId },
            data: {
              status: 'dropped_out',
              dropoutReportedAt: claim.reportedAt,
            },
          });

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
      } else if (dto.decision === 'rejected' && claim.placement.status === 'dropped_out') {
        await tx.placement.update({
          where: { id: claim.placementId },
          data: {
            status: 'active',
          },
        });

        await recordStatusChange(tx, {
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

  async listClaims(placementIdOrCode: string) {
    const placement = await this.prisma.placement.findFirst({
      where: { OR: [{ id: placementIdOrCode }, { code: placementIdOrCode }] },
    });
    if (!placement) throw new NotFoundException(`Placement '${placementIdOrCode}' not found`);

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
      return {
        ...p,
        rootJoinedDate,
        guaranteeDaysLeft,
        openClaim,
        rejectionsUsed,
      };
    });
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
      const team = await this.prisma.staff.findMany({ where: { teamLeadId: actor.id }, select: { id: true } });
      const teamIds = team.map(({ id }) => id);
      where.placement = {
        business: {
          OR: [
            { accountAgentId: { in: teamIds } },
            { leadCreatedByStaffId: { in: teamIds } },
          ],
        },
      };
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

    const placement = await this.prisma.placement.findFirst({
      where: {
        OR: [{ id }, { code: id }],
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

    let now: Date;
    if (dto?.asOf) {
      now = new Date(dto.asOf);
      if (isNaN(now.getTime())) {
        throw new BadRequestException('asOf must be a valid date string');
      }
    } else {
      now = new Date();
    }

    const goodwill = dto?.goodwill === true;
    const note = typeof dto?.reason === 'string' && dto.reason.trim() ? dto.reason.trim() : null;
    if (goodwill && !note) {
      throw new BadRequestException('A refund outside the rules (goodwill) needs a written reason');
    }

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

    const existingRefund = await this.prisma.payment.findFirst({
      where: {
        placementId: { in: [placement.id, rootId] },
        type: 'refund',
        status: { in: ['pending', 'approved', 'processing', 'completed', 'succeeded'] },
      },
    });
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
        : dto?.amountPaise ?? rootPlacement.placementFee;
      if (!Number.isSafeInteger(refundAmount) || refundAmount <= 0 || refundAmount > rootPlacement.placementFee) {
        throw new BadRequestException(
          `amountPaise must be a whole number of paise between 1 and the placement fee (${rootPlacement.placementFee})`,
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
          placementFee: rootPlacement.placementFee,
          hasExistingRefund: Boolean(existingRefund) && !refundWithCeo,
          searchDays: policy.replacementSearchDays,
          guaranteeEndedReason: rootPlacement.guaranteeEndedReason,
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

    if (ceoReason) {
      const sentCode = await this.idService.generateCode('payment');
      const sent = await this.prisma.$transaction(async (tx) => {
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
      });

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
    });

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

    // Company details come from Settings (entered by the CEO). Environment values are
    // only a fallback for the GSTIN and address until Settings has them.
    const supplier: InvoiceSupplier = {
      legalName: policy.companyLegalName?.trim() || 'Laboura Private Limited',
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
      candidatePhone: placement.jobSeeker.phone,
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




