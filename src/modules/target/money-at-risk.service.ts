import {
  ForbiddenException,
  Injectable,
  NotFoundException,
  Optional,
} from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.service';
import { JwtPayload } from '../../common/auth/jwt-payload.interface';
import { refundGuaranteeDeadline, toRupees } from '../../common/money/money';
import { calculateDaysElapsed } from '../placement/placement.service';
import { PricingService, PricingPolicy } from '../pricing/pricing.service';
import {
  CANDIDATE_AT_RISK_WINDOW_DAYS,
  PLACEMENT_AT_RISK_WINDOW_DAYS,
} from './target.constants';

export interface MoneyAtRiskRow {
  type: 'job_seeker' | 'placement';
  id: string;
  code: string;
  city: string;
  amountPaise: number;
  amountRupees: number;
  daysRemaining: number;
  deadline: string; // ISO date string
  staffId: string | null;
  staffName?: string | null;
  staffCode?: string | null;
  details: {
    name?: string;
    phone?: string;
    tradeSkill?: string;
    dropoutReportedAt?: string;
    businessName?: string;
    placementFee?: number;
    clockPaused?: boolean;
  };
}

export interface MoneyAtRiskResult {
  scope: 'agent' | 'team' | 'city';
  actorId: string;
  asOf: string;
  totalAtRiskPaise: number;
  totalAtRiskRupees: number;
  candidatesCount: number;
  candidatesAtRiskPaise: number;
  placementsCount: number;
  placementsAtRiskPaise: number;
  rows: MoneyAtRiskRow[];
}

/**
 * Money at Risk Service (Phase 6.7 Task 5)
 *
 * SPECIFICATION & ARCHITECTURAL RATIONALE:
 *
 * 1. ONE RUPEE FIGURE:
 *    `(₹499 × active candidates approaching their day-30 deadline) + (placement fee × open replacement vacancies approaching their day-15 deadline)`
 *    Stored and computed in integer paise throughout (AGENTS.md §2 rule 1).
 *
 * 2. MONEY AT RISK IS APPROACHING ONLY (CRITICAL BOUNDARY):
 *    Anything already past its deadline is already owed and belongs on `GET /refunds/due` —
 *    it is lost money, not money at risk. Money at risk strictly measures active candidates
 *    and dropped placements that are still INSIDE their guarantee windows, but approaching
 *    expiration (`now < deadline`). This guarantees a CEO or Manager never sees the same rupee
 *    counted twice across the two screens.
 *
 * 3. REUSE OF SHARED ELIGIBILITY LOGIC:
 *    Reuses the exact domain criteria from Phase 6.5 (`job-seeker-refund-eligibility.ts` and
 *    `placement-refund-eligibility.ts`):
 *    - Job Seekers: ₹499 paid, status not 'placed' or 'deactivated', no 'offer_rejected' hit,
 *      no existing refund payment.
 *    - Placements: status 'dropped_out', eligibility 'employee_left', no accepted replacement candidate,
 *      no existing refund payment, and uses `calculateDaysElapsed()` with `clockPaused` handling.
 *
 * 4. WINDOW CONSTANTS:
 *    - Candidates: approaching within 7 days (`CANDIDATE_AT_RISK_WINDOW_DAYS = 7`).
 *    - Placements: approaching within 5 days (`PLACEMENT_AT_RISK_WINDOW_DAYS = 5`).
 *
 * 5. LIVE COMPUTATION, NEVER STORED:
 *    Computed fresh on every request; never stored in columns.
 */
@Injectable()
export class MoneyAtRiskService {
  constructor(
    private readonly prisma: PrismaService,
    @Optional()
    private readonly pricingService?: PricingService,
  ) {}

