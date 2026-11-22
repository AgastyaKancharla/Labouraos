/**
 * Types of business (Master Guide rev 207, 22 Nov): one full list, grouped by
 * sector, used everywhere a business type is chosen. The SAME list is in
 * src/modules/business/business-types.ts (server), web/src/screens/call-agent/_registration/businessTypes.ts
 * and field/src/lib/businessTypes.ts; src/modules/business/business-types.spec.ts checks they match.
 * Older values (LEGACY) stay valid so old rows still display; pickers no longer offer them.
 */
export interface BusinessTypeOption {
  value: string;
  label: string;
}
export interface BusinessTypeGroup {
  key: string;
  label: string;
  types: BusinessTypeOption[];
}

export const BUSINESS_TYPE_GROUPS: BusinessTypeGroup[] = [
  {
    key: 'food',
    label: 'Food & hospitality',
    types: [
      { value: 'restaurant', label: 'Restaurant' },
      { value: 'hotel_lodge', label: 'Hotel / lodge' },
      { value: 'dhaba', label: 'Dhaba' },
      { value: 'bakery', label: 'Bakery' },
      { value: 'sweet_shop', label: 'Sweet shop' },
      { value: 'tea_coffee_stall', label: 'Tea / coffee stall' },
      { value: 'juice_ice_cream_shop', label: 'Juice / ice-cream shop' },
      { value: 'fast_food_street_food', label: 'Fast food / street food' },
      { value: 'catering', label: 'Catering' },
      { value: 'cloud_kitchen', label: 'Cloud kitchen' },
      { value: 'canteen_mess', label: 'Canteen / mess' },
      { value: 'bar_pub', label: 'Bar / pub' },
      { value: 'food_court', label: 'Food court' },
    ],
  },
  {
    key: 'retail',
    label: 'Retail',
    types: [
      { value: 'supermarket', label: 'Supermarket' },
      { value: 'grocery_kirana', label: 'Grocery / kirana' },
      { value: 'pharmacy', label: 'Pharmacy / medical store' },
      { value: 'clothing_textiles', label: 'Clothing / textiles' },
      { value: 'footwear', label: 'Footwear' },
      { value: 'electronics_mobile_shop', label: 'Electronics / mobile shop' },
      { value: 'hardware_paints_sanitary', label: 'Hardware / paints / sanitary' },
      { value: 'furniture', label: 'Furniture' },
      { value: 'jewellery', label: 'Jewellery' },
      { value: 'stationery_books', label: 'Stationery / books' },
      { value: 'fruits_vegetables', label: 'Fruits & vegetables' },
      { value: 'meat_fish_chicken', label: 'Meat / fish / chicken' },
      { value: 'liquor_shop', label: 'Liquor shop' },
      { value: 'auto_parts', label: 'Auto parts' },
      { value: 'gift_general_store', label: 'Gift / general store' },
    ],
  },
  {
    key: 'services',
    label: 'Services',
    types: [
      { value: 'salon', label: 'Salon / beauty parlour' },
      { value: 'spa_massage', label: 'Spa / massage' },
      { value: 'laundry_dry_cleaning', label: 'Laundry / dry cleaning' },
      { value: 'tailoring_boutique', label: 'Tailoring / boutique' },
      { value: 'repair_shop', label: 'Repair shop (mobile / electronics / appliances)' },
      { value: 'auto_garage', label: 'Auto garage / service centre' },
      { value: 'car_bike_wash', label: 'Car / bike wash' },
      { value: 'petrol_pump', label: 'Petrol pump' },
      { value: 'courier_logistics', label: 'Courier / logistics / delivery' },
      { value: 'printing_xerox', label: 'Printing / xerox' },
      { value: 'gym_fitness', label: 'Gym / fitness' },
      { value: 'event_management', label: 'Event management / decorators' },
      { value: 'travel_agency', label: 'Travel agency' },
      { value: 'packers_movers', label: 'Packers & movers' },
    ],
  },
  {
    key: 'health',
    label: 'Health',
    types: [
      { value: 'hospital', label: 'Hospital' },
      { value: 'clinic', label: 'Clinic' },
      { value: 'dental_clinic', label: 'Dental clinic' },
      { value: 'diagnostic_lab', label: 'Diagnostic lab' },
      { value: 'nursing_home', label: 'Nursing home / elder care' },
    ],
  },
  {
    key: 'education',
    label: 'Education & stay',
    types: [
      { value: 'school', label: 'School' },
      { value: 'college', label: 'College' },
      { value: 'coaching_tuition', label: 'Coaching / tuition centre' },
      { value: 'hostel_pg', label: 'Hostel / PG' },
    ],
  },
  {
    key: 'residential',
    label: 'Residential',
    types: [
      { value: 'apartment_society', label: 'Apartment / society' },
      { value: 'household', label: 'Household (home)' },
      { value: 'villa_gated_community', label: 'Villa / gated community' },
    ],
  },
  {
    key: 'offices',
    label: 'Offices',
    types: [
      { value: 'office', label: 'Office / corporate' },
      { value: 'it_company', label: 'IT company' },
      { value: 'coworking_space', label: 'Co-working space' },
      { value: 'bank_finance', label: 'Bank / finance' },
      { value: 'real_estate', label: 'Real estate company' },
    ],
  },
  {
    key: 'industry',
    label: 'Industry & construction',
    types: [
      { value: 'factory', label: 'Factory / manufacturing' },
      { value: 'warehouse', label: 'Warehouse / godown' },
      { value: 'construction', label: 'Construction site / contractor' },
      { value: 'packaging_unit', label: 'Packaging unit' },
    ],
  },
  {
    key: 'facility',
    label: 'Facility & security',
    types: [
      { value: 'security_agency', label: 'Security agency' },
      { value: 'housekeeping_facility', label: 'Housekeeping / facility management' },
      { value: 'cleaning_services', label: 'Cleaning services' },
    ],
  },
  {
    key: 'agriculture',
    label: 'Agriculture',
    types: [
      { value: 'farm', label: 'Farm' },
      { value: 'plant_nursery', label: 'Plant nursery' },
      { value: 'dairy', label: 'Dairy' },
    ],
  },
  {
    key: 'other',
    label: 'Other',
    types: [
      { value: 'other', label: 'Other (type it)' },
    ],
  },
];

