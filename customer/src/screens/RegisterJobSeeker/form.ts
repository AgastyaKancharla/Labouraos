import type { HeardFrom, JobSeekerForm, Language, Pin, SalaryPeriod, Shift, Trade } from '@/api/types';
import type { MessageKey } from '@/i18n';
import { ageOn, isPincode } from '@/lib/validate';

export const OTHER_TRADE = '__other__';
export const MAX_TRADES = 3;

export interface TradeRow {
  trade: string;
  otherName: string;
  years: number | null;
}

/** What the screen keeps (and saves as a draft on the phone). */
export interface JobSeekerDraft {
  dateOfBirth: string;
  ageConfirmed: boolean;
  fullName: string;
  gender: '' | JobSeekerForm['gender'];
  messageLanguage: Language;
  bestTimeToCall: '' | JobSeekerForm['bestTimeToCall'];
  area: string;
  pincode: string;
  pin: Pin | null;
  travelKm: number | null;
  trades: TradeRow[];
  availableFrom: string;
  lookingFor: '' | JobSeekerForm['lookingFor'];
  salaryMinPaise: number | null;
  salaryMaxPaise: number | null;
  salaryPeriod: SalaryPeriod;
  shift: '' | Shift;
  jobType: '' | JobSeekerForm['jobType'];
  languagesSpoken: string[];
  heardFrom: HeardFrom;
  whatsappSame: boolean;
}

export const emptyJobSeeker = (language: Language): JobSeekerDraft => ({
  dateOfBirth: '',
  ageConfirmed: false,
  fullName: '',
  gender: '',
  messageLanguage: language,
  bestTimeToCall: '',
  area: '',
  pincode: '',
  pin: null,
  travelKm: null,
  trades: [{ trade: '', otherName: '', years: null }],
  availableFrom: '',
  lookingFor: '',
  salaryMinPaise: null,
  salaryMaxPaise: null,
  salaryPeriod: 'monthly',
  shift: '',
  jobType: '',
  languagesSpoken: [],
  heardFrom: 'laboura_app',
  whatsappSame: true,
});

export type AgeCheck = 'missing' | 'under18' | 'ok';

/** Step 1 (proposal 2.1): under 18 stops here, before anything else is collected. */
export function checkAge(dateOfBirth: string, todayKey: string): AgeCheck {
  if (!dateOfBirth) return 'missing';
  return ageOn(dateOfBirth, todayKey) < 18 ? 'under18' : 'ok';
}

export type JobSeekerErrors = Partial<Record<string, MessageKey>>;

/** Required fields from the guide's "What is recorded" (the agent's form). */
export function validateJobSeeker(d: JobSeekerDraft): JobSeekerErrors {
  const e: JobSeekerErrors = {};
  if (d.fullName.trim().length < 2) e.fullName = 'form.required';
  if (!d.gender) e.gender = 'form.required';
  if (!d.bestTimeToCall) e.bestTimeToCall = 'form.required';
  if (!d.area) e.area = 'form.required';
  if (!isPincode(d.pincode)) e.pincode = 'form.pincodeInvalid';
  if (d.travelKm === null) e.travelKm = 'form.required';
  d.trades.forEach((row, i) => {
    if (!row.trade) e[`trade${i}`] = 'form.required';
    else if (row.trade === OTHER_TRADE && row.otherName.trim().length < 2) e[`tradeOther${i}`] = 'form.required';
    if (row.years === null) e[`years${i}`] = 'form.required';
    else if (row.years > 50) e[`years${i}`] = 'jobSeeker.yearsTooMany';
  });
  if (!d.availableFrom) e.availableFrom = 'form.required';
  if (!d.lookingFor) e.lookingFor = 'form.required';
  if (!d.salaryMinPaise) e.salaryMin = 'form.required';
  if (!d.salaryMaxPaise) e.salaryMax = 'form.required';
  else if (d.salaryMinPaise && d.salaryMaxPaise < d.salaryMinPaise) e.salaryMax = 'jobSeeker.maxBelowMin';
  if (!d.shift) e.shift = 'form.required';
  if (!d.jobType) e.jobType = 'form.required';
  if (d.languagesSpoken.length === 0) e.languagesSpoken = 'form.required';
  return e;
}

export function toJobSeekerForm(d: JobSeekerDraft): JobSeekerForm {
  return {
    fullName: d.fullName.trim(),
    dateOfBirth: d.dateOfBirth,
    gender: d.gender as JobSeekerForm['gender'],
    messageLanguage: d.messageLanguage,
    bestTimeToCall: d.bestTimeToCall as JobSeekerForm['bestTimeToCall'],
    area: d.area,
    pincode: d.pincode.trim(),
    pin: d.pin,
    travelKm: d.travelKm ?? 0,
    trades: d.trades.map((row) =>
      row.trade === OTHER_TRADE ? { trade: 'other', otherName: row.otherName.trim(), years: row.years ?? 0 } : { trade: row.trade, years: row.years ?? 0 },
    ),
    availableFrom: d.availableFrom,
    lookingFor: d.lookingFor as JobSeekerForm['lookingFor'],
    salaryMinPaise: d.salaryMinPaise ?? 0,
    salaryMaxPaise: d.salaryMaxPaise ?? 0,
    salaryPeriod: d.salaryPeriod,
    shift: d.shift as Shift,
    jobType: d.jobType as JobSeekerForm['jobType'],
    languagesSpoken: d.languagesSpoken,
    heardFrom: d.heardFrom,
    whatsappSame: d.whatsappSame,
  };
}

/**
 * The market-range hint and warning (guide, "Market salary ranges"): the
 * salary used for the guarantee is the lower of his minimum and the top of
 * the range. Only for monthly salaries (the ranges are monthly).
 */
export function salaryHint(trade: Trade | undefined, d: Pick<JobSeekerDraft, 'salaryMinPaise' | 'salaryPeriod'>) {
  if (!trade || d.salaryPeriod !== 'monthly') return null;
  const aboveRange = d.salaryMinPaise !== null && d.salaryMinPaise > trade.salaryMaxPaise;
  return { minPaise: trade.salaryMinPaise, maxPaise: trade.salaryMaxPaise, aboveRange };
}
