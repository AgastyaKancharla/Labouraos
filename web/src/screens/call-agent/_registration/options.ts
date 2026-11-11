import type { MessageKey } from '../../../i18n/en';

/**
 * The fixed lists on the registration forms. Values are exactly what the API
 * validators accept (job-seeker.validator.ts, business.constants.ts,
 * referral.service.ts, vacancy.constants.ts); labels are i18n keys.
 */
export interface Choice<V extends string = string> {
  value: V;
  label: MessageKey;
}

export const MESSAGE_LANGUAGES: readonly Choice<'kn' | 'hi' | 'en'>[] = [
  { value: 'kn', label: 'reg.lang.kn' },
  { value: 'hi', label: 'reg.lang.hi' },
  { value: 'en', label: 'reg.lang.en' },
];

export const HEARD_FROM: readonly Choice[] = [
  { value: 'toll_free_missed_call', label: 'reg.heard.toll_free_missed_call' },
  { value: 'ad', label: 'reg.heard.ad' },
  { value: 'referral_partner', label: 'reg.heard.referral_partner' },
  { value: 'field_visit', label: 'reg.heard.field_visit' },
  { value: 'social_media', label: 'reg.heard.social_media' },
  { value: 'walk_in', label: 'reg.heard.walk_in' },
  { value: 'other', label: 'reg.heard.other' },
];

export const BEST_TIME: readonly Choice[] = [
  { value: '09-12', label: 'reg.time.09-12' },
  { value: '12-15', label: 'reg.time.12-15' },
  { value: '15-18', label: 'reg.time.15-18' },
  { value: '18-21', label: 'reg.time.18-21' },
  { value: '09-21', label: 'reg.time.09-21' },
];

export const GENDERS: readonly Choice[] = [
  { value: 'female', label: 'reg.gender.female' },
  { value: 'male', label: 'reg.gender.male' },
  { value: 'other', label: 'reg.gender.other' },
];

export const TRAVEL_KM: readonly Choice[] = [
  { value: '3', label: 'reg.km.3' },
  { value: '5', label: 'reg.km.5' },
  { value: '8', label: 'reg.km.8' },
  { value: '10', label: 'reg.km.10' },
  { value: '15', label: 'reg.km.15' },
  { value: '20', label: 'reg.km.20' },
];

/** Years of experience; the API stores whole years, so ranges keep their lower end. */
export const YEARS: readonly (Choice & { years: number })[] = [
  { value: 'fresher', label: 'reg.years.fresher', years: 0 },
  { value: 'under1', label: 'reg.years.under1', years: 0 },
  { value: '1', label: 'reg.years.1', years: 1 },
  { value: '2', label: 'reg.years.2', years: 2 },
  { value: '3', label: 'reg.years.3', years: 3 },
  { value: '4', label: 'reg.years.4', years: 4 },
  { value: '5', label: 'reg.years.5', years: 5 },
  { value: '6-10', label: 'reg.years.6-10', years: 6 },
  { value: '10+', label: 'reg.years.10plus', years: 10 },
];

export const SHIFT_PREFERENCES: readonly Choice[] = [
  { value: 'day', label: 'reg.shift.day' },
  { value: 'night', label: 'reg.shift.night' },
  { value: 'rotational', label: 'reg.shift.rotational' },
  { value: 'any', label: 'reg.shift.any' },
];

/** Shifts a business offers (vacancies and staff-needed rows). */
export const VACANCY_SHIFTS: readonly Choice[] = [
  { value: 'day', label: 'reg.shift.day' },
  { value: 'night', label: 'reg.shift.night' },
  { value: 'rotational', label: 'reg.shift.rotational' },
];

export const JOB_TYPES: readonly Choice[] = [
  { value: 'full_time', label: 'reg.jobType.full_time' },
  { value: 'part_time', label: 'reg.jobType.part_time' },
  { value: 'live_in', label: 'reg.jobType.live_in' },
];

/** Spoken languages (speaking only — guide, decided 9 Nov). Stored by English name. */
export const SPOKEN_LANGUAGES = [
  'Kannada', 'Hindi', 'English', 'Tamil', 'Telugu', 'Malayalam', 'Urdu', 'Marathi', 'Bengali', 'Odia', 'Assamese', 'Nepali',
] as const;

export const QUALIFICATIONS: readonly Choice[] = [
  { value: 'up_to_8th', label: 'reg.qual.up_to_8th' },
  { value: '10th', label: 'reg.qual.10th' },
  { value: '12th', label: 'reg.qual.12th' },
  { value: 'iti', label: 'reg.qual.iti' },
  { value: 'diploma', label: 'reg.qual.diploma' },
  { value: 'graduate', label: 'reg.qual.graduate' },
  { value: 'post_graduate', label: 'reg.qual.post_graduate' },
];

export const LICENCES: readonly Choice[] = [
  { value: 'none', label: 'reg.licence.none' },
  { value: 'two_wheeler', label: 'reg.licence.two_wheeler' },
  { value: 'lmv', label: 'reg.licence.lmv' },
  { value: 'commercial', label: 'reg.licence.commercial' },
];

export const CONTACT_ROLES: readonly Choice[] = [
  { value: 'owner', label: 'reg.role.owner' },
  { value: 'manager', label: 'reg.role.manager' },
  { value: 'hr', label: 'reg.role.hr' },
  { value: 'supervisor', label: 'reg.role.supervisor' },
  { value: 'other', label: 'reg.role.other' },
];

