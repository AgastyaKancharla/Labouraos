/**
 * The close-to-refund rules shared by every list that plans work
 * (Phase 21 Task 7). Pure functions, so the buckets are tested at every edge.
 */
export const DAY_MS = 24 * 60 * 60 * 1000;

export const PRIORITY_BUCKETS = ['0-5', '6-10', '11-15'] as const;
export type PriorityBucket = (typeof PRIORITY_BUCKETS)[number];

/** Job seeker statuses with no refund to come (placed, deactivated by 3 hits, closed, already refunded). */
export const SEEKER_ENDED_STATUSES = ['placed', 'deactivated', 'closed', 'refunded'];

/**
 * An interview that counts as an offer made to him since paying: anything
 * but a cancelled booking (same rule as the CEO's close-to-refund list and
 * the call agent's work queue).
 */
export const OFFER_STATUSES = ['offered', 'confirmed', 'declined', 'no_reply', 'completed', 'no_show', 'no_result'];

/** Whole days until the deadline, rounded up: 4 days and 1 hour left is 5. */
export function daysLeftOn(deadline: Date, now: Date): number {
  return Math.ceil((deadline.getTime() - now.getTime()) / DAY_MS);
}

/**
 * The bucket for `daysLeft`, or null outside the window. A deadline already
 * past belongs on the refunds-due list, not here.
 */
export function priorityBucket(daysLeft: number, windowDays: number): PriorityBucket | null {
  if (!Number.isFinite(windowDays) || !Number.isFinite(daysLeft)) return null;
  if (daysLeft < 0 || daysLeft > windowDays) return null;
  if (daysLeft <= 5) return '0-5';
  if (daysLeft <= 10) return '6-10';
  return '11-15';
}

/** What a work list already knows about a job seeker, enough to tell whether he is a priority. */
export interface PriorityInput {
  status: string;
  paymentReceivedAt: Date | null;
  hits: Array<{ reason: string; reversedAt: Date | null }>;
  payments: Array<{ type: string; status: string; createdAt?: Date }>;
  interviews: Array<{ status: string; offerSentAt?: Date | null }>;
}

const REFUND_ENDING_HITS = ['offer_declined', 'offer_no_reply', 'interview_no_show', 'offer_rejected'];
const DEAD_REFUND = ['failed', 'rejected', 'reversed'];

/**
 * Is this job seeker inside the close-to-refund window right now, and how
 * many days are left? Paid, guarantee running out within the window, refund
 * not ended or paid, and no suitable offer since paying.
 */
export function refundPriorityOf(
  seeker: PriorityInput,
  now: Date,
  guaranteeDays: number,
  windowDays: number,
): { priority: boolean; daysLeft: number | null } {
  const paidAt = seeker.paymentReceivedAt;
  if (!paidAt || SEEKER_ENDED_STATUSES.includes(seeker.status)) return { priority: false, daysLeft: null };
  const daysLeft = daysLeftOn(new Date(paidAt.getTime() + guaranteeDays * DAY_MS), now);
  if (!priorityBucket(daysLeft, windowDays)) return { priority: false, daysLeft };
  if (seeker.hits.some((hit) => !hit.reversedAt && REFUND_ENDING_HITS.includes(hit.reason))) {
    return { priority: false, daysLeft };
  }
  const refunded = seeker.payments.some(
    (p) => p.type === 'refund' && !DEAD_REFUND.includes(p.status) && (!p.createdAt || p.createdAt >= paidAt),
  );
  if (refunded) return { priority: false, daysLeft };
  const offered = seeker.interviews.some(
    (i) => OFFER_STATUSES.includes(i.status) && (!i.offerSentAt || i.offerSentAt >= paidAt),
  );
  return { priority: !offered, daysLeft };
}

/**
 * Matching order (Phase 21 Task 7): higher score first; between equal
 * matches, a priority candidate first (fewest days left first). Ranking only
 * ever reorders people who already passed every filter.
 */
export function compareMatches(
  a: { score: number; jobSeekerId: string; priority?: boolean; daysLeft?: number | null },
  b: { score: number; jobSeekerId: string; priority?: boolean; daysLeft?: number | null },
): number {
  const scoreA = Math.round(a.score * 1e6);
  const scoreB = Math.round(b.score * 1e6);
  if (scoreA !== scoreB) return scoreB - scoreA;
  if (Boolean(a.priority) !== Boolean(b.priority)) return a.priority ? -1 : 1;
  if (a.priority && b.priority && a.daysLeft !== b.daysLeft) return (a.daysLeft ?? 0) - (b.daysLeft ?? 0);
  return a.jobSeekerId.localeCompare(b.jobSeekerId);
}
