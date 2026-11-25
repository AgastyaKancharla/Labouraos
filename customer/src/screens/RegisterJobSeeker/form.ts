import type { Area, HeardFrom, JobSeekerForm, Language, Pin, SalaryPeriod, Shift, Trade } from '@/api/types';
import type { MessageKey } from '@/i18n';
import { ageOn, isPincode } from '@/lib/validate';
import { addDays, todayKeyIst as todayKeyIstNow } from '@/components/form';

export const OTHER_TRADE = '__other__';

/**
 * "How long have you been looking for work?" — simple choices instead of a
 * calendar (Agastya, 22 Nov). The server keeps a date (lookingSince), so the
 * choice is turned into "today minus that long" when the form is sent.
 */
export const LOOKING_FOR = [
  { value: 'now', days: 0, label: 'jobSeeker.looking.now' },
  { value: '1w', days: 7, label: 'jobSeeker.looking.1w' },
  { value: '2w', days: 14, label: 'jobSeeker.looking.2w' },
  { value: '1m', days: 30, label: 'jobSeeker.looking.1m' },
  { value: '3m', days: 90, label: 'jobSeeker.looking.3m' },
  { value: '6m', days: 180, label: 'jobSeeker.looking.6m' },
] as const satisfies readonly { value: string; days: number; label: MessageKey }[];
export type LookingFor = (typeof LOOKING_FOR)[number]['value'];

export function lookingSinceFrom(choice: LookingFor, todayKey: string): string {
  const days = LOOKING_FOR.find((c) => c.value === choice)?.days ?? 0;
  return addDays(todayKey, -days);
}
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
  area: string;
  pincode: string;
  pin: Pin | null;
  travelKm: number | null;
  trades: TradeRow[];
  availableFrom: string;
  salaryMinPaise: number | null;
  salaryMaxPaise: number | null;
  salaryPeriod: SalaryPeriod;
  shift: '' | Shift;
  jobType: '' | JobSeekerForm['jobType'];
  languagesSpoken: string[];
  heardFrom: HeardFrom;
}

export const emptyJobSeeker = (language: Language): JobSeekerDraft => ({
  dateOfBirth: '',
  ageConfirmed: false,
  fullName: '',
  gender: '',
  messageLanguage: language,
  area: '',
  pincode: '',
  pin: null,
  travelKm: null,
  trades: [{ trade: '', otherName: '', years: null }],
  availableFrom: '',
  salaryMinPaise: null,
  salaryMaxPaise: null,
  salaryPeriod: 'monthly',
  shift: '',
  jobType: '',
  languagesSpoken: [],
  heardFrom: 'laboura_app',
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
  if (!d.salaryMinPaise) e.salaryMin = 'form.required';
  if (!d.salaryMaxPaise) e.salaryMax = 'form.required';
  else if (d.salaryMinPaise && d.salaryMaxPaise < d.salaryMinPaise) e.salaryMax = 'jobSeeker.maxBelowMin';
  if (!d.shift) e.shift = 'form.required';
  if (!d.jobType) e.jobType = 'form.required';
  if (d.languagesSpoken.length === 0) e.languagesSpoken = 'form.required';
  return e;
}

/** Without a pin, the centre of the chosen area (an agent fixes it later). */
export function toJobSeekerForm(d: JobSeekerDraft, areas: Area[] = [], todayKey: string = todayKeyIstNow()): JobSeekerForm {
  const area = areas.find((a) => a.name === d.area);
  return {
    fullName: d.fullName.trim(),
    dateOfBirth: d.dateOfBirth,
    gender: d.gender as JobSeekerForm['gender'],
    messageLanguage: d.messageLanguage,
    // Not asked any more (owner, 24 Nov): the server still needs a window, so "any time, 9 AM to 9 PM".
    bestTimeToCall: '09-21',
    area: d.area,
    pincode: d.pincode.trim(),
    pin: d.pin ?? (area ? { latitude: area.latitude, longitude: area.longitude } : null),
    travelKm: d.travelKm ?? 0,
    trades: d.trades.map((row) =>
      row.trade === OTHER_TRADE ? { trade: 'other', otherName: row.otherName.trim(), years: row.years ?? 0 } : { trade: row.trade, years: row.years ?? 0 },
    ),
    availableFrom: d.availableFrom,
    // Not asked any more (owner, 24 Nov): looking from the day he registers.
    lookingSince: lookingSinceFrom('now', todayKey),
    salaryMinPaise: d.salaryMinPaise ?? 0,
    salaryMaxPaise: d.salaryMaxPaise ?? 0,
    salaryPeriod: d.salaryPeriod,
    shift: d.shift as Shift,
    jobType: d.jobType as JobSeekerForm['jobType'],
    languagesSpoken: d.languagesSpoken,
    heardFrom: d.heardFrom,
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
