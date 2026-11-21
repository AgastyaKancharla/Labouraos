import { OwnTeam, businessOwners, businessesOwnedBy } from '../../common/rbac/own-team';
import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  Optional,
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
import { CustomerNotificationHooks } from '../customer-notification/customer-notification-hooks.service';
import { VERIFICATION_VISIT_PURPOSES } from './business.constants';
import { PricingService } from '../pricing/pricing.service';
import { isMinimumWageZone, legalMinimumFor } from '../trade/minimum-wage';
import { tradeNameKey } from '../trade/trade.service';
import { ownerVisitOtpPurpose } from '../../common/otp/bound-otp-purposes';
import { onApprovedLeave } from '../field-visit/field-handover.service';

/**
 * 21 Nov: a verification visit proven to be at the shop: GPS inside the geofence (geofenceFlag
 * false), photos from the live camera (photoLive true), a stored selfie (hash, not just a URL)
 * and no faked-GPS sign. Only then does it unlock candidates before the Team Lead's check.
 */
export function isAtShopVerification(visit: { geofenceFlag: boolean; photoLive: boolean | null; selfieHash: string | null; gpsSuspect: boolean }): boolean {
  return visit.geofenceFlag === false && visit.photoLive === true && Boolean(visit.selfieHash) && !visit.gpsSuspect;
}

/** The IST calendar day of an instant, "YYYY-MM-DD". */
function getCalendarDateKey(at: Date): string {
  const p = getCalendarPartsInTimezone(at, 'Asia/Kolkata');
  return `${p.year}-${String(p.month).padStart(2, '0')}-${String(p.day).padStart(2, '0')}`;
}