export const BUSINESS_TYPES: readonly Choice[] = [
  { value: 'restaurant_hotel', label: 'reg.btype.restaurant_hotel' },
  { value: 'bakery', label: 'reg.btype.bakery' },
  { value: 'retail_shop', label: 'reg.btype.retail_shop' },
  { value: 'supermarket', label: 'reg.btype.supermarket' },
  { value: 'apartment_society', label: 'reg.btype.apartment_society' },
  { value: 'household', label: 'reg.btype.household' },
  { value: 'office', label: 'reg.btype.office' },
  { value: 'factory', label: 'reg.btype.factory' },
  { value: 'warehouse', label: 'reg.btype.warehouse' },
  { value: 'hospital_clinic', label: 'reg.btype.hospital_clinic' },
  { value: 'construction', label: 'reg.btype.construction' },
  { value: 'security_agency', label: 'reg.btype.security_agency' },
  { value: 'salon', label: 'reg.btype.salon' },
  { value: 'other', label: 'reg.btype.other' },
];

export const EMPLOYEE_BANDS: readonly Choice[] = [
  { value: '1-5', label: 'reg.employees.1-5' },
  { value: '6-20', label: 'reg.employees.6-20' },
  { value: '21-50', label: 'reg.employees.21-50' },
  { value: '51-200', label: 'reg.employees.51-200' },
  { value: '200+', label: 'reg.employees.200plus' },
];

export const YEARS_RUNNING: readonly Choice[] = [
  { value: 'under_1', label: 'reg.running.under_1' },
  { value: '1_3', label: 'reg.running.1_3' },
  { value: '3_10', label: 'reg.running.3_10' },
  { value: '10_plus', label: 'reg.running.10_plus' },
];

export const HIRING_FREQUENCIES: readonly Choice[] = [
  { value: 'rarely', label: 'reg.hiring.rarely' },
  { value: 'every_few_months', label: 'reg.hiring.every_few_months' },
  { value: 'every_month', label: 'reg.hiring.every_month' },
  { value: 'every_week', label: 'reg.hiring.every_week' },
];

export const WEEKDAYS: readonly Choice[] = [
  { value: 'mon', label: 'reg.day.mon' },
  { value: 'tue', label: 'reg.day.tue' },
  { value: 'wed', label: 'reg.day.wed' },
  { value: 'thu', label: 'reg.day.thu' },
  { value: 'fri', label: 'reg.day.fri' },
  { value: 'sat', label: 'reg.day.sat' },
  { value: 'sun', label: 'reg.day.sun' },
];

/** Shop & Establishment / Udyam / trade licence — one box in the design, three columns in the API. */
export const LICENCE_KINDS: readonly Choice<'shopEstablishmentNumber' | 'udyamNumber' | 'licenceNumber'>[] = [
  { value: 'shopEstablishmentNumber', label: 'reg.doc.shopEstablishment' },
  { value: 'udyamNumber', label: 'reg.doc.udyam' },
  { value: 'licenceNumber', label: 'reg.doc.tradeLicence' },
];

export const INDIVIDUAL_ROLES: readonly Choice[] = [
  { value: 'auto_driver', label: 'reg.partnerRole.auto_driver' },
  { value: 'shop_staff', label: 'reg.partnerRole.shop_staff' },
  { value: 'shop_owner', label: 'reg.partnerRole.shop_owner' },
  { value: 'security_guard', label: 'reg.partnerRole.security_guard' },
  { value: 'existing_worker', label: 'reg.partnerRole.existing_worker' },
  { value: 'other', label: 'reg.partnerRole.other' },
];

export const PAYER_RELATIONS: readonly Choice[] = [
  { value: 'brother', label: 'reg.relation.brother' },
  { value: 'sister', label: 'reg.relation.sister' },
  { value: 'parent', label: 'reg.relation.parent' },
  { value: 'spouse', label: 'reg.relation.spouse' },
  { value: 'friend', label: 'reg.relation.friend' },
  { value: 'other', label: 'reg.relation.other' },
];

export const WEEKLY_OFF: readonly Choice[] = [
  { value: 'sunday', label: 'reg.weeklyOff.sunday' },
  { value: 'monday', label: 'reg.weeklyOff.monday' },
  { value: 'tuesday', label: 'reg.weeklyOff.tuesday' },
  { value: 'wednesday', label: 'reg.weeklyOff.wednesday' },
  { value: 'thursday', label: 'reg.weeklyOff.thursday' },
  { value: 'friday', label: 'reg.weeklyOff.friday' },
  { value: 'saturday', label: 'reg.weeklyOff.saturday' },
  { value: 'rotational', label: 'reg.weeklyOff.rotational' },
];

export const EXPERIENCE_NEEDED: readonly (Choice & { years: number })[] = [
  { value: '0', label: 'reg.expNeeded.0', years: 0 },
  { value: '1', label: 'reg.expNeeded.1', years: 1 },
  { value: '2', label: 'reg.expNeeded.2', years: 2 },
  { value: '3', label: 'reg.expNeeded.3', years: 3 },
  { value: '5', label: 'reg.expNeeded.5', years: 5 },
];

export const VACANCY_EXTRAS: readonly Choice[] = [
  { value: 'food', label: 'reg.extra.food' },
  { value: 'accommodation', label: 'reg.extra.accommodation' },
  { value: 'overtime', label: 'reg.extra.overtime' },
  { value: 'transport', label: 'reg.extra.transport' },
  { value: 'uniform', label: 'reg.extra.uniform' },
  { value: 'pf_esi', label: 'reg.extra.pf_esi' },
  { value: 'incentives', label: 'reg.extra.incentives' },
];

export const OTHER_TRADE = '__other__';

export const HEADCOUNTS = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '10', '15', '20'] as const;