/** Values used before 22 Nov: still valid, shown with these names, never offered again. */
export const LEGACY_BUSINESS_TYPES: BusinessTypeOption[] = [
  { value: 'restaurant_hotel', label: 'Restaurant / hotel' },
  { value: 'retail_shop', label: 'Retail shop' },
  { value: 'retail', label: 'Retail shop' },
  { value: 'hospital_clinic', label: 'Hospital / clinic' },
];

/** "Other (type it)": the type in words is then required. */
export const OTHER_BUSINESS_TYPE = 'other';
export const BUSINESS_TYPE_OTHER_MAX = 80;

export const PICKABLE_BUSINESS_TYPES: string[] = BUSINESS_TYPE_GROUPS.flatMap((g) => g.types.map((t) => t.value));
export const ALL_BUSINESS_TYPES: string[] = [...PICKABLE_BUSINESS_TYPES, ...LEGACY_BUSINESS_TYPES.map((t) => t.value)];

/** The name of a business type, old or new ("Other: Flower shop" when typed); the value itself when unknown. */
export function businessTypeLabel(value: string | null | undefined, other?: string | null): string {
  if (!value) return '';
  if (value === OTHER_BUSINESS_TYPE && other && other.trim()) return other.trim();
  for (const g of BUSINESS_TYPE_GROUPS) {
    const found = g.types.find((t) => t.value === value);
    if (found) return found.label;
  }
  return LEGACY_BUSINESS_TYPES.find((t) => t.value === value)?.label ?? value;
}