// business_signup: a business that signed up in the customer app (proposal 4.2).
const VISIT_PURPOSES = ['verification', 'revisit', 'interview_attendance', 'follow_up', 'business_signup'] as const;

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
    @Optional() private readonly customerNotifications?: CustomerNotificationHooks,
    @Optional() private readonly pricing?: PricingService,
  ) {}

  /**
   * Office staff set a business's legal minimum wage zone (rev 193): Team
   * Lead of the business's team, Manager or CEO, with a reason. The zone is
   * then kept when the address is edited. Vacancies not yet filled, closed
   * or cancelled are checked again against the new zone (belowLegalMinimum
   * and the figure); an owner-told tick already given stays as it was.
   */
  async setMinimumWageZone(businessId: string, actorId: string, zone: unknown, reason: string) {
    const trimmedReason = typeof reason === 'string' ? reason.trim() : '';
    if (!trimmedReason) throw new BadRequestException('A reason is required to change the minimum wage zone');
    const next = typeof zone === 'string' && /^[123]$/.test(zone) ? Number(zone) : zone;
    if (!isMinimumWageZone(next)) throw new BadRequestException('zone must be 1, 2 or 3');
    const actor = await this.requireReviewActor(actorId);
    const business = await this.prisma.business.findUnique({ where: { id: businessId } });
    if (!business) throw new NotFoundException(`Business '${businessId}' not found`);
    await this.assertTeamLeadOwnsBusiness(actor, business.leadCreatedByStaffId, business.accountAgentId);
    const policy = this.pricing ? await this.pricing.current() : null;
    const { updated, rechecked } = await this.prisma.$transaction(async (tx) => {
      const row = await tx.business.update({
        where: { id: businessId },
        data: { minimumWageZone: next, minimumWageZoneSource: 'staff' },
      });
      let changed = 0;
      if (policy) {
        const vacancies = await tx.vacancy.findMany({
          where: { businessId, status: { notIn: ['filled', 'closed', 'cancelled'] }, salaryMinPaise: { gt: 0 } },
          select: { id: true, tradeSkill: true, salaryMinPaise: true, salaryPeriod: true, belowLegalMinimum: true, legalMinimumPaise: true },
        });
        const trades = await tx.trade.findMany({ where: { active: true }, select: { nameKey: true, minimumWageLevel: true } });
        const levelOf = new Map(trades.map((t) => [t.nameKey, t.minimumWageLevel]));
        for (const v of vacancies) {
          const level = levelOf.get(tradeNameKey(v.tradeSkill ?? '')) ?? 'unskilled';
          const legal = legalMinimumFor(policy, next, level);
          const monthly = v.salaryPeriod === 'daily' ? v.salaryMinPaise! * policy.salaryDaysPerMonth : v.salaryMinPaise!;
          const below = monthly < legal;
          if (below === v.belowLegalMinimum && legal === v.legalMinimumPaise) continue;
          await tx.vacancy.update({ where: { id: v.id }, data: { belowLegalMinimum: below, legalMinimumPaise: legal } });
          changed += 1;
        }
      }
      return { updated: row, rechecked: changed };
    });
    await this.auditService.log({
      actorId,
      action: 'business.minimum_wage_zone_set',
      entityType: 'business',
      entityCode: business.code,
      before: { minimumWageZone: business.minimumWageZone, minimumWageZoneSource: business.minimumWageZoneSource },
      after: { minimumWageZone: next, minimumWageZoneSource: 'staff', vacanciesRechecked: rechecked },
      changedFields: ['minimumWageZone', 'minimumWageZoneSource'],
      reason: trimmedReason,
      city: business.city,
    });
    return { ...updated, vacanciesRechecked: rechecked };
  }

  async listAssignments(staffId: string, role: string) {
    const staff = await this.prisma.staff.findUnique({ where: { id: staffId } });
    if (!staff) throw new NotFoundException('Staff not found');
    let where: Prisma.VisitAssignmentWhereInput;
    if (role === 'field_agent') {
      where = { assignedStaffId: staffId, status: 'assigned' };
    } else if (role === 'team_lead') {
      const teamIds = await new OwnTeam(this.prisma).memberIds(staffId);
      // Owner rule: a business is its account agent's team's, else its lead creator's team's.
      // An app sign-up with neither belongs to the Team Lead of the suggested field agent;
      // with no suggestion either it belongs to no team (Managers and the CEO).
      where = { status: 'pending', OR: [
        { business: businessesOwnedBy(teamIds) },
        { purpose: 'business_signup', suggestedStaffId: { in: teamIds }, business: { leadCreatedByStaffId: null, accountAgentId: null } },
      ] };
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
    if (assignment.purpose === 'business_signup' && actor.role === 'team_lead') {
      // App sign-up. The business's team (businessOwners): the account agent's, else the lead
      // creator's; with neither, the suggested field agent's team; with no suggestion either it
      // is no team's (Managers and the CEO). The field agent sent is always the Team Lead's own.
      const team = new OwnTeam(this.prisma);
      const owners = businessOwners(assignment.business);
      const mine = owners.length
        ? await team.includesAny(actor.id, owners)
        : Boolean(assignment.suggestedStaffId) && (await team.includes(actor.id, assignment.suggestedStaffId));
      if (!mine) throw new ForbiddenException('Team Leads may only assign visits for their own team’s businesses');
      if (!(await team.includes(actor.id, assignedStaffId))) throw new ForbiddenException('Team Leads may only send their own field agents');
    } else {
      await this.assertTeamLeadOwnsBusiness(
        actor,
        assignment.business.leadCreatedByStaffId,
        assignment.business.accountAgentId,
      );
    }
    if (assignment.status !== 'pending') {
      throw new BadRequestException('Only pending visit assignments can be assigned');
    }
    const fieldAgent = await this.prisma.staff.findUnique({ where: { id: assignedStaffId } });
    if (!fieldAgent) throw new NotFoundException('Field agent not found');
    await this.assertTeamLeadPicksOwnAgent(actor, fieldAgent.id);
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
    // Customer app notification (Agent C): "visit booked" when the owner picked a time in the app.
    await this.customerNotifications?.visitAssigned(updated.id);
    // 21 Nov: assigning to someone on approved leave today goes ahead with a warning on the screen.
    const onLeave = await onApprovedLeave(this.prisma, [assignedStaffId], getCalendarDateKey(this.clock.now()));
    return { ...updated, assignedStaffOnLeave: onLeave.has(assignedStaffId) };
  }

  /**
   * A business that signed up in the customer app: the visit request the
   * customer app made (purpose business_signup, no field agent yet) becomes
   * its verification visit. The business moves to "visit pending" and the
   * nearest available field agent is suggested; the Team Lead confirms or
   * changes it with one tap (guide: verification visits). Never creates a
   * second request. Returns the suggested field agent, if any.
   */
  async prepareSignupVisit(assignmentId: string): Promise<string | null> {
    const assignment = await this.prisma.visitAssignment.findUnique({ where: { id: assignmentId }, include: { business: true } });
    if (!assignment || assignment.purpose !== 'business_signup' || assignment.status !== 'pending') return null;
    const business = assignment.business;
    if (business.verificationStatus === 'lead') {
      await this.prisma.$transaction(async (tx) => {
        const moved = await tx.business.updateMany({ where: { id: business.id, verificationStatus: 'lead' }, data: { verificationStatus: 'pending_visit' } });
        if (moved.count === 1) {
          await recordStatusChange(tx, {
            subjectType: 'business',
            subjectId: business.id,
            fromStatus: 'lead',
            toStatus: 'pending_visit',
            changedByStaffId: null,
            reason: 'Signed up in the Laboura app: verification visit requested',
            changedAt: this.clock.now(),
          });
        }
      });
    }
    if (assignment.suggestedStaffId) return assignment.suggestedStaffId;
    const suggestedStaffId = await this.suggestFieldAgent(business);
    if (!suggestedStaffId) return null;
    const updated = await this.prisma.visitAssignment.updateMany({
      where: { id: assignment.id, status: 'pending', suggestedStaffId: null },
      data: { suggestedStaffId },
    });
    return updated.count === 1 ? suggestedStaffId : null;
  }

  async sendOwnerOtp(businessId: string, assignmentId: string, staffId: string) {
    const assignment = await this.prisma.visitAssignment.findFirst({
      where: {
        id: assignmentId,
        businessId,
        purpose: { in: [...VERIFICATION_VISIT_PURPOSES] },
        assignedStaffId: staffId,
        status: 'assigned',
      },
      include: { business: { select: { phone: true } } },
    });
    if (!assignment) throw new ForbiddenException('Only the assigned field agent may request owner presence OTP');
    // Bound to this visit: the check (field visit or visit form) asks for the same purpose.
    const result = await this.otpService.sendBoundOtp(assignment.business.phone, ownerVisitOtpPurpose(assignment.id), staffId);
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
          purpose: { in: [...VERIFICATION_VISIT_PURPOSES] },
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
          purpose: { in: [...VERIFICATION_VISIT_PURPOSES] },
          status: 'done',
          visitId: verificationVisit.id,
        },
      });
      if (!assignment) return null;
      const agreement = await tx.businessAgreement.findFirst({ where: { businessId } });
      if (!agreement) return null;

      // 21 Nov: verified by a field agent AT THE SHOP (GPS inside the geofence, live camera photos,
      // a hashed selfie, no faked-GPS sign — the same proof as in-person onboarding): candidates can be
      // shown straight away. Anything less waits for the Team Lead's check, as before.
      // A business with no map pin cannot be checked against it: it waits for the Team Lead.
      // A pin a field agent moved himself proves nothing until a Team Lead has checked it (the
      // pin-move flag is resolved): the verification would be measured against his own pin.
      const pinMovedUnchecked = await tx.reviewFlag.findFirst({
        where: { kind: 'gps_mismatch', subjectType: 'business', subjectId: businessId, status: 'open' },
        select: { id: true },
      });
      const atShop = business.latitude !== null && business.longitude !== null && !pinMovedUnchecked && isAtShopVerification(verificationVisit);
      await tx.business.update({
        where: { id: businessId },
        data: { verificationStatus: 'pending_tl_check', fieldVerifiedAt: atShop ? this.clock.now() : null },
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
      return { business, verificationVisit, assignment, atShop };
    });
    if (!transition) return null;
    const fieldVerifiedActor = changedByStaffId ?? transition.verificationVisit.staffId;
    if (transition.atShop && fieldVerifiedActor) {
      await this.auditService.log({
        actorId: fieldVerifiedActor,
        action: 'business.field_verified',
        entityType: 'business',
        entityCode: transition.business.code,
        before: { fieldVerifiedAt: null },
        after: { fieldVerifiedAt: this.clock.now().toISOString(), verificationVisitId: transition.verificationVisit.id },
        changedFields: ['fieldVerifiedAt'],
        reason: 'Verified at the shop by the field agent (GPS, live photos, owner code, signed agreement): candidates can be shown before the Team Lead check',
        city: transition.business.city,
      });
    }

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
          purpose: { in: [...VERIFICATION_VISIT_PURPOSES] },
          assignmentId: { not: null },
          ownerOtpRequestId: { not: null },
          selfieUrl: { not: null },
        },
        orderBy: { visitedAt: 'desc' },
      });
      if (!visit?.staffId) throw new BadRequestException('A completed verification visit by a field agent is required');
      const completedAssignment = await this.prisma.visitAssignment.findFirst({
        where: { id: visit.assignmentId!, status: 'done', visitId: visit.id, purpose: { in: [...VERIFICATION_VISIT_PURPOSES] } },
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
    // A Team Lead who names a different account agent picks one from their own team (L1).
    if (accountAgentId) await this.assertTeamLeadPicksOwnAgent(actor, accountAgent.id);
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
    // Customer app notification (Agent C).
    await this.customerNotifications?.businessApproved(businessId);
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
    await this.assertTeamLeadPicksOwnAgent(actor, fieldAgent.id);
    if (fieldAgent.city !== business.city) {
      throw new BadRequestException('The account agent must work in the business city');
    }
    this.assertAvailableFieldAgent(fieldAgent, this.clock.now());

    const assignedAt = this.clock.now();
    const updated = await this.prisma.business.update({
      where: { id: businessId },
      data: { accountAgentId, accountAgentAssignedAt: assignedAt },
    });
    await this.logAccountAgentSet(business, { actorId, accountAgentId, assignedAt, action: 'business.account_agent_reassigned' });
    return updated;
  }

  /**
   * Field redesign fix S1 (Master Guide rev 192, "Fixes after the end-to-end check"):
   * when a verification visit completes and the business has no account agent, the
   * field agent who verified it becomes its account agent (the screen tells him so).
   * Set only while nobody holds it (never takes a business from another agent); the
   * Team Lead's approval later keeps him (it defaults to the verifying agent). Run
   * inside the visit's own transaction; call {@link logAccountAgentSet} after it.
   * Returns the assignment time when it was set, else null.
   */
  async takeAccountAgentAfterVerification(
    tx: Prisma.TransactionClient,
    businessId: string,
    staffId: string,
  ): Promise<Date | null> {
    const assignedAt = this.clock.now();
    const set = await tx.business.updateMany({
      where: { id: businessId, accountAgentId: null },
      data: { accountAgentId: staffId, accountAgentAssignedAt: assignedAt },
    });
    return set.count === 1 ? assignedAt : null;
  }

  /** The audit row (the account agent's history) for every change of a business's account agent. */
  async logAccountAgentSet(
    business: { code: string; city: string; accountAgentId: string | null },
    change: { actorId: string; accountAgentId: string; assignedAt: Date; action: string; reason?: string },
  ) {
    await this.auditService.log({
      actorId: change.actorId,
      action: change.action,
      entityType: 'business',
      entityCode: business.code,
      before: { accountAgentId: business.accountAgentId },
      after: { accountAgentId: change.accountAgentId, accountAgentAssignedAt: change.assignedAt.toISOString() },
      changedFields: ['accountAgentId', 'accountAgentAssignedAt'],
      ...(change.reason ? { reason: change.reason } : {}),
      city: business.city,
    });
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
    // The business's team (businessOwners): the account agent's, else the lead
    // creator's while there is no account agent (owner decision, rev 170).
    if (!(await new OwnTeam(this.prisma).ownsBusiness(actor.id, { accountAgentId, leadCreatedByStaffId }))) {
      throw new ForbiddenException('Team Leads may only review businesses from their own team');
    }
  }

  /**
   * A Team Lead gives a visit or an account only to a field agent of their own
   * team (OwnTeam), as on /team-lead/businesses/:id/move. Managers and the CEO
   * pick anyone available.
   */
  private async assertTeamLeadPicksOwnAgent(actor: Staff, staffId: string) {
    if (actor.role !== 'team_lead') return;
    if (staffId === actor.id || !(await new OwnTeam(this.prisma).includes(actor.id, staffId))) {
      throw new ForbiddenException('A Team Lead can choose only a field agent from their own team');
    }
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
