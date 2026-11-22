import { ALL_BUSINESS_TYPES } from './business-types';

/**
 * Every valid business type (22 Nov, rev 207): the full grouped list
 * (business-types.ts) plus the older values, which stay valid so old rows
 * still display. Pickers offer only the grouped list.
 */
export const BUSINESS_TYPES: readonly string[] = ALL_BUSINESS_TYPES;

export const BUSINESS_CONTACT_ROLES = ['owner', 'manager', 'hr', 'supervisor', 'other'] as const;
export const EMPLOYEE_COUNT_BANDS = ['1-5', '6-20', '21-50', '51-200', '200+'] as const;
/** From the approved business form design (decided 10 Nov). */
export const YEARS_RUNNING_BANDS = ['under_1', '1_3', '3_10', '10_plus'] as const;
export const HIRING_FREQUENCIES = ['rarely', 'every_few_months', 'every_month', 'every_week'] as const;

export type BusinessType = string;

/**
 * Visit purposes that are the business's verification visit: the usual
 * `verification`, and `business_signup` — the visit request made when a
 * business signs up in the customer app (proposal 4.2: "the verification
 * visit is required anyway"). Both need the shop photo, the selfie, GPS and
 * the owner's OTP, and both move the business on to the Team Lead's check.
 */
export const VERIFICATION_VISIT_PURPOSES = ['verification', 'business_signup'] as const;

export function isVerificationVisitPurpose(purpose: string | null | undefined): boolean {
  return (VERIFICATION_VISIT_PURPOSES as readonly string[]).includes(purpose ?? '');
}
