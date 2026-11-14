export const BUSINESS_TYPES = [
  'restaurant_hotel',
  'bakery',
  'retail_shop',
  'supermarket',
  'apartment_society',
  'restaurant',
  'retail',
  'factory',
  'office',
  'warehouse',
  'hospital_clinic',
  'construction',
  'security_agency',
  'salon',
  'household',
  'other',
] as const;

export const BUSINESS_CONTACT_ROLES = ['owner', 'manager', 'hr', 'supervisor', 'other'] as const;
export const EMPLOYEE_COUNT_BANDS = ['1-5', '6-20', '21-50', '51-200', '200+'] as const;
/** From the approved business form design (decided 10 Nov). */
export const YEARS_RUNNING_BANDS = ['under_1', '1_3', '3_10', '10_plus'] as const;
export const HIRING_FREQUENCIES = ['rarely', 'every_few_months', 'every_month', 'every_week'] as const;
export const BUSINESS_MESSAGE_LANGUAGES = ['kn', 'hi', 'en'] as const;

export type BusinessType = (typeof BUSINESS_TYPES)[number];

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
