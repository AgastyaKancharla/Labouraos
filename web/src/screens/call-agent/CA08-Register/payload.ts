import { OTHER_TRADE, YEARS } from '../_registration/options';
import type { PlaceState } from '../_registration/kit';

/**
 * The job seeker form (CA08 / CA08v) and how it maps onto the API:
 * POST /job-seekers takes every field the validator requires
 * (job-seeker.validator.ts); the optional extras go in one
 * PATCH /job-seekers/:id/profile straight after.
 */
export interface TradeRow {
  trade: string;
  other: string;
  years: string;
}

export interface JobSeekerForm {
  name: string;
  mobile: string;
  whatsappSame: boolean;
  whatsapp: string;
  dateOfBirth: string;
  gender: string;
  messageLanguage: string;
  bestTime: string;
  heardFrom: string;
  place: PlaceState;
  travelKm: string;
  preferredAreas: string[];
  relocate: boolean;
  accommodation: boolean;
  trades: TradeRow[];
  workingNow: '' | 'no' | 'yes';
  lastEmployer: string;
  lastRole: string;
  lastSalaryPaise: number | null;
  lookingSince: string;
  minSalaryPaise: number | null;
  maxSalaryPaise: number | null;
  period: 'monthly' | 'daily';
  availableFrom: string;
  shift: string;
  jobType: string;
  spoken: string[];
  qualification: string;
  noQualification: boolean;
  licence: string;
  ownVehicle: boolean;
  police: boolean;
  smartphone: boolean;
  referredByQuery: string;
  referredBy: { id: string; code: string; name: string } | null;
  keepHighSalary: boolean;
}

export const EMPTY_FORM: JobSeekerForm = {
  name: '',
  mobile: '',
  whatsappSame: true,
  whatsapp: '',
  dateOfBirth: '',
  gender: '',
  messageLanguage: '',
  bestTime: '',
  heardFrom: '',
  place: { area: '', pincode: '', latitude: null, longitude: null },
  travelKm: '',
  preferredAreas: [],
  relocate: false,
  accommodation: false,
  trades: [{ trade: '', other: '', years: '' }],
  workingNow: '',
  lastEmployer: '',
  lastRole: '',
  lastSalaryPaise: null,
  lookingSince: '',
  minSalaryPaise: null,
  maxSalaryPaise: null,
  period: 'monthly',
  availableFrom: '',
  shift: '',
  jobType: '',
  spoken: [],
  qualification: '',
  noQualification: false,
  licence: '',
  ownVehicle: false,
  police: false,
  smartphone: false,
  referredByQuery: '',
  referredBy: null,
  keepHighSalary: false,
};

export function tradeName(row: TradeRow): string {
  return (row.trade === OTHER_TRADE ? row.other : row.trade).trim();
}

export type FieldError =
  | 'name' | 'dateOfBirth' | 'gender' | 'messageLanguage' | 'bestTime' | 'heardFrom' | 'area' | 'pincode' | 'pin'
  | 'travelKm' | 'trade' | 'years' | 'lookingSince' | 'minSalary' | 'maxSalary' | 'salaryOrder' | 'availableFrom'
  | 'shift' | 'jobType' | 'spoken' | 'duplicateTrade' | 'whatsapp';

