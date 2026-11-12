import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.service';
import { PricingService } from '../pricing/pricing.service';
import { evaluateJobSeekerRefundEligibility } from '../job-seeker/job-seeker-refund-eligibility';
import { evaluatePlacementRefundEligibility } from '../placement/placement-refund-eligibility';
import { RefundDueRow } from './dto/refund-due.dto';
import { primaryJobSeekerTrade } from '../job-seeker/job-seeker-legacy-read';

@Injectable()
export class RefundService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly pricingService: PricingService,
  ) {}

  /**
   * Retrieves all refunds currently due for both job seekers and placements.
   *
   * LOCKED DOMAIN REQUIREMENTS (Phase 6.5 Task 9 & Phase 9 Task 2):
   * 1. SHARED ELIGIBILITY LOGIC: Uses the exact same evaluate*RefundEligibility
   *    functions as JobSeekerService.approveRefund and PlacementService.approveRefund.
   * 2. NO N+1 QUERIES: Resolves candidates, hits, placements, and existing refunds
   *    in single set-based queries and joins in memory.
   * 3. COMPUTED FRESH, NEVER STORED: No eligibility flag/column; computed on-the-fly.
   * 4. AMOUNTS AND SORT: Integer paise amounts, sorted longest-owed first (highest daysOwed).
   * 5. DYNAMIC PRICING: Reads guaranteeDays and searchDays from PricingPolicy, returning
   *    the amount the candidate actually paid.
   */
  async getRefundsDue(actorId: string, now: Date = new Date()): Promise<RefundDueRow[]> {
    const actor = await this.prisma.staff.findUnique({
      where: { id: actorId },
    });
    if (!actor) {
      throw new NotFoundException(`Staff '${actorId}' not found`);
    }

    const policy = await this.pricingService.current();
    const guaranteeDays = policy.jobSeekerGuaranteeDays;
    const replacementSearchDays = policy.replacementSearchDays;

    // --- 1. JOB SEEKERS (Set-Based Query) ---
    // Candidate pool: active or pending candidates who paid activation fee at least guaranteeDays ago
    const maxPaymentDate = new Date(now.getTime() - guaranteeDays * 24 * 60 * 60 * 1000);

    const candidates = await this.prisma.jobSeeker.findMany({
      where: {
        status: { notIn: ['placed', 'deactivated', 'closed', 'refunded'] },
        paymentReceivedAt: {
          not: null,
          lte: maxPaymentDate,
        },
      },
      include: { trades: true },
    });

    let rejectedCandidateIdSet = new Set<string>();
    const refundedCandidateIdSet = new Set<string>();
    const candidatePaymentMap = new Map<string, number>();
    const withdrawnConsentMap = new Map<string, Date>();
    let openBypassCandidateIdSet = new Set<string>();
    let bypassFollowUpCandidateIdSet = new Set<string>();

    if (candidates.length > 0) {
      const candidateIds = candidates.map((c) => c.id);

      // Query non-reversed disqualifying hits set-based (1 query)
      const rejectedHits = await this.prisma.jobSeekerHit.findMany({
        where: {
          jobSeekerId: { in: candidateIds },
          reason: { in: ['offer_declined', 'offer_no_reply', 'interview_no_show', 'offer_rejected'] },
          reversedAt: null,
          supersededAt: null,
        },
        select: { jobSeekerId: true },
      });
      rejectedCandidateIdSet = new Set(rejectedHits.map((h) => h.jobSeekerId));

      // Query candidate payments (refunds and activations) in a single set-based query
      const paidAtById = new Map(candidates.map((c) => [c.id, c.paymentReceivedAt]));
      const candidatePayments = await this.prisma.payment.findMany({
        where: {
          jobSeekerId: { in: candidateIds },
        },
        orderBy: { createdAt: 'desc' },
      });
      for (const p of candidatePayments) {
        if (!p.jobSeekerId) continue;
        const isRefund =
          !p.type ||
          (p.type === 'refund' &&
            (!p.status || ['pending', 'approved', 'processing', 'completed', 'succeeded', 'failed'].includes(p.status)));
        // Only a refund in his current guarantee counts: paying ₹499 again after a
        // refund starts a new guarantee.
        const paidAt = paidAtById.get(p.jobSeekerId);
        if (isRefund && (!paidAt || !p.createdAt || p.createdAt >= paidAt)) {
          refundedCandidateIdSet.add(p.jobSeekerId);
        } else if (
          (p.type === 'activation' || p.type === 'reactivation') &&
          (!p.status || ['completed', 'succeeded'].includes(p.status)) &&
          !candidatePaymentMap.has(p.jobSeekerId)
        ) {
          candidatePaymentMap.set(p.jobSeekerId, p.amount);
        }
      }

      // Check withdrawn essential consents
      const withdrawnConsents = this.prisma.consent
        ? await this.prisma.consent.findMany({
            where: {
              subjectType: 'job_seeker',
              subjectId: { in: candidateIds },
              purpose: { in: ['job_matching', 'profile_sharing', 'call_recording'] },
              withdrawnAt: { not: null },
            },
            select: { subjectId: true, withdrawnAt: true },
          })
        : [];
      for (const c of withdrawnConsents) {
        if (c.withdrawnAt) {
          const existing = withdrawnConsentMap.get(c.subjectId);
          if (!existing || c.withdrawnAt > existing) {
            withdrawnConsentMap.set(c.subjectId, c.withdrawnAt);
          }
        }
      }

      // Check open bypass_suspected flags
      const openBypassFlags = this.prisma.reviewFlag
        ? await this.prisma.reviewFlag.findMany({
            where: {
              subjectType: 'job_seeker',
              subjectId: { in: candidateIds },
              kind: 'bypass_suspected',
              status: 'open',
            },
            select: { subjectId: true },
          })
        : [];
      openBypassCandidateIdSet = new Set(openBypassFlags.map((f) => f.subjectId));

      // Check completed refund_check follow-up tasks with answer working_at_introduced_business
      const bypassFollowUps = this.prisma.followUpTask
        ? await this.prisma.followUpTask.findMany({
            where: {
              subjectType: 'job_seeker',
              subjectId: { in: candidateIds },
              kind: 'refund_check',
              answer: 'working_at_introduced_business',
            },
            select: { subjectId: true },
          })
        : [];
      bypassFollowUpCandidateIdSet = new Set(bypassFollowUps.map((t) => t.subjectId));
    }

    const jobSeekerRows: RefundDueRow[] = [];
    for (const candidate of candidates) {
      const storedPaid = candidatePaymentMap.get(candidate.id);
      const paidAmount = storedPaid !== undefined ? storedPaid : policy.activationFeePaise;
      const withdrawnAt = withdrawnConsentMap.get(candidate.id);
      const hasWithdrawnEssentialConsent = Boolean(
        withdrawnAt && candidate.paymentReceivedAt && withdrawnAt >= candidate.paymentReceivedAt,
      );
      const hasOpenBypassFlag = openBypassCandidateIdSet.has(candidate.id);
      const hasWorkingAtIntroducedBusinessFollowUp = bypassFollowUpCandidateIdSet.has(candidate.id);

      const result = evaluateJobSeekerRefundEligibility(
        {
          code: candidate.code,
          paymentReceivedAt: candidate.paymentReceivedAt,
          status: candidate.status,
          hasOfferRejectedHit: rejectedCandidateIdSet.has(candidate.id),
          hasExistingRefund: refundedCandidateIdSet.has(candidate.id),
          activationPaymentPaise: paidAmount,
          guaranteeDays,
          hasWithdrawnEssentialConsent,
          hasOpenBypassFlag,
          hasWorkingAtIntroducedBusinessFollowUp,
        },
        now,
      );

      if (result.eligible) {
        jobSeekerRows.push({
          type: 'job_seeker',
          id: candidate.id,
          code: candidate.code,
          city: candidate.city,
          amount: result.amountPaise,
          amountOwed: result.amountPaise,
          daysOwed: result.daysOwed,
          daysElapsed: result.daysElapsed,
          dueSince: result.deadline!.toISOString(),
          name: candidate.name,
          phone: candidate.phone,
          tradeSkill: primaryJobSeekerTrade(candidate) ?? '',
          paymentReceivedAt: candidate.paymentReceivedAt!.toISOString(),
          jobSeeker: {
            id: candidate.id,
            code: candidate.code,
            name: candidate.name,
            phone: candidate.phone,
            tradeSkill: primaryJobSeekerTrade(candidate) ?? '',
            paymentReceivedAt: candidate.paymentReceivedAt!.toISOString(),
          },
        });
      }
    }

    // --- 2. PLACEMENTS (Set-Based Query) ---
    // Placements in dropped_out status
    const placements = await this.prisma.placement.findMany({
      where: {
        status: 'dropped_out',
        dropoutReportedAt: { not: null },
      },
      include: {
        replacementCandidates: {
          select: { status: true },
        },
        business: {
          select: { name: true },
        },
        jobSeeker: {
          select: { name: true, phone: true },
        },
      },
    });

    let refundedPlacementIdSet = new Set<string>();
    const claimByPlacementId = new Map<string, { decidedAt: Date | null; reportedAt: Date | null }>();

    if (placements.length > 0) {
      const placementIds = placements.map((p) => p.id);
      const rootPlacementIds = placements
        .map((p) => p.rootPlacementId)
        .filter((id): id is string => Boolean(id));
      const allPlacementIds = Array.from(new Set([...placementIds, ...rootPlacementIds]));

      // Query existing refunds set-based (1 query)
      const existingPlacementRefunds = await this.prisma.payment.findMany({
        where: {
          placementId: { in: allPlacementIds },
          type: 'refund',
          status: { in: ['pending', 'approved', 'processing', 'completed', 'succeeded'] },
        },
        select: { placementId: true },
      });
      refundedPlacementIdSet = new Set(existingPlacementRefunds.map((p) => p.placementId!));

      // Query accepted replacement claims set-based
      const acceptedClaims = this.prisma.replacementClaim
        ? await this.prisma.replacementClaim.findMany({
            where: {
              placementId: { in: allPlacementIds },
              decision: 'accepted',
            },
            orderBy: { decidedAt: 'desc' },
            select: { placementId: true, decidedAt: true, reportedAt: true },
          })
        : [];
      for (const claim of acceptedClaims) {
        if (!claimByPlacementId.has(claim.placementId)) {
          claimByPlacementId.set(claim.placementId, claim);
        }
      }
    }

    const placementRows: RefundDueRow[] = [];
    for (const placement of placements) {
      const hasAcceptedReplacement = placement.replacementCandidates.some(
        (rc) => rc.status === 'accepted',
      );

      const rootId = placement.rootPlacementId ?? placement.id;
      const claim = claimByPlacementId.get(placement.id) ?? claimByPlacementId.get(rootId);
      const claimAcceptedAt = claim?.decidedAt ?? null;
      // The 15-day clock starts at the dropout report, not the claim decision.
      const dropoutReportedAt = claim?.reportedAt ?? placement.dropoutReportedAt;

      const result = evaluatePlacementRefundEligibility(
        {
          code: placement.code,
          status: placement.status,
          hasAcceptedReplacement,
          claimAcceptedAt,
          dropoutReportedAt,
          placementFee: placement.placementFee,
          hasExistingRefund:
            refundedPlacementIdSet.has(placement.id) || refundedPlacementIdSet.has(rootId),
          searchDays: replacementSearchDays,
          guaranteeEndedReason: placement.guaranteeEndedReason,
        },
        now,
      );

      if (result.eligible) {
        // Obligation begins replacementSearchDays after the dropout report
        const clockStart = (dropoutReportedAt ?? claimAcceptedAt)!;
        const dueSince = new Date(
          clockStart.getTime() + replacementSearchDays * 24 * 60 * 60 * 1000,
        ).toISOString();

        placementRows.push({
          type: 'placement',
          id: placement.id,
          code: placement.code,
          city: placement.city,
          amount: result.amountPaise,
          amountOwed: result.amountPaise,
          daysOwed: result.daysOwed,
          daysElapsed: result.daysElapsed,
          dueSince,
          dropoutDateCallerSupplied: placement.dropoutDateCallerSupplied,
          joinedDate: placement.joinedDate ? placement.joinedDate.toISOString() : null,
          dropoutReportedAt: placement.dropoutReportedAt!.toISOString(),
          businessName: placement.business.name,
          candidateName: placement.jobSeeker.name,
          candidatePhone: placement.jobSeeker.phone,
          placement: {
            id: placement.id,
            code: placement.code,
            joinedDate: placement.joinedDate ? placement.joinedDate.toISOString() : null,
            dropoutReportedAt: placement.dropoutReportedAt!.toISOString(),
            dropoutDateCallerSupplied: placement.dropoutDateCallerSupplied,
            businessName: placement.business.name,
            candidateName: placement.jobSeeker.name,
            candidatePhone: placement.jobSeeker.phone,
            placementFee: placement.placementFee,
          },
        });
      }
    }

    // --- 3. MERGE & SORT LONGEST-OWED FIRST ---
    const allRows = [...jobSeekerRows, ...placementRows];

    allRows.sort((a, b) => {
      // Longest-owed first (highest daysOwed first)
      if (b.daysOwed !== a.daysOwed) {
        return b.daysOwed - a.daysOwed;
      }
      // Stable tiebreak: earlier dueSince first
      const timeDiff = new Date(a.dueSince).getTime() - new Date(b.dueSince).getTime();
      if (timeDiff !== 0) return timeDiff;
      return a.code.localeCompare(b.code);
    });

    return allRows;
  }
}
