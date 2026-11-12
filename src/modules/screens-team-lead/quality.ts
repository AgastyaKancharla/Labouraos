/**
 * The short call checklist a Team Lead scores against (design T-Quality).
 * Minimal on purpose: each item counts equally, the score is out of 100.
 */
export const QUALITY_CHECKLIST = [
  'Said their name and Laboura at the start',
  'Asked for and recorded call-recording consent',
  'Explained the ₹499 fee and the 30-day guarantee correctly',
  'Picked the right trade and checked the salary against the market range',
  'Never promised a job or a salary',
  'Booked a follow-up or closed politely',
] as const;

/** Share of checks met, out of 100, rounded. */
export function scoreOf(checks: readonly boolean[]): number {
  if (checks.length === 0) return 0;
  return Math.round((checks.filter(Boolean).length / checks.length) * 100);
}
