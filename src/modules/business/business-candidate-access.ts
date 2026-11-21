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
 * - 21 Nov: a business a field agent **verified** at the shop (the verification
 *   visit done with GPS, live photos and the owner's code, and the agreement
 *   signed: `fieldVerifiedAt`) shows candidates straight away too, the same as
 *   in-person onboarding, while it waits in `pending_tl_check`.
 */
export interface BusinessCandidateAccessInput {
  verificationStatus: string | null;
  inPersonOnboardedAt?: Date | null;
  /** 21 Nov: the field agent's verification visit and the signed agreement are done. */
  fieldVerifiedAt?: Date | null;
  pausedAt?: Date | null;
  /** D6 (rev 176): suspended by the CEO until suspendedUntil, or for good when that is empty. */
  suspendedAt?: Date | null;
  suspendedUntil?: Date | null;
}

export type BusinessCandidateAccess =
  | { allowed: true; basis: 'verified' | 'in_person_onboarding' | 'field_verified' }
  | { allowed: false; reason: 'paused' | 'not_verified' | 'suspended' };

export const BUSINESS_PAUSED_MESSAGE =
  'This business is paused by the Team Lead: no candidates or interviews until it is unpaused';

export const BUSINESS_SUSPENDED_MESSAGE =
  'This business is suspended by the CEO: no new vacancies, candidates or interviews while it lasts';

/** D6: suspended now (a 30–90 day suspension ends by itself at suspendedUntil). */
export function isBusinessSuspended(business: Pick<BusinessCandidateAccessInput, 'suspendedAt' | 'suspendedUntil'>, now: Date = new Date()): boolean {
  if (!business.suspendedAt) return false;
  return !business.suspendedUntil || business.suspendedUntil.getTime() > now.getTime();
}

/** The message for a refused access, so every screen says the same thing. */
export function businessAccessMessage(access: BusinessCandidateAccess, notVerified: string): string {
  if (access.allowed) return '';
  if (access.reason === 'suspended') return BUSINESS_SUSPENDED_MESSAGE;
  if (access.reason === 'paused') return BUSINESS_PAUSED_MESSAGE;
  return notVerified;
}

export function businessCandidateAccess(business: BusinessCandidateAccessInput, now: Date = new Date()): BusinessCandidateAccess {
  if (isBusinessSuspended(business, now)) return { allowed: false, reason: 'suspended' };
  if (business.pausedAt) return { allowed: false, reason: 'paused' };
  if (business.verificationStatus === 'verified') return { allowed: true, basis: 'verified' };
  if (business.verificationStatus === 'pending_tl_check' && business.inPersonOnboardedAt) {
    return { allowed: true, basis: 'in_person_onboarding' };
  }
  if (business.verificationStatus === 'pending_tl_check' && business.fieldVerifiedAt) {
    return { allowed: true, basis: 'field_verified' };
  }
  return { allowed: false, reason: 'not_verified' };
}