/** Required on the first call (guide: What is recorded). Returns the fields still missing or wrong. */
export function validate(form: JobSeekerForm): FieldError[] {
  const errors: FieldError[] = [];
  if (!form.name.trim()) errors.push('name');
  if (!form.dateOfBirth) errors.push('dateOfBirth');
  if (!form.gender) errors.push('gender');
  if (!form.messageLanguage) errors.push('messageLanguage');
  if (!form.bestTime) errors.push('bestTime');
  if (!form.heardFrom) errors.push('heardFrom');
  if (!form.place.area) errors.push('area');
  if (!/^\d{6}$/.test(form.place.pincode)) errors.push('pincode');
  if (form.place.latitude === null || form.place.longitude === null) errors.push('pin');
  if (!form.travelKm) errors.push('travelKm');
  if (!form.whatsappSame && !/^[6-9]\d{9}$/.test(form.whatsapp)) errors.push('whatsapp');
  const first = form.trades[0];
  if (!first || !tradeName(first)) errors.push('trade');
  if (form.trades.some((row) => tradeName(row) && !row.years)) errors.push('years');
  const names = form.trades.map(tradeName).filter(Boolean).map((n) => n.toLowerCase());
  if (new Set(names).size !== names.length) errors.push('duplicateTrade');
  if (!form.lookingSince) errors.push('lookingSince');
  if (!form.minSalaryPaise) errors.push('minSalary');
  if (!form.maxSalaryPaise) errors.push('maxSalary');
  if (form.minSalaryPaise && form.maxSalaryPaise && form.minSalaryPaise > form.maxSalaryPaise) errors.push('salaryOrder');
  if (!form.availableFrom) errors.push('availableFrom');
  if (!form.shift) errors.push('shift');
  if (!form.jobType) errors.push('jobType');
  if (form.spoken.length === 0) errors.push('spoken');
  return errors;
}

/** Body for POST /job-seekers (CreateJobSeekerDto). Call only after validate() is empty. */
export function createBody(form: JobSeekerForm, otpRequestId: string) {
  return {
    name: form.name.trim(),
    phone: form.mobile,
    otpRequestId,
    messageLanguage: form.messageLanguage,
    bestTimeToCall: form.bestTime,
    dateOfBirth: form.dateOfBirth,
    gender: form.gender,
    heardFrom: form.referredBy ? 'referral_partner' : form.heardFrom,
    locality: form.place.area,
    pincode: form.place.pincode,
    latitude: form.place.latitude,
    longitude: form.place.longitude,
    travelDistanceKm: Number(form.travelKm),
    trades: form.trades
      .filter((row) => tradeName(row))
      .map((row) => ({ trade: tradeName(row), yearsExperience: YEARS.find((y) => y.value === row.years)?.years ?? 0 })),
    availableFrom: form.availableFrom,
    lookingSince: form.lookingSince,
    minSalary: form.minSalaryPaise,
    maxSalary: form.maxSalaryPaise,
    salaryPeriod: form.period,
    shiftPreference: form.shift,
    jobType: form.jobType,
    spokenLanguages: form.spoken,
    ...(form.referredBy ? { referredById: form.referredBy.id } : {}),
    city: 'Bengaluru',
  };
}

/** The optional extras for PATCH /job-seekers/:id/profile, or null when nothing optional was filled. */
export function profileBody(form: JobSeekerForm): Record<string, unknown> | null {
  const body: Record<string, unknown> = {};
  if (!form.whatsappSame && form.whatsapp) body.whatsappPhone = form.whatsapp;
  else if (form.whatsappSame) body.whatsappPhone = form.mobile;
  if (form.preferredAreas.length) body.preferredLocalities = form.preferredAreas;
  if (form.relocate) body.willingToRelocate = true;
  if (form.accommodation) body.needsAccommodation = true;
  if (form.workingNow) body.currentlyWorking = form.workingNow === 'yes';
  if (form.lastEmployer.trim()) body.lastEmployer = form.lastEmployer.trim();
  if (form.lastRole) body.lastRole = form.lastRole;
  if (form.lastSalaryPaise) body[form.workingNow === 'yes' ? 'currentSalaryPaise' : 'lastSalaryPaise'] = form.lastSalaryPaise;
  if (form.noQualification) body.educationLevel = 'none';
  else if (form.qualification) body.educationLevel = form.qualification;
  if (form.licence) body.drivingLicenceType = form.licence;
  if (form.ownVehicle) body.ownVehicle = true;
  if (form.police) body.policeVerified = true;
  if (form.smartphone) body.hasSmartphone = true;
  if (Object.keys(body).length === 0) return null;
  return { ...body, reason: 'Filled on the registration form' };
}
