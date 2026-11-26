/**
 * Documents a business may give (owner, 26 Nov): the form shows the 2–3 that fit the business type and
 * offers the rest under "+ Add another document". All are optional; "No documents" stays.
 *
 * GST, FSSAI, trade licence (BBMP / municipal), Shop and Establishment, Udyam and PAN have their own
 * columns. The others are saved together as `otherLicences` (src/modules/business/other-licences.ts) and,
 * like FSSAI, count as proof 2 for the automatic check.
 *
 * Who needs what (research, 26 Nov): food businesses need FSSAI (registration or licence); pharmacies a
 * drug licence (Form 20/21); clinics, hospitals and labs KPME registration; bars and liquor shops an excise
 * licence (CL-9 / CL-2); security agencies a PSARA licence; manpower, housekeeping, security and
 * construction contractors a contract labour licence; factories a factory licence; petrol pumps a PESO
 * licence (Form XIV); most shops and services in Bengaluru a BBMP trade licence and a Shop and
 * Establishment registration.
 */
export const OTHER_LICENCE_KINDS = ['drug_licence', 'kpme', 'excise', 'psara', 'contract_labour', 'factory_licence', 'peso'] as const;
export type OtherLicenceKind = (typeof OTHER_LICENCE_KINDS)[number];

export type DocKey = 'gst' | 'fssai' | 'trade' | 'shopEst' | 'udyam' | 'pan' | OtherLicenceKind;

/** Every document, in the order "+ Add another document" lists them. */
export const ALL_DOCS: readonly DocKey[] = ['gst', 'fssai', 'trade', 'shopEst', 'udyam', 'pan', ...OTHER_LICENCE_KINDS];

const FOOD = ['fssai', 'gst'] as const;
const SHOP = ['gst', 'trade', 'shopEst'] as const;
const MEDICAL = ['kpme', 'trade'] as const;
const OFFICE = ['gst', 'shopEst', 'pan'] as const;
const CONTRACTOR = ['gst', 'contract_labour'] as const;

const BY_TYPE: Record<string, readonly DocKey[]> = {
  restaurant: FOOD, hotel_lodge: ['fssai', 'gst', 'trade'], dhaba: FOOD, bakery: FOOD, sweet_shop: FOOD,
  tea_coffee_stall: FOOD, juice_ice_cream_shop: FOOD, fast_food_street_food: FOOD, catering: FOOD,
  cloud_kitchen: FOOD, canteen_mess: FOOD, food_court: FOOD,
  bar_pub: ['excise', 'fssai', 'gst'],
  liquor_shop: ['excise', 'gst', 'trade'],
  supermarket: FOOD, grocery_kirana: FOOD, fruits_vegetables: FOOD, meat_fish_chicken: ['fssai', 'gst', 'trade'],
  pharmacy: ['drug_licence', 'gst'],
  petrol_pump: ['peso', 'gst'],
  hospital: ['kpme', 'drug_licence', 'gst'], clinic: MEDICAL, dental_clinic: MEDICAL, diagnostic_lab: MEDICAL, nursing_home: MEDICAL,
  security_agency: ['psara', 'gst', 'contract_labour'],
  housekeeping_facility: CONTRACTOR, cleaning_services: CONTRACTOR, construction: CONTRACTOR,
  factory: ['factory_licence', 'gst', 'udyam'], packaging_unit: ['factory_licence', 'gst', 'udyam'],
  warehouse: ['gst', 'trade'],
  office: OFFICE, it_company: OFFICE, coworking_space: OFFICE, bank_finance: OFFICE, real_estate: OFFICE,
  school: ['trade', 'pan'], college: ['trade', 'pan'], coaching_tuition: ['gst', 'trade'],
  hostel_pg: ['trade', 'gst'], apartment_society: ['pan', 'gst'], villa_gated_community: ['pan', 'gst'],
  farm: ['udyam', 'gst'], plant_nursery: ['udyam', 'gst'], dairy: ['fssai', 'gst'],
  // Older values still on some rows.
  restaurant_hotel: FOOD, hospital_clinic: MEDICAL,
};

/** The documents the form shows first for a business type (shops and services, and anything not listed: GST, trade licence, S&E). */
export function suggestedDocs(businessType: string | null | undefined): readonly DocKey[] {
  return BY_TYPE[businessType ?? ''] ?? SHOP;
}

/** Licence numbers of other authorities: 4 to 40 letters, digits, "/", "-", "." or spaces, at least 2 digits (as the server checks). */
export function isValidOtherLicenceNumber(value: string): boolean {
  const v = value.trim().toUpperCase();
  return /^[A-Z0-9/.\- ]{4,40}$/.test(v) && (v.match(/\d/g)?.length ?? 0) >= 2;
}

export function isOtherLicence(key: string): key is OtherLicenceKind {
  return (OTHER_LICENCE_KINDS as readonly string[]).includes(key);
}
