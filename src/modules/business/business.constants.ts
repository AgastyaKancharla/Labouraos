export const BUSINESS_TYPES = [
  'restaurant',
  'retail',
  'factory',
  'office',
  'warehouse',
  'household',
  'other',
] as const;

export type BusinessType = (typeof BUSINESS_TYPES)[number];