  /**
   * Retrieves all money at risk scoped by caller role (agent, team, or city-wide).
   *
   * @param targetStaffId Optional filter for a specific staff member
   * @param actor Authenticated user JWT payload
   * @param now Injectable time parameter for clock mocking
   */
  async getMoneyAtRisk(
    targetStaffId?: string,
    actor?: JwtPayload,
    now: Date = new Date(),
  ): Promise<MoneyAtRiskResult> {
    let resolvedScope: 'agent' | 'team' | 'city' = 'city';
    let filterStaffIds: string[] | null = null;

    let policy: PricingPolicy | null = null;
    if (this.pricingService) {
      try {
        policy = await this.pricingService.current();
      } catch {
        policy = null;
      }
    }
    const guaranteeDays = policy?.jobSeekerGuaranteeDays ?? 30;
    const defaultActivationFeePaise = policy?.activationFeePaise ?? (499 * 100);
    const replacementSearchDays = policy?.replacementSearchDays ?? 15;

    // 1. Server-side RBAC scoping
    if (actor) {
      if (actor.role === 'finance') {
        throw new ForbiddenException(
          'Access denied: finance cannot access targets or performance metrics',
        );
      }

      if (actor.role === 'call_agent' || actor.role === 'field_agent') {
        const effectiveId = targetStaffId === 'me' || !targetStaffId ? actor.sub : targetStaffId;
        if (effectiveId !== actor.sub) {
          throw new ForbiddenException(
            'Access denied: can only access your own money at risk',
          );
        }
        resolvedScope = 'agent';
        filterStaffIds = [actor.sub];
      } else if (actor.role === 'team_lead') {
        // Find team members
        const teamMembers = await this.prisma.staff.findMany({
          where: { teamLeadId: actor.sub },
          select: { id: true },
        });
        const teamMemberIds = teamMembers.map((m) => m.id);

        if (targetStaffId && targetStaffId !== 'me') {
          if (!teamMemberIds.includes(targetStaffId)) {
            throw new ForbiddenException(
              `Access denied: staff '${targetStaffId}' is not part of your team`,
            );
          }
          resolvedScope = 'agent';
          filterStaffIds = [targetStaffId];
        } else {
          resolvedScope = 'team';
          filterStaffIds = teamMemberIds;
        }
      } else {
        // CEO or Manager
        if (targetStaffId && targetStaffId !== 'me') {
          const staff = await this.prisma.staff.findUnique({
            where: { id: targetStaffId },
          });
          if (!staff) {
            throw new NotFoundException(`Staff '${targetStaffId}' not found`);
          }
          resolvedScope = 'agent';
          filterStaffIds = [targetStaffId];
        } else {
          resolvedScope = 'city';
          filterStaffIds = null;
        }
      }
    }

    // --- 2. CANDIDATES AT RISK ---
    // Candidates who paid activation fee, not placed, not deactivated, approaching 30-day deadline
    const candidateWhere: Record<string, unknown> = {
      status: { notIn: ['placed', 'deactivated'] },
      paymentReceivedAt: { not: null },
    };
    if (filterStaffIds !== null) {
      candidateWhere.registeredByStaffId = { in: filterStaffIds };
    }

    const candidates = await this.prisma.jobSeeker.findMany({
      where: candidateWhere,
      select: {
        id: true,
        code: true,
        city: true,
        name: true,
        phone: true,
        tradeSkill: true,
        paymentReceivedAt: true,
        status: true,
        registeredByStaffId: true,
        registeredBy: {
          select: { id: true, code: true, name: true },
        },
      },
    });

    let rejectedCandidateIdSet = new Set<string>();
    const refundedCandidateIdSet = new Set<string>();
    const candidatePaymentMap = new Map<string, number>();

    if (candidates.length > 0) {
      const candidateIds = candidates.map((c) => c.id);

      const rejectedHits = await this.prisma.jobSeekerHit.findMany({
        where: {
          jobSeekerId: { in: candidateIds },
          reason: 'offer_rejected',
        },
        select: { jobSeekerId: true },
      });
      rejectedCandidateIdSet = new Set(rejectedHits.map((h) => h.jobSeekerId));

      // Query candidate payments (refunds and activations) in a single set-based query
      const candidatePayments = await this.prisma.payment.findMany({
        where: {
          jobSeekerId: { in: candidateIds },
        },
        orderBy: { createdAt: 'desc' },
      });
      for (const p of candidatePayments) {
        if (!p.jobSeekerId) continue;
        if (
          p.type === 'refund' &&
          ['pending', 'processing', 'completed', 'succeeded'].includes(p.status)
        ) {
          refundedCandidateIdSet.add(p.jobSeekerId);
        } else if (
          (p.type === 'activation' || p.type === 'reactivation') &&
          ['completed', 'succeeded'].includes(p.status) &&
          !candidatePaymentMap.has(p.jobSeekerId)
        ) {
          candidatePaymentMap.set(p.jobSeekerId, p.amount);
        }
      }
    }

    const candidateRows: MoneyAtRiskRow[] = [];

    for (const c of candidates) {
      if (!c.paymentReceivedAt) continue;
      // Disqualifiers from shared eligibility
      if (c.status === 'placed' || c.status === 'deactivated') continue;
      if (rejectedCandidateIdSet.has(c.id)) continue;
      if (refundedCandidateIdSet.has(c.id)) continue;

      const deadline = refundGuaranteeDeadline(c.paymentReceivedAt, guaranteeDays);
      const diffMs = deadline.getTime() - now.getTime();

      // APPROACHING ONLY RULE: If deadline already passed (diffMs <= 0), it is owed/lost money on /refunds/due
      if (diffMs <= 0) continue;

      const daysRemaining = Math.ceil(diffMs / (24 * 60 * 60 * 1000));

      if (daysRemaining <= CANDIDATE_AT_RISK_WINDOW_DAYS && daysRemaining > 0) {
        const amountPaise = candidatePaymentMap.get(c.id) ?? defaultActivationFeePaise;
        const amountRupees = toRupees(amountPaise);
        candidateRows.push({
          type: 'job_seeker',
          id: c.id,
          code: c.code,
          city: c.city,
          amountPaise,
          amountRupees,
          daysRemaining,
          deadline: deadline.toISOString(),
          staffId: c.registeredByStaffId,
          staffName: c.registeredBy?.name ?? null,
          staffCode: c.registeredBy?.code ?? null,
          details: {
            name: c.name,
            phone: c.phone,
            tradeSkill: c.tradeSkill,
          },
        });
      }
    }

    // --- 3. PLACEMENTS AT RISK ---
    // Dropped-out placements with eligibility employee_left, approaching 15-day deadline
    const placementWhere: Record<string, unknown> = {
      status: 'dropped_out',
      eligibility: 'employee_left',
      dropoutReportedAt: { not: null },
    };
    if (filterStaffIds !== null) {
      placementWhere.createdByStaffId = { in: filterStaffIds };
    }

    const placements = await this.prisma.placement.findMany({
      where: placementWhere,
      include: {
        replacementCandidates: {
          select: { status: true },
        },
        business: {
          select: { name: true, area: true },
        },
        jobSeeker: {
          select: { name: true, phone: true },
        },
        createdBy: {
          select: { id: true, code: true, name: true },
        },
      },
    });

    let refundedPlacementIdSet = new Set<string>();

    if (placements.length > 0) {
      const placementIds = placements.map((p) => p.id);

      const existingPlacementRefunds = await this.prisma.payment.findMany({
        where: {
          placementId: { in: placementIds },
          type: 'refund',
          status: { in: ['pending', 'processing', 'completed', 'succeeded'] },
        },
        select: { placementId: true },
      });
      refundedPlacementIdSet = new Set(existingPlacementRefunds.map((p) => p.placementId!));
    }

    const placementRows: MoneyAtRiskRow[] = [];

    for (const pl of placements) {
      if (!pl.dropoutReportedAt) continue;
      // Disqualifiers from shared eligibility
      const hasAcceptedReplacement = pl.replacementCandidates.some((rc) => rc.status === 'accepted');
      if (hasAcceptedReplacement) continue;
      if (refundedPlacementIdSet.has(pl.id)) continue;

      const daysElapsed = calculateDaysElapsed(
        pl.dropoutReportedAt,
        pl.clockPaused,
        pl.clockPausedAt,
        now,
      );

      // search window from policy
      const daysRemaining = replacementSearchDays - daysElapsed;

      // APPROACHING ONLY RULE: If search window has elapsed (daysRemaining <= 0), it is owed/lost money on /refunds/due
      if (daysRemaining <= 0) continue;

      if (daysRemaining <= PLACEMENT_AT_RISK_WINDOW_DAYS) {
        // Deadline is dropoutReportedAt + replacementSearchDays (adjusted for clock pause)
        const deadlineDate = new Date(
          pl.dropoutReportedAt.getTime() + replacementSearchDays * 24 * 60 * 60 * 1000,
        );

        placementRows.push({
          type: 'placement',
          id: pl.id,
          code: pl.code,
          city: pl.city,
          amountPaise: pl.placementFee,
          amountRupees: pl.placementFee / 100,
          daysRemaining,
          deadline: deadlineDate.toISOString(),
          staffId: pl.createdByStaffId,
          staffName: pl.createdBy?.name ?? null,
          staffCode: pl.createdBy?.code ?? null,
          details: {
            businessName: pl.business.name,
            dropoutReportedAt: pl.dropoutReportedAt.toISOString(),
            placementFee: pl.placementFee,
            clockPaused: pl.clockPaused,
          },
        });
      }
    }

    // --- 4. MERGE & SORT SOONEST-DEADLINE FIRST ---
    const allRows = [...candidateRows, ...placementRows];

    allRows.sort((a, b) => {
      // Soonest-deadline first (lowest daysRemaining first)
      if (a.daysRemaining !== b.daysRemaining) {
        return a.daysRemaining - b.daysRemaining;
      }
      // Earlier deadline date first
      const timeDiff = new Date(a.deadline).getTime() - new Date(b.deadline).getTime();
      if (timeDiff !== 0) return timeDiff;
      return a.code.localeCompare(b.code);
    });

    const candidatesAtRiskPaise = candidateRows.reduce((acc, r) => acc + r.amountPaise, 0);
    const placementsAtRiskPaise = placementRows.reduce((acc, r) => acc + r.amountPaise, 0);
    const totalAtRiskPaise = candidatesAtRiskPaise + placementsAtRiskPaise;

    return {
      scope: resolvedScope,
      actorId: actor?.sub ?? 'system',
      asOf: now.toISOString(),
      totalAtRiskPaise,
      totalAtRiskRupees: totalAtRiskPaise / 100,
      candidatesCount: candidateRows.length,
      candidatesAtRiskPaise,
      placementsCount: placementRows.length,
      placementsAtRiskPaise,
      rows: allRows,
    };
  }
}
