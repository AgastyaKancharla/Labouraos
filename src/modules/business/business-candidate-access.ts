/**
 * Whether a business may be shown candidates and have interviews booked.
 *
 * Master Guide, "A new business that calls in" (decided 9 Nov):
 * - No candidate is shown until the verification visit is done and a Team Lead
 *   has approved it (`verified`).
 * - A business a field agent onboards **in person** (GPS check, live storefront
 *   photo, contact person signs the agreement by OTP) can be shown candidates
 *   and have interviews booked straight away, in the same visit. It waits in
 *   `pending_tl_check` for the Team Lead's same-day review.
 * - The Team Lead can **pause** it if something is wrong; a paused business is
 *   shown no candidates and gets no new interviews until it is unpaused.
 */
export interface BusinessCandidateAccessInput {
  verificationStatus: string | null;
  inPersonOnboardedAt?: Date | null;
  pausedAt?: Date | null;
}

export type BusinessCandidateAccess =
  | { allowed: true; basis: 'verified' | 'in_person_onboarding' }
  | { allowed: false; reason: 'paused' | 'not_verified' };

export const BUSINESS_PAUSED_MESSAGE =
  'This business is paused by the Team Lead: no candidates or interviews until it is unpaused';

export function businessCandidateAccess(business: BusinessCandidateAccessInput): BusinessCandidateAccess {
  if (business.pausedAt) return { allowed: false, reason: 'paused' };
  if (business.verificationStatus === 'verified') return { allowed: true, basis: 'verified' };
  if (business.verificationStatus === 'pending_tl_check' && business.inPersonOnboardedAt) {
    return { allowed: true, basis: 'in_person_onboarding' };
  }
  return { allowed: false, reason: 'not_verified' };
}
