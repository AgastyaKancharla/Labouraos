/**
 * Proposals N1–N5, confirmed by Agastya on 11 Nov (confirmation list section 2).
 */

/** N2: the Team Lead list shows paid job seekers with no interview this many days after paying. */
export const DAYS_TO_FIRST_INTERVIEW_ALERT_DAYS = 10;

/** N1 states of a rupee received. */
export const GUARANTEE_STATES = ['under_guarantee', 'refund_due', 'refunded', 'safely_earned'] as const;
export type GuaranteeState = (typeof GUARANTEE_STATES)[number];

/** Payment statuses that mean the money is in the bank. */
export const RECEIVED_PAYMENT_STATUSES = ['succeeded', 'completed'] as const;

/**
 * Refund statuses that still count: the one shared list (common/money). A payout the
 * bank refused (failed) is retried, never made again, so it still counts.
 */
export { LIVE_REFUND_STATUSES } from '../../common/money/current-guarantee-refund';

/** N5: why a job seeker is on the win-back list. */
export const WIN_BACK_REASONS = ['refunded', 'deactivated'] as const;
export type WinBackReason = (typeof WIN_BACK_REASONS)[number];

/** N5: how far back the daily sweep looks for vacancies that were opened or reopened. */
export const WIN_BACK_LOOKBACK_DAYS = 2;

/**
 * N5: consents needed before a win-back call. Job alerts by phone (job_updates) and the
 * recorded call (call_recording); the matching engine itself also requires job_matching
 * and profile_sharing.
 */
export const WIN_BACK_CALL_CONSENTS = ['job_updates', 'call_recording'] as const;
