import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.service';
import { evaluateJobSeekerRefundEligibility } from '../job-seeker/job-seeker-refund-eligibility';
import { evaluatePlacementRefundEligibility } from '../placement/placement-refund-eligibility';
import { RefundDueRow } from './dto/refund-due.dto';

@Injectable()
export class RefundService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Retrieves all refunds currently due for both job seekers and placements.
   *
   * LOCKED DOMAIN REQUIREMENTS (Phase 6.5 Task 9):
   * 1. SHARED ELIGIBILITY LOGIC: Uses the exact same evaluate*RefundEligibility
   *    functions as JobSeekerService.approveRefund and PlacementService.approveRefund.
   * 2. NO N+1 QUERIES: Resolves candidates, hits, placements, and existing refunds
   *    in single set-based queries and joins in memory.
   * 3. COMPUTED FRESH, NEVER STORED: No eligibility flag/column; computed on-the-fly.
   * 4. AMOUNTS AND SORT: Integer paise amounts, sorted longest-owed first (highest daysOwed).
   */
  async getRefundsDue(actorId: string, now: Date = new Date()): Promise<RefundDueRow[]> {
    const actor = await this.prisma.staff.findUnique({
      where: { id: actorId },
    });
    if (!actor) {
      throw new NotFoundException(`Staff '${actorId}' not found`);
    }

    // --- 1. JOB SEEKERS (Set-Based Query) ---
    // Candidate pool: active or pending candidates who paid activation fee at least 30 days ago
    const maxPaymentDate = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);

    const candidates = await this.prisma.jobSeeker.findMany({
      where: {
        status: { notIn: ['placed', 'deactivated'] },
        paymentReceivedAt: { not: null, lte: maxPaymentDate },
      },
      select: {
        id: true,
        code: true,
        city: true,
        name: true,
        phone: true,
        tradeSkill: true,
        paymentReceivedAt: true,
        status: true,
      },
    });

    let rejectedCandidateIdSet = new Set<string>();
    let refundedCandidateIdSet = new Set<string>();

    if (candidates.length > 0) {
      const candidateIds = candidates.map((c) => c.id);

      // Query offer_rejected hits set-based (1 query)
      const rejectedHits = await this.prisma.jobSeekerHit.findMany({
        where: {
          jobSeekerId: { in: candidateIds },
          reason: 'offer_rejected',
        },
        select: { jobSeekerId: true },
      });
      rejectedCandidateIdSet = new Set(rejectedHits.map((h) => h.jobSeekerId));

      // Query existing refunds set-based (1 query)
      const existingCandidateRefunds = await this.prisma.payment.findMany({
        where: {
          jobSeekerId: { in: candidateIds },
          type: 'refund',
          status: { in: ['pending', 'processing', 'completed', 'succeeded'] },
        },
        select: { jobSeekerId: true },
      });
      refundedCandidateIdSet = new Set(existingCandidateRefunds.map((p) => p.jobSeekerId!));
    }

    const jobSeekerRows: RefundDueRow[] = [];
    for (const candidate of candidates) {
      const result = evaluateJobSeekerRefundEligibility(
        {
          code: candidate.code,
          paymentReceivedAt: candidate.paymentReceivedAt,
          status: candidate.status,
          hasOfferRejectedHit: rejectedCandidateIdSet.has(candidate.id),
          hasExistingRefund: refundedCandidateIdSet.has(candidate.id),
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
          tradeSkill: candidate.tradeSkill,
          paymentReceivedAt: candidate.paymentReceivedAt!.toISOString(),
          jobSeeker: {
            id: candidate.id,
            code: candidate.code,
            name: candidate.name,
            phone: candidate.phone,
            tradeSkill: candidate.tradeSkill,
            paymentReceivedAt: candidate.paymentReceivedAt!.toISOString(),
          },
        });
      }
    }

    // --- 2. PLACEMENTS (Set-Based Query) ---
    // Placements in dropped_out status with eligibility employee_left
    const placements = await this.prisma.placement.findMany({
      where: {
        status: 'dropped_out',
        eligibility: 'employee_left',
        dropoutReportedAt: { not: null },
      },
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
      },
    });

    let refundedPlacementIdSet = new Set<string>();

    if (placements.length > 0) {
      const placementIds = placements.map((p) => p.id);

      // Query existing refunds set-based (1 query)
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

    const placementRows: RefundDueRow[] = [];
    for (const placement of placements) {
      const hasAcceptedReplacement = placement.replacementCandidates.some(
        (rc) => rc.status === 'accepted',
      );

      const result = evaluatePlacementRefundEligibility(
        {
          code: placement.code,
          status: placement.status,
          eligibility: placement.eligibility,
          hasAcceptedReplacement,
          dropoutReportedAt: placement.dropoutReportedAt,
          clockPaused: placement.clockPaused,
          clockPausedAt: placement.clockPausedAt,
          placementFee: placement.placementFee,
          hasExistingRefund: refundedPlacementIdSet.has(placement.id),
        },
        now,
      );

      if (result.eligible) {
        // Obligation begins 15 days after dropoutReportedAt
        const dueSince = new Date(
          placement.dropoutReportedAt!.getTime() + 15 * 24 * 60 * 60 * 1000,
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
            clockPaused: placement.clockPaused,
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
