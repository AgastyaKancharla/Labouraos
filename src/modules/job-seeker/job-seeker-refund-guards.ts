import { Prisma } from '@prisma/client';

/** Hits that end the ₹499 refund (declining a suitable offer, not replying, not turning up). */
export const REFUND_FORFEITING_HIT_REASONS = [
  'offer_declined',
  'offer_no_reply',
  'interview_no_show',
  'offer_rejected',
] as const;

/**
 * Hits that still count: not reversed by a Team Lead, and from the current guarantee.
 * Paying ₹499 again after deactivation supersedes every earlier hit (Master Guide:
 * "pays ₹499 again, which resets the hits and the 30-day clock").
 */
export const CURRENT_CYCLE_HIT_WHERE = { reversedAt: null, supersededAt: null } satisfies Prisma.JobSeekerHitWhereInput;

export interface JobSeekerRefundGuards {
  /** An unreversed refund-ending hit in the current guarantee. */
  hasOfferRejectedHit: boolean;
  /** The refund-check call was recorded in the current guarantee with a real answer. */
  refundCheckRecorded: boolean;
  /** At the refund check he said he is working elsewhere (a job found on his own). */
  refundCheckWorkingElsewhere: boolean;
  /** An interview offer is still waiting for his reply. */
  hasOpenOfferReply: boolean;
}

type RefundGuardDb = {
  jobSeekerHit: { findFirst(args: Prisma.JobSeekerHitFindFirstArgs): Promise<unknown> };
  followUpTask: { findFirst(args: Prisma.FollowUpTaskFindFirstArgs): Promise<{ answer: string | null } | null> };
  interview: { findFirst(args: Prisma.InterviewFindFirstArgs): Promise<unknown> };
};

/**
 * Facts the ₹499 refund approval needs on top of the shared eligibility rules
 * (Master Guide, "Refunds" and "Stopping bypass"):
 * - before a refund is approved, the candidate is asked whether he is working at a
 *   business Laboura introduced (the refund-check call), and
 * - an offer gets 48 hours for his reply, even past day 30, so a refund never
 *   overtakes an offer still waiting for an answer.
 */
export async function loadJobSeekerRefundGuards(
  db: RefundGuardDb,
  seeker: { id: string; paymentReceivedAt: Date | null },
): Promise<JobSeekerRefundGuards> {
  const forfeitingHit = await db.jobSeekerHit.findFirst({
    where: {
      jobSeekerId: seeker.id,
      reason: { in: [...REFUND_FORFEITING_HIT_REASONS] },
      ...CURRENT_CYCLE_HIT_WHERE,
    },
    select: { id: true },
  });
  const refundCheck = seeker.paymentReceivedAt
    ? await db.followUpTask.findFirst({
        where: {
          subjectType: 'job_seeker',
          subjectId: seeker.id,
          kind: 'refund_check',
          status: 'done',
          createdAt: { gte: seeker.paymentReceivedAt },
          answer: { not: null },
        },
        orderBy: { completedAt: 'desc' },
        select: { answer: true },
      })
    : null;
  const openOffer = await db.interview.findFirst({
    where: { jobSeekerId: seeker.id, status: 'offered' },
    select: { id: true },
  });
  const answer = refundCheck?.answer ?? null;
  return {
    hasOfferRejectedHit: Boolean(forfeitingHit),
    refundCheckRecorded: answer !== null && answer !== 'no_answer',
    refundCheckWorkingElsewhere: answer === 'working_elsewhere',
    hasOpenOfferReply: Boolean(openOffer),
  };
}
