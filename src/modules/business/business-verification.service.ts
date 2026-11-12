import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma, Staff } from '@prisma/client';
import { PrismaService } from '../../common/prisma/prisma.service';
import { AuditService } from '../../common/audit/audit.service';
import { OtpService } from '../../common/otp/otp.service';
import { calculateHaversineDistanceMeters } from '../../common/geo/geo.util';
import {
  getCalendarPartsInTimezone,
  localCalendarToUtc,
} from '../../common/time/period-boundary';
import { recordStatusChange } from '../../common/status-history/status-history.helper';
import { ReviewFlagService } from '../review-flag/review-flag.service';
import { BusinessClock } from './business-clock';
import { testModeFields } from '../../common/otp/otp-test-mode';

const VISIT_PURPOSES = ['verification', 'revisit', 'interview_attendance', 'follow_up'] as const;

export interface CreateVisitAssignmentDto {
  purpose: string;
  relatedType?: string;
  relatedId?: string;
}

export interface CheckInDto {
  latitude: number;
  longitude: number;
  accuracyMeters: number;
}

@Injectable()
export class BusinessVerificationService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditService: AuditService,
    private readonly otpService: OtpService,
    private readonly reviewFlagService: ReviewFlagService,
    private readonly clock: BusinessClock,
  ) {}

  async listAssignments(staffId: string, role: string) {
    const staff = await this.prisma.staff.findUnique({ where: { id: staffId } });
    if (!staff) throw new NotFoundException('Staff not found');
    let where: Prisma.VisitAssignmentWhereInput;
    if (role === 'field_agent') {
      where = { assignedStaffId: staffId, status: 'assigned' };
    } else if (role === 'team_lead') {
      const team = await this.prisma.staff.findMany({ where: { teamLeadId: staffId }, select: { id: true } });
      const teamIds = team.map(({ id }) => id);
      where = { status: 'pending', business: { OR: [
        { leadCreatedByStaffId: { in: teamIds } },
        { accountAgentId: { in: teamIds } },
      ] } };
    } else {
      where = { status: 'pending' };
    }
    const rows = await this.prisma.visitAssignment.findMany({
      where,
      orderBy: { createdAt: 'asc' },
      include: {
        business: { select: { id: true, code: true, name: true, locality: true, documentsStatus: true, verificationStatus: true } },
        suggestedStaff: { select: { id: true, code: true, name: true } },
        assignedStaff: { select: { id: true, code: true, name: true } },
      },
    });
    return rows;
  }

  async checkIn(staffId: string, dto: CheckInDto) {
    const now = this.clock.now();
    const staff = await this.prisma.staff.findUnique({ where: { id: staffId } });
    if (!staff) throw new NotFoundException('Field agent not found');
    this.assertAvailableFieldAgent(staff, now);
    if (
      !Number.isFinite(dto.latitude) ||
      dto.latitude < -90 ||
      dto.latitude > 90 ||
      !Number.isFinite(dto.longitude) ||
      dto.longitude < -180 ||
      dto.longitude > 180 ||
      !Number.isFinite(dto.accuracyMeters) ||
      dto.accuracyMeters < 0
    ) {
      throw new BadRequestException('Valid latitude, longitude and accuracyMeters are required');
    }

    const row = await this.prisma.fieldCheckIn.create({
      data: {
        staffId,
        latitude: dto.latitude,
        longitude: dto.longitude,
        accuracyMeters: dto.accuracyMeters,
        checkedInAt: now,
      },
    });
    await this.auditService.log({
      actorId: staffId,
      action: 'field_agent.checked_in',
      entityType: 'field_check_in',
      entityCode: row.id,
      after: { checkedInAt: now.toISOString() },
      changedFields: ['latitude', 'longitude', 'accuracyMeters', 'checkedInAt'],
      reason: 'Field agent checked in for a visit',
      city: staff.city,
    });
    return { id: row.id, checkedInAt: row.checkedInAt };
  }

  async createAssignment(businessId: string, actorId: string, dto: CreateVisitAssignmentDto) {
    if (!(VISIT_PURPOSES as readonly string[]).includes(dto.purpose)) {
      throw new BadRequestException('purpose must be verification, revisit, interview_attendance or follow_up');
    }
    const actor = await this.requireReviewActor(actorId);
    const business = await this.prisma.business.findUnique({ where: { id: businessId } });
    if (!business) throw new NotFoundException(`Business '${businessId}' not found`);
    await this.assertTeamLeadOwnsBusiness(actor, business.leadCreatedByStaffId, business.accountAgentId);
    if (dto.purpose === 'verification' && business.verificationStatus !== 'lead') {
      throw new BadRequestException('A verification visit can only be assigned while the business is a lead');
    }

    const suggestedStaffId =
      dto.purpose === 'verification' ? await this.suggestFieldAgent(business) : null;
    const assignment = await this.prisma.$transaction(async (tx) => {
      const created = await tx.visitAssignment.create({
        data: {
          businessId,
          purpose: dto.purpose,
          suggestedStaffId,
          relatedType: dto.relatedType?.trim() || null,
          relatedId: dto.relatedId?.trim() || null,
          status: 'pending',
        },
        include: { suggestedStaff: { select: { id: true, code: true, name: true } } },
      });
      if (dto.purpose === 'verification') {
        await tx.business.update({
          where: { id: businessId },
          data: { verificationStatus: 'pending_visit' },
        });
        await recordStatusChange(tx, {
          subjectType: 'business',
          subjectId: businessId,
          fromStatus: business.verificationStatus,
          toStatus: 'pending_visit',
          changedByStaffId: actorId,
          reason: 'Verification visit assigned',
          changedAt: this.clock.now(),
        });
      }
      return created;
    });
    await this.auditService.log({
      actorId,
      action: 'business.visit_assignment_created',
      entityType: 'visit_assignment',
      entityCode: assignment.id,
      after: {
        businessId,
        purpose: assignment.purpose,
        suggestedStaffId: assignment.suggestedStaffId,
        status: assignment.status,
      },
      changedFields: ['purpose', 'suggestedStaffId', 'status'],
      city: business.city,
    });
    return assignment;
  }

  async createInterviewAttendanceAssignment(businessId: string, interviewId: string, actorId: string) {
    const business = await this.prisma.business.findUnique({ where: { id: businessId } });
    if (!business) throw new NotFoundException(`Business '${businessId}' not found`);
    const suggestedStaffId = await this.suggestFieldAgent(business);
    const assignment = await this.prisma.visitAssignment.create({
      data: {
        businessId,
        purpose: 'interview_attendance',
        suggestedStaffId,
        relatedType: 'interview',
        relatedId: interviewId,
        status: 'pending',
      },
    });
    await this.auditService.log({
      actorId,
      action: 'business.visit_assignment_created',
      entityType: 'visit_assignment',
      entityCode: assignment.id,
      after: { businessId, purpose: 'interview_attendance', suggestedStaffId, relatedType: 'interview', relatedId: interviewId, status: 'pending' },
      changedFields: ['purpose', 'suggestedStaffId', 'relatedType', 'relatedId', 'status'],
      city: business.city,
      reason: 'Attendance support assigned for a confirmed interview',
    });
    return assignment;
  }

  async assign(assignmentId: string, actorId: string, assignedStaffId: string) {
    if (!assignedStaffId) throw new BadRequestException('assignedStaffId is required');
    const actor = await this.requireReviewActor(actorId);
    const assignment = await this.prisma.visitAssignment.findUnique({
      where: { id: assignmentId },
      include: { business: true },
    });
    if (!assignment) throw new NotFoundException('Visit assignment not found');
    await this.assertTeamLeadOwnsBusiness(
      actor,
      assignment.business.leadCreatedByStaffId,
      assignment.business.accountAgentId,
    );
    if (assignment.status !== 'pending') {
      throw new BadRequestException('Only pending visit assignments can be assigned');
    }
    const fieldAgent = await this.prisma.staff.findUnique({ where: { id: assignedStaffId } });
    if (!fieldAgent) throw new NotFoundException('Field agent not found');
    if (fieldAgent.city !== assignment.business.city) {
      throw new BadRequestException('The assigned field agent must work in the business city');
    }
    this.assertAvailableFieldAgent(fieldAgent, this.clock.now());

    const updated = await this.prisma.visitAssignment.update({
      where: { id: assignmentId },
      data: { assignedStaffId, assignedByStaffId: actorId, status: 'assigned' },
      include: { assignedStaff: { select: { id: true, code: true, name: true } } },
    });
    await this.auditService.log({
      actorId,
      action: 'business.visit_assignment_assigned',
      entityType: 'visit_assignment',
      entityCode: assignment.id,
      before: { assignedStaffId: assignment.assignedStaffId, status: assignment.status },
      after: { assignedStaffId, assignedByStaffId: actorId, status: updated.status },
      changedFields: ['assignedStaffId', 'assignedByStaffId', 'status'],
      city: assignment.business.city,
    });
    return updated;
  }

  async sendOwnerOtp(businessId: string, assignmentId: string, staffId: string) {
    const assignment = await this.prisma.visitAssignment.findFirst({
      where: {
        id: assignmentId,
        businessId,
        purpose: 'verification',
        assignedStaffId: staffId,
        status: 'assigned',
      },
      include: { business: { select: { phone: true } } },
    });
    if (!assignment) throw new ForbiddenException('Only the assigned field agent may request owner presence OTP');
    const result = await this.otpService.sendOtp(assignment.business.phone);
    const digits = assignment.business.phone.replace(/\D/g, '');
    return { success: true, requestId: result.requestId, phone: `******${digits.slice(-4)}`, ...testModeFields(result) };
  }

  async advanceToPendingTlCheckIfReady(businessId: string, changedByStaffId?: string | null) {
    const inPerson = await this.completeInPersonOnboardingIfReady(businessId, changedByStaffId);
    if (inPerson) return inPerson;
    const transition = await this.prisma.$transaction(async (tx) => {
      const business = await tx.business.findUnique({ where: { id: businessId } });
      if (!business || business.verificationStatus !== 'pending_visit') return null;
      const verificationVisit = await tx.businessVisit.findFirst({
        where: {
          businessId,
          purpose: 'verification',
          ownerOtpRequestId: { not: null },
          selfieUrl: { not: null },
          assignmentId: { not: null },
        },
        orderBy: { visitedAt: 'desc' },
      });
      if (!verificationVisit) return null;
      const assignment = await tx.visitAssignment.findFirst({
        where: {
          id: verificationVisit.assignmentId!,
          purpose: 'verification',
          status: 'done',
          visitId: verificationVisit.id,
        },
      });
      if (!assignment) return null;
      const agreement = await tx.businessAgreement.findFirst({ where: { businessId } });
      if (!agreement) return null;

      await tx.business.update({
        where: { id: businessId },
        data: { verificationStatus: 'pending_tl_check' },
      });
      await recordStatusChange(tx, {
        subjectType: 'business',
        subjectId: businessId,
        fromStatus: 'pending_visit',
        toStatus: 'pending_tl_check',
        changedByStaffId: changedByStaffId ?? verificationVisit.staffId,
        reason: 'Verification visit completed and owner agreement signed',
        changedAt: this.clock.now(),
      });
      return { business, verificationVisit, assignment };
    });
    if (!transition) return null;

    if (transition.business.documentsStatus === 'no_documents') {
      const openFlag = await this.prisma.reviewFlag.findFirst({
        where: {
          subjectType: 'business',
          subjectId: businessId,
          kind: 'no_documents_check',
          status: 'open',
        },
      });
      if (!openFlag) {
        const flag = await this.reviewFlagService.raise({
          kind: 'no_documents_check',
          subjectType: 'business',
          subjectId: businessId,
          raisedForStaffId:
            transition.business.leadCreatedByStaffId ?? transition.verificationVisit.staffId,
          details: { verificationVisitId: transition.verificationVisit.id },
        });
        const flagActorId = changedByStaffId ?? transition.verificationVisit.staffId;
        if (flagActorId) {
          await this.auditService.log({
            actorId: flagActorId,
            action: 'business.no_documents_check_raised',
            entityType: 'review_flag',
            entityCode: flag.code,
            after: { kind: flag.kind, businessId },
            changedFields: ['kind', 'status'],
            reason: 'No-documents business reached Team Lead review',
            city: transition.business.city,
          });
        }
      }
    }

    const actorId = changedByStaffId ?? transition.verificationVisit.staffId;
    if (actorId) {
      await this.auditService.log({
        actorId,
        action: 'business.verification_visit_completed',
        entityType: 'business',
        entityCode: transition.business.code,
        before: { verificationStatus: 'pending_visit' },
        after: { verificationStatus: 'pending_tl_check', agreementId: (await this.prisma.businessAgreement.findFirst({ where: { businessId }, select: { id: true } }))?.id },
        changedFields: ['verificationStatus'],
        reason: 'Verification visit and signed agreement are complete',
        city: transition.business.city,
      });
    }
    return { verificationStatus: 'pending_tl_check' };
  }

  /**
   * Same-visit selling (Master Guide, decided 9 Nov): a business the field agent
   * registered at the shop is onboarded in person once it has
   * - the field agent's visit at registration with GPS inside the geofence and the visit photo,
   * - the storefront photo, and
   * - the agreement signed by the contact person's OTP.
   * It then moves to `pending_tl_check` with `inPersonOnboardedAt` set, so candidates
   * can be shown and interviews booked straight away; the Team Lead reviews it the
   * same day and can pause it.
   */
  private async completeInPersonOnboardingIfReady(businessId: string, changedByStaffId?: string | null) {
    const now = this.clock.now();
    const transition = await this.prisma.$transaction(async (tx) => {
      const business = await tx.business.findUnique({ where: { id: businessId } });
      if (!business || business.verificationStatus !== 'lead' || business.inPersonOnboardedAt) return null;
      if (business.leadChannel !== 'field_visit' || !business.accountAgentId) return null;
      if (business.accountAgentId !== business.leadCreatedByStaffId) return null;
      if (!business.storefrontPhotoPath) return null;
      const visit = await tx.businessVisit.findFirst({
        where: {
          businessId,
          staffId: business.accountAgentId,
          geofenceFlag: false,
          selfieUrl: { not: null },
          selfieHash: { not: null },
        },
        orderBy: { visitedAt: 'desc' },
      });
      if (!visit) return null;
      const agreement = await tx.businessAgreement.findFirst({ where: { businessId }, select: { id: true } });
      if (!agreement) return null;
      const moved = await tx.business.updateMany({
        where: { id: businessId, verificationStatus: 'lead', inPersonOnboardedAt: null },
        data: { verificationStatus: 'pending_tl_check', inPersonOnboardedAt: now },
      });
      if (moved.count !== 1) return null;
      await recordStatusChange(tx, {
        subjectType: 'business',
        subjectId: businessId,
        fromStatus: 'lead',
        toStatus: 'pending_tl_check',
        changedByStaffId: changedByStaffId ?? business.accountAgentId,
        reason: 'Onboarded in person: GPS-checked visit, storefront photo and agreement signed by OTP',
        changedAt: now,
      });
      return { business, visit, agreementId: agreement.id };
    });
    if (!transition) return null;

    const { business, visit } = transition;
    const accountAgentId = business.accountAgentId!;
    await this.reviewFlagService.raise({
      kind: 'in_person_onboarding_review',
      subjectType: 'business',
      subjectId: businessId,
      raisedForStaffId: accountAgentId,
      details: { businessCode: business.code, visitId: visit.id, agreementId: transition.agreementId },
    });
    if (business.documentsStatus === 'no_documents') {
      const openFlag = await this.prisma.reviewFlag.findFirst({
        where: { subjectType: 'business', subjectId: businessId, kind: 'no_documents_check', status: 'open' },
      });
      if (!openFlag) {
        await this.reviewFlagService.raise({
          kind: 'no_documents_check',
          subjectType: 'business',
          subjectId: businessId,
          raisedForStaffId: accountAgentId,
          details: { verificationVisitId: visit.id },
        });
      }
    }
    await this.auditService.log({
      actorId: changedByStaffId ?? accountAgentId,
      action: 'business.in_person_onboarding_completed',
      entityType: 'business',
      entityCode: business.code,
      before: { verificationStatus: 'lead', inPersonOnboardedAt: null },
      after: { verificationStatus: 'pending_tl_check', inPersonOnboardedAt: now.toISOString(), agreementId: transition.agreementId },
      changedFields: ['verificationStatus', 'inPersonOnboardedAt'],
      reason: 'Onboarded in person: candidates allowed before the Team Lead review',
      city: business.city,
    });
    return { verificationStatus: 'pending_tl_check', inPersonOnboardedAt: now };
  }

  /** A Team Lead (own team), Manager or CEO pauses a business: no matching and no new interviews. */
  async pause(businessId: string, actorId: string, reason: string) {
    const trimmedReason = reason?.trim();
    if (!trimmedReason) throw new BadRequestException('A reason is required to pause a business');
    const actor = await this.requireReviewActor(actorId);
    const business = await this.prisma.business.findUnique({ where: { id: businessId } });
    if (!business) throw new NotFoundException(`Business '${businessId}' not found`);
    await this.assertTeamLeadOwnsBusiness(actor, business.leadCreatedByStaffId, business.accountAgentId);
    if (business.pausedAt) throw new BadRequestException('This business is already paused');
    const now = this.clock.now();
    const updated = await this.prisma.business.update({
      where: { id: businessId },
      data: { pausedAt: now, pausedByStaffId: actorId, pauseReason: trimmedReason },
    });
    await this.auditService.log({
      actorId,
      action: 'business.paused',
      entityType: 'business',
      entityCode: business.code,
      before: { pausedAt: null, pausedByStaffId: null },
      after: { pausedAt: now.toISOString(), pausedByStaffId: actorId, verificationStatus: business.verificationStatus },
      changedFields: ['pausedAt', 'pausedByStaffId', 'pauseReason'],
      reason: trimmedReason,
      city: business.city,
    });
    return updated;
  }

  async unpause(businessId: string, actorId: string, reason: string) {
    const trimmedReason = reason?.trim();
    if (!trimmedReason) throw new BadRequestException('A reason is required to unpause a business');
    const actor = await this.requireReviewActor(actorId);
    const business = await this.prisma.business.findUnique({ where: { id: businessId } });
    if (!business) throw new NotFoundException(`Business '${businessId}' not found`);
    await this.assertTeamLeadOwnsBusiness(actor, business.leadCreatedByStaffId, business.accountAgentId);
    if (!business.pausedAt) throw new BadRequestException('This business is not paused');
    const updated = await this.prisma.business.update({
      where: { id: businessId },
      data: { pausedAt: null, pausedByStaffId: null, pauseReason: null },
    });
    await this.auditService.log({
      actorId,
      action: 'business.unpaused',
      entityType: 'business',
      entityCode: business.code,
      before: { pausedAt: business.pausedAt.toISOString(), pausedByStaffId: business.pausedByStaffId },
      after: { pausedAt: null, pausedByStaffId: null },
      changedFields: ['pausedAt', 'pausedByStaffId', 'pauseReason'],
      reason: trimmedReason,
      city: business.city,
    });
    return updated;
  }

  async approve(businessId: string, actorId: string, accountAgentId?: string) {
    const actor = await this.requireReviewActor(actorId);
    const business = await this.prisma.business.findUnique({ where: { id: businessId } });
    if (!business) throw new NotFoundException(`Business '${businessId}' not found`);
    await this.assertTeamLeadOwnsBusiness(actor, business.leadCreatedByStaffId, business.accountAgentId);
    if (business.verificationStatus !== 'pending_tl_check') {
      throw new BadRequestException('Business must be pending Team Lead review before approval');
    }

    if (business.documentsStatus === 'no_documents') {
      const transition = await this.prisma.statusHistory.findFirst({
        where: {
          subjectType: 'business',
          subjectId: businessId,
          toStatus: 'pending_tl_check',
        },
        orderBy: { changedAt: 'desc' },
      });
      const answeredCall = transition
        ? await this.prisma.callRecord.findFirst({
            where: {
              staffId: actorId,
              subjectType: 'business',
              subjectId: businessId,
              direction: 'outbound',
              purpose: 'verification',
              answered: true,
              startedAt: { gt: transition.changedAt },
            },
          })
        : null;
      if (!answeredCall) {
        throw new BadRequestException(
          'No-documents businesses require your answered verification call after the verification visit before approval',
        );
      }
    }

    // An in-person onboarded business already has its visit proof from registration;
    // every other business needs the assigned verification visit.
    let visitStaffId: string;
    if (business.inPersonOnboardedAt && business.accountAgentId) {
      visitStaffId = business.accountAgentId;
    } else {
      const visit = await this.prisma.businessVisit.findFirst({
        where: {
          businessId,
          purpose: 'verification',
          assignmentId: { not: null },
          ownerOtpRequestId: { not: null },
          selfieUrl: { not: null },
        },
        orderBy: { visitedAt: 'desc' },
      });
      if (!visit?.staffId) throw new BadRequestException('A completed verification visit by a field agent is required');
      const completedAssignment = await this.prisma.visitAssignment.findFirst({
        where: { id: visit.assignmentId!, status: 'done', visitId: visit.id, purpose: 'verification' },
      });
      if (!completedAssignment) {
        throw new BadRequestException('A completed verification visit by its assigned field agent is required');
      }
      visitStaffId = visit.staffId;
    }
    const agreement = await this.prisma.businessAgreement.findFirst({ where: { businessId } });
    if (!agreement) throw new BadRequestException('A signed business agreement is required before approval');
    const finalAccountAgentId = accountAgentId ?? visitStaffId;
    const accountAgent = await this.prisma.staff.findUnique({ where: { id: finalAccountAgentId } });
    if (!accountAgent) throw new NotFoundException('Account agent not found');
    if (accountAgent.city !== business.city) {
      throw new BadRequestException('The account agent must work in the business city');
    }
    this.assertAvailableFieldAgent(accountAgent, this.clock.now());

    const now = this.clock.now();
    const updated = await this.prisma.$transaction(async (tx) => {
      const row = await tx.business.update({
        where: { id: businessId },
        data: {
          verificationStatus: 'verified',
          verifiedAt: now,
          verifiedByStaffId: actorId,
          accountAgentId: finalAccountAgentId,
          accountAgentAssignedAt: now,
        },
      });
      await recordStatusChange(tx, {
        subjectType: 'business',
        subjectId: businessId,
        fromStatus: 'pending_tl_check',
        toStatus: 'verified',
        changedByStaffId: actorId,
        reason: 'Business verification approved',
        changedAt: now,
      });
      return row;
    });

    if (business.inPersonOnboardedAt) {
      const reviewFlag = await this.prisma.reviewFlag.findFirst({
        where: { subjectType: 'business', subjectId: businessId, kind: 'in_person_onboarding_review', status: 'open' },
      });
      if (reviewFlag) {
        await this.reviewFlagService.resolve(
          reviewFlag.id,
          { id: actorId, role: actor.role },
          { status: 'resolved', resolution: 'Team Lead reviewed the in-person onboarding and approved it' },
          { closedByOwnWork: true },
        );
      }
    }
    if (business.documentsStatus === 'no_documents') {
      const flag = await this.prisma.reviewFlag.findFirst({
        where: { subjectType: 'business', subjectId: businessId, kind: 'no_documents_check', status: 'open' },
      });
      if (flag) {
        await this.reviewFlagService.resolve(
          flag.id,
          { id: actorId, role: actor.role },
          { status: 'resolved', resolution: 'Business verification approved after answered verification call' },
          { closedByOwnWork: true },
        );
      }
    }
    await this.auditService.log({
      actorId,
      action: 'business.verification_approved',
      entityType: 'business',
      entityCode: business.code,
      before: {
        verificationStatus: business.verificationStatus,
        accountAgentId: business.accountAgentId,
      },
      after: {
        verificationStatus: updated.verificationStatus,
        accountAgentId: updated.accountAgentId,
        verifiedAt: now.toISOString(),
      },
      changedFields: ['verificationStatus', 'verifiedAt', 'verifiedByStaffId', 'accountAgentId', 'accountAgentAssignedAt'],
      city: business.city,
    });
    return updated;
  }

  async reject(businessId: string, actorId: string, reason: string) {
    const trimmedReason = reason?.trim();
    if (!trimmedReason) throw new BadRequestException('A reason is required to reject business verification');
    const actor = await this.requireReviewActor(actorId);
    const business = await this.prisma.business.findUnique({ where: { id: businessId } });
    if (!business) throw new NotFoundException(`Business '${businessId}' not found`);
    await this.assertTeamLeadOwnsBusiness(actor, business.leadCreatedByStaffId, business.accountAgentId);
    if (!['lead', 'pending_visit', 'pending_tl_check'].includes(business.verificationStatus ?? '')) {
      throw new BadRequestException('Business cannot be rejected from its current verification status');
    }
    const updated = await this.prisma.$transaction(async (tx) => {
      const row = await tx.business.update({
        where: { id: businessId },
        data: { verificationStatus: 'rejected' },
      });
      await recordStatusChange(tx, {
        subjectType: 'business',
        subjectId: businessId,
        fromStatus: business.verificationStatus,
        toStatus: 'rejected',
        changedByStaffId: actorId,
        reason: trimmedReason,
        changedAt: this.clock.now(),
      });
      return row;
    });
    await this.auditService.log({
      actorId,
      action: 'business.verification_rejected',
      entityType: 'business',
      entityCode: business.code,
      before: { verificationStatus: business.verificationStatus },
      after: { verificationStatus: updated.verificationStatus },
      changedFields: ['verificationStatus'],
      reason: trimmedReason,
      city: business.city,
    });
    return updated;
  }

  async reassignAccountAgent(businessId: string, actorId: string, accountAgentId: string) {
    if (!accountAgentId) throw new BadRequestException('accountAgentId is required');
    const actor = await this.requireReviewActor(actorId);
    const business = await this.prisma.business.findUnique({ where: { id: businessId } });
    if (!business) throw new NotFoundException(`Business '${businessId}' not found`);
    await this.assertTeamLeadOwnsBusiness(actor, business.leadCreatedByStaffId, business.accountAgentId);
    if (business.verificationStatus !== 'verified') {
      throw new BadRequestException('Only a verified business can have its account agent reassigned');
    }
    const fieldAgent = await this.prisma.staff.findUnique({ where: { id: accountAgentId } });
    if (!fieldAgent) throw new NotFoundException('Account agent not found');
    if (fieldAgent.city !== business.city) {
      throw new BadRequestException('The account agent must work in the business city');
    }
    this.assertAvailableFieldAgent(fieldAgent, this.clock.now());

    const assignedAt = this.clock.now();
    const updated = await this.prisma.business.update({
      where: { id: businessId },
      data: { accountAgentId, accountAgentAssignedAt: assignedAt },
    });
    await this.auditService.log({
      actorId,
      action: 'business.account_agent_reassigned',
      entityType: 'business',
      entityCode: business.code,
      before: { accountAgentId: business.accountAgentId },
      after: { accountAgentId, accountAgentAssignedAt: assignedAt.toISOString() },
      changedFields: ['accountAgentId', 'accountAgentAssignedAt'],
      city: business.city,
    });
    return updated;
  }

  private async suggestFieldAgent(business: {
    city: string;
    latitude: number | null;
    longitude: number | null;
  }): Promise<string | null> {
    if (business.latitude === null || business.longitude === null) return null;
    const now = this.clock.now();
    const parts = getCalendarPartsInTimezone(now, 'Asia/Kolkata');
    const nextDate = new Date(Date.UTC(parts.year, parts.month - 1, parts.day + 1));
    const nextParts = getCalendarPartsInTimezone(nextDate, 'Asia/Kolkata');
    const start = localCalendarToUtc(parts.year, parts.month, parts.day, 0, 0, 0, 0, 'Asia/Kolkata');
    const end = localCalendarToUtc(nextParts.year, nextParts.month, nextParts.day, 0, 0, 0, 0, 'Asia/Kolkata');
    const fieldAgents = await this.prisma.staff.findMany({
      where: {
        role: 'field_agent',
        status: 'active',
        city: business.city,
        lockedByStaffId: null,
        OR: [{ lockedUntil: null }, { lockedUntil: { lte: now } }],
        checkIns: { some: { checkedInAt: { gte: start, lt: end } } },
      },
      select: { id: true },
    });
    if (fieldAgents.length === 0) return null;
    const staffIds = fieldAgents.map(({ id }) => id);
    const [checkIns, visits] = await Promise.all([
      this.prisma.fieldCheckIn.findMany({
        where: { staffId: { in: staffIds }, checkedInAt: { gte: start, lt: end } },
        select: { staffId: true, latitude: true, longitude: true, checkedInAt: true },
      }),
      this.prisma.businessVisit.findMany({
        where: {
          staffId: { in: staffIds },
          visitedAt: { gte: start, lt: end },
          business: { city: business.city },
        },
        select: { staffId: true, latitude: true, longitude: true, visitedAt: true },
      }),
    ]);
    const latest = new Map<string, { latitude: number; longitude: number; at: Date }>();
    for (const position of [
      ...checkIns.map((row) => ({ ...row, at: row.checkedInAt })),
      ...visits.map((row) => ({ ...row, at: row.visitedAt })),
    ]) {
      if (!position.staffId) continue;
      const previous = latest.get(position.staffId);
      if (!previous || position.at > previous.at) {
        latest.set(position.staffId, {
          latitude: position.latitude,
          longitude: position.longitude,
          at: position.at,
        });
      }
    }
    return fieldAgents
      .map(({ id }) => {
        const position = latest.get(id);
        return {
          id,
          distance: position
            ? calculateHaversineDistanceMeters(
                business.latitude!,
                business.longitude!,
                position.latitude,
                position.longitude,
              )
            : Number.POSITIVE_INFINITY,
        };
      })
      .filter(({ distance }) => Number.isFinite(distance))
      .sort((a, b) => a.distance - b.distance || a.id.localeCompare(b.id))[0]?.id ?? null;
  }

  private async requireReviewActor(actorId: string): Promise<Staff> {
    const actor = await this.prisma.staff.findUnique({ where: { id: actorId } });
    if (!actor) throw new NotFoundException(`Staff '${actorId}' not found`);
    if (!['team_lead', 'manager', 'ceo'].includes(actor.role)) {
      throw new ForbiddenException('Only a Team Lead, Manager or CEO may manage business verification');
    }
    if (actor.status !== 'active' || this.isLocked(actor, this.clock.now())) {
      throw new ForbiddenException('Only active, unlocked staff may manage verification');
    }
    return actor;
  }

  private async assertTeamLeadOwnsBusiness(
    actor: Staff,
    leadCreatedByStaffId: string | null,
    accountAgentId: string | null,
  ) {
    if (actor.role !== 'team_lead') return;
    const owners = [leadCreatedByStaffId, accountAgentId].filter((id): id is string => id !== null);
    if (owners.length === 0) throw new ForbiddenException('Team Leads may only review businesses from their own team');
    const member = await this.prisma.staff.findFirst({
      where: { id: { in: owners }, teamLeadId: actor.id },
    });
    if (!member) throw new ForbiddenException('Team Leads may only review businesses from their own team');
  }

  private assertAvailableFieldAgent(staff: Staff, now: Date) {
    if (staff.role !== 'field_agent' || staff.status !== 'active' || this.isLocked(staff, now)) {
      throw new ForbiddenException('An active, unlocked field agent is required');
    }
  }

  private isLocked(staff: Staff, now: Date): boolean {
    return Boolean(staff.lockedByStaffId) || Boolean(staff.lockedUntil && staff.lockedUntil > now);
  }
}
