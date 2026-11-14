import { addDays, istDayOf } from './claim-dates';

/**
 * Reporting a worker-left claim again after a rejection (owner decision 14 Nov).
 *
 * Every rejection carries a code:
 *  - set automatically when the claim is made:
 *      reported_late       reported more than 7 days after the worker left
 *      fee_unpaid          the placement fee was not paid in full
 *      reason_not_covered  the reason is on the guarantee's "not covered" list
 *    → never reported again (the facts cannot change).
 *  - chosen by the person who rejects it (Team Lead, Manager, CEO):
 *      wrong_details       wrong leaving date or another detail       } fixable: ONE more report,
 *      no_owner_call       the owner call did not confirm it          } within the original 7 days
 *      reviewed            checked and not accepted (anything else)
 *    → a human decision: only a Manager or the CEO reports it again.
 */
export const AUTO_REJECTION_CODES = ['reported_late', 'fee_unpaid', 'reason_not_covered'] as const;
export const FIXABLE_REJECTION_CODES = ['wrong_details', 'no_owner_call'] as const;
export const REVIEW_REJECTION_CODES = [...FIXABLE_REJECTION_CODES, 'reviewed'] as const;

export type RejectionCode = (typeof AUTO_REJECTION_CODES)[number] | (typeof REVIEW_REJECTION_CODES)[number];

export function isAutoRejectionCode(code: unknown): code is (typeof AUTO_REJECTION_CODES)[number] {
  return typeof code === 'string' && (AUTO_REJECTION_CODES as readonly string[]).includes(code);
}

export function isReviewRejectionCode(code: unknown): code is (typeof REVIEW_REJECTION_CODES)[number] {
  return typeof code === 'string' && (REVIEW_REJECTION_CODES as readonly string[]).includes(code);
}

export interface PastClaim {
  code: string;
  workerLeftOn: Date;
  reportedAt: Date;
  decision: string | null;
  decisionReason: string | null;
  rejectionCode: string | null;
  decidedByStaffId: string | null;
  overruledByStaffId: string | null;
}

/** The rejection code of a decided claim; older claims (before codes) are read from their decision text. */
export function rejectionCodeOf(claim: PastClaim): RejectionCode | null {
  if (claim.decision !== 'rejected') return null;
  if (claim.rejectionCode) return claim.rejectionCode as RejectionCode;
  // An automatic rejection stays automatic even when a Manager overruled it and kept it rejected.
  const auto = (claim.decisionReason ?? '').startsWith('Auto-rejected');
  if (!auto) return 'reviewed';
  const text = claim.decisionReason ?? '';
  if (/^Auto-rejected: Reported/.test(text)) return 'reported_late';
  if (/fee is not paid/.test(text)) return 'fee_unpaid';
  return 'reason_not_covered';
}

export type RefileWho = 'anyone' | 'manager_ceo' | 'nobody';

export interface RefileRule {
  /** Whether this person may report now. */
  allowed: boolean;
  who: RefileWho;
  /** Why (shown in the form and returned as the refusal). Null when there was no earlier rejection. */
  message: string | null;
  /** Last Indian day of the original reporting window (policy claimReportDays), for a fixable rejection. */
  windowEndsOn: string | null;
  lastRejected: { code: string; rejectionCode: RejectionCode; decisionReason: string | null } | null;
}

const FIXABLE = FIXABLE_REJECTION_CODES as readonly string[];
const AUTO = AUTO_REJECTION_CODES as readonly string[];

/**
 * May `role` report a claim on this placement now, given its earlier claims
 * (any order)? Only the latest decided claim matters; an accepted one or none
 * leaves reporting open.
 */
export function refileRule(past: PastClaim[], role: string, today: string, reportDays: number): RefileRule {
  const decided = past.filter((c) => c.decision !== null).sort((a, b) => b.reportedAt.getTime() - a.reportedAt.getTime());
  const last = decided[0];
  const open: RefileRule = { allowed: true, who: 'anyone', message: null, windowEndsOn: null, lastRejected: null };
  if (!last || last.decision !== 'rejected') return open;
  const code = rejectionCodeOf(last)!;
  const lastRejected = { code: last.code, rejectionCode: code, decisionReason: last.decisionReason };
  const managerOrCeo = role === 'manager' || role === 'ceo';

  if (AUTO.includes(code)) {
    const why =
      code === 'reported_late'
        ? `it was reported more than ${reportDays} days after the worker left`
        : code === 'fee_unpaid'
          ? 'the placement fee was not paid in full'
          : 'the reason is not covered by the guarantee';
    return { allowed: false, who: 'nobody', message: `Claim ${last.code} was turned down because ${why}; it cannot be reported again.`, windowEndsOn: null, lastRejected };
  }

  if (FIXABLE.includes(code)) {
    const previous = decided[1];
    const alreadyRefiled = Boolean(previous && FIXABLE.includes(rejectionCodeOf(previous) ?? ''));
    const windowEndsOn = addDays(istDayOf(last.workerLeftOn)!, reportDays);
    if (!alreadyRefiled && today <= windowEndsOn) {
      return { allowed: true, who: 'anyone', message: `Claim ${last.code} was rejected for a detail that can be fixed; it can be reported once more until ${windowEndsOn}.`, windowEndsOn, lastRejected };
    }
    const why = alreadyRefiled ? 'it was already reported once more' : `the ${reportDays} days to report ended on ${windowEndsOn}`;
    return managerOrCeo
      ? { allowed: true, who: 'manager_ceo', message: `Claim ${last.code} was rejected and ${why}; only a Manager or the CEO can report it again.`, windowEndsOn, lastRejected }
      : { allowed: false, who: 'manager_ceo', message: `Claim ${last.code} was rejected and ${why}; only a Manager or the CEO can report it again.`, windowEndsOn, lastRejected };
  }

  // A person reviewed it and rejected it.
  return {
    allowed: managerOrCeo,
    who: 'manager_ceo',
    message: `Claim ${last.code} was reviewed and rejected; only a Manager or the CEO can report it again.`,
    windowEndsOn: null,
    lastRejected,
  };
}
