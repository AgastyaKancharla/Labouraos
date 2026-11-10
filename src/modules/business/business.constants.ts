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
export const BUSINESS_MESSAGE_LANGUAGES = ['kn', 'hi', 'en'] as const;

export type BusinessType = (typeof BUSINESS_TYPES)[number];
