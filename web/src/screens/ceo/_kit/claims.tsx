/**
 * Why a replacement claim is rejected — decides whether it may be reported
 * again (owner decision 14 Nov; server: src/modules/placement/claim-refile.ts).
 */
export const CLAIM_REJECTION_CHOICE = {
  label: 'Why it is rejected',
  options: [
    { value: 'reviewed', label: 'Checked, not accepted — only a Manager or the CEO can reopen' },
    { value: 'wrong_details', label: 'Wrong date or detail — can be reported once more' },
    { value: 'no_owner_call', label: 'The owner call did not confirm it — can be reported once more' },
  ],
};

export const CLAIM_REJECTION_HELP =
  'Say why — they see it with the decision. A fixable mistake can be reported once more within the 7 days; otherwise only a Manager or the CEO can report it again.';

export const REJECTION_LABEL: Record<string, string> = {
  reported_late: 'reported after 7 days',
  fee_unpaid: 'fee not paid in full',
  reason_not_covered: 'reason not covered',
  wrong_details: 'wrong date or detail',
  no_owner_call: 'owner call did not confirm it',
  reviewed: 'reviewed and rejected',
};

export interface PreviousClaim {
  code: string;
  decision: string | null;
  decisionReason: string | null;
  rejectionCode: string | null;
}

/** "RC-00002 rejected (wrong date or detail): “…”" for each earlier claim. */
export function previousClaimsText(claims: PreviousClaim[] | undefined): string {
  if (!claims?.length) return '';
  return claims
    .map((c) => `${c.code} ${c.decision === 'accepted' ? 'accepted' : 'rejected'}${c.rejectionCode ? ` (${REJECTION_LABEL[c.rejectionCode] ?? c.rejectionCode})` : ''}${c.decisionReason ? `: “${c.decisionReason}”` : ''}`)
    .join(' · ');
}
