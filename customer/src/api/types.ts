/**
 * What the customer app sends to and gets from the API.
 *
 * Written before the backend contract (docs/customer-app-api.md, Agent A)
 * existed, from the confirmed proposal (sections 2, 3, 4 and 8). When the doc
 * lands, the paths in `live.ts` and these shapes are aligned with it; screens
 * only ever see these types, so nothing else changes.
 *
 * Rules these types encode (the server enforces them too; the app never
 * relies on hiding alone):
 * - A job seeker never gets a business name before an interview is booked:
 *   `JobSeekerHome.interview` only exists once it is booked.
 * - A business never gets a candidate's phone number: no candidate type here
 *   has a phone field at all.
 * - A referral partner sees referred people by first name and stage only.
 * - Customer requests never name another person's record: the server works
 *   out "me" from the sign-in. Profile ids here are the signed-in person's own.
 */

export type Language = 'kn' | 'hi' | 'en';
export type ProfileKind = 'job_seeker' | 'business' | 'referral_partner';
export type StepState = 'done' | 'in_progress' | 'not_started';
export type SalaryPeriod = 'monthly' | 'daily';
export type Shift = 'day' | 'night' | 'rotational' | 'any';
export type HeardFrom = 'missed_call' | 'ad' | 'referral_partner' | 'field_visit' | 'social_media' | 'walk_in' | 'laboura_app';

// ---------------------------------------------------------------- account

export interface ProfileSummary {
  /** The signed-in person's link to this profile (not the record id). */
  id: string;
  kind: ProfileKind;
  /** JS-, BZ- or RF- code once the record exists. */
  code: string | null;
  /** Job seeker: first name. Business: board name. Partner: name. */
  displayName: string;
  /** Business only: what this person is at the business. */
  businessRole?: BusinessContactRole | null;
  /** Where the sign-up stands (proposal section 4.1). */
  stage: 'details' | 'verifying' | 'payment' | 'active' | 'paused' | 'closed';
}

export interface CustomerAccount {
  id: string;
  name: string | null;
  email: string | null;
  phoneVerified: boolean;
  /** Last 4 digits only. */
  phoneLast4: string | null;
  language: Language | null;
  signInMethods: ('phone' | 'google' | 'apple')[];
  profiles: ProfileSummary[];
  /** Shown on the privacy screen (grievance officer), from the server. */
  grievanceContact?: string | null;
}

export interface AuthResult {
  accessToken: string;
  refreshToken?: string | null;
  account: CustomerAccount;
}

export interface OtpSent {
  requestId: string;
  /** ISO time when "Resend" unlocks (30 s). */
  resendAvailableAt?: string | null;
  resendsLeft?: number | null;
  /** Test setup only: "Test mode code: 123456". */
  testModeBanner?: string;
}

export interface PhoneVerified {
  account: CustomerAccount;
  /** The number already belonged to a record an agent made: "We found your registration JS-1234". */
  linkedExisting?: { kind: ProfileKind; code: string }[];
}

// ---------------------------------------------------------------- form options

export interface Area {
  name: string;
  pincode: string;
  latitude: number;
  longitude: number;
}

export interface Trade {
  id: string;
  name: string;
  /** Typical Bengaluru range, paise per month (the hint under salary boxes). */
  salaryMinPaise: number;
  salaryMaxPaise: number;
  /** Legal minimum wage for this trade, paise per month. */
  legalMinimumPaise: number;
}

export interface FormOptions {
  areas: Area[];
  trades: Trade[];
}

export interface Pin {
  latitude: number;
  longitude: number;
  accuracyM?: number | null;
}

// ---------------------------------------------------------------- registration

export interface TradeYears {
  trade: string;
  /** Typed only when trade is "other". */
  otherName?: string | null;
  years: number;
}

export interface JobSeekerForm {
  fullName: string;
  dateOfBirth: string; // YYYY-MM-DD, 18+
  gender: 'male' | 'female' | 'other';
  messageLanguage: Language;
  bestTimeToCall: 'morning' | 'afternoon' | 'evening' | 'any';
  area: string;
  pincode: string;
  pin: Pin | null;
  travelKm: number;
  trades: TradeYears[]; // 1 to 3
  availableFrom: string; // YYYY-MM-DD
  lookingFor: 'just_started' | 'under_1_month' | '1_3_months' | 'over_3_months';
  salaryMinPaise: number;
  salaryMaxPaise: number;
  salaryPeriod: SalaryPeriod;
  shift: Shift;
  jobType: 'full_time' | 'part_time' | 'any';
  languagesSpoken: string[];
  heardFrom: HeardFrom;
  whatsappSame: boolean;
}

export type BusinessContactRole = 'owner' | 'manager' | 'hr' | 'supervisor' | 'other';
export type BusinessType =
  | 'restaurant_hotel' | 'bakery' | 'retail_shop' | 'supermarket' | 'apartment_society' | 'office' | 'factory'
  | 'warehouse' | 'hospital_clinic' | 'construction' | 'security_agency' | 'salon' | 'other';

export interface StaffNeeded {
  trade: string;
  count: number;
  salaryMinPaise: number | null;
  salaryMaxPaise: number | null;
  shift: Shift;
  startDate: string | null;
}

export interface BusinessForm {
  contactName: string;
  contactRole: BusinessContactRole;
  boardName: string;
  legalName: string;
  businessType: BusinessType;
  employeesNow: number;
  yearsRunning: number;
  shopNumber: string;
  street: string;
  landmark: string;
  area: string;
  pincode: string;
  pin: Pin | null;
  documents: { gstin?: string; fssai?: string; shopEstablishment?: string; udyamOrTradeLicence?: string; pan?: string };
  noDocuments: boolean;
  staffNeeded: StaffNeeded[];
  billingEmail: string;
  heardFrom: HeardFrom;
}

export interface ReferralForm {
  name: string;
  partnerType: 'individual' | 'business';
  individualKind?: 'auto_driver' | 'shop_staff' | 'security_guard' | 'existing_worker' | 'other' | null;
  businessType?: BusinessType | null;
  businessName?: string | null;
  area: string;
  pincode: string;
  pin: Pin | null;
  messageLanguage: Language;
}

export interface RegisterResult {
  profile: ProfileSummary;
  /** True when the number already had a record: the app continues it, no second record. */
  existing: boolean;
}

// ---------------------------------------------------------------- secure browser sheet

/**
 * What the sheet opens. The server issues a fresh link for the signed-in
 * person (the same link pages an agent sends by SMS, under /p/...).
 */
export type SheetPurpose = 'registration' | 'agreement' | 'document' | 'payment';

export interface SheetLink {
  url: string;
  expiresAt?: string | null;
}

// ---------------------------------------------------------------- homes

export interface JobSeekerHome {
  kind: 'job_seeker';
  code: string | null;
  firstName: string;
  steps: { phone: StepState; profile: StepState; consent: StepState; selfie: StepState; idCheck: StepState; payment: StepState };
  /** e.g. "UPI failed twice", "name didn't match" — already in the person's language. */
  stuckReason: string | null;
  payment: { status: 'not_paid' | 'confirming' | 'paid'; amountPaise: number };
  guarantee: {
    status: 'not_started' | 'running' | 'placed' | 'ended' | 'deactivated';
    day: number | null;
    totalDays: number;
    endsOn: string | null;
    hits: number;
    maxHits: number;
  };
  /** Exists ONLY once an interview is booked (no-bypass rule). */
  interview: null | {
    status: 'booked';
    startsAt: string;
    trade: string;
    businessName: string;
    address: string;
    latitude: number | null;
    longitude: number | null;
    replyDueAt: string | null;
  };
  refund: null | {
    status: 'due' | 'with_finance' | 'paid' | 'not_eligible';
    dueOn: string | null;
    amountPaise: number;
    upiRef: string | null;
  };
}

export type VacancyStatus = 'draft' | 'awaiting_otp' | 'waiting_for_visit' | 'open' | 'filled' | 'closed';

export interface VacancySummary {
  id: string;
  code: string | null;
  trade: string;
  roleTitle: string | null;
  openings: number;
  salaryMinPaise: number;
  salaryMaxPaise: number | null;
  salaryPeriod: SalaryPeriod;
  status: VacancyStatus;
  belowLegalMinimum: boolean;
}

export interface BusinessHome {
  kind: 'business';
  code: string | null;
  name: string;
  tracker: {
    phoneVerified: boolean;
    agreement: 'not_signed' | 'signed';
    visit: 'not_booked' | 'requested' | 'booked' | 'done';
    visitAt: string | null;
    /** First name of the field agent coming, once booked. */
    visitAgentFirstName: string | null;
    approval: 'waiting' | 'approved' | 'paused';
  };
  vacancies: VacancySummary[];
  counts: { interviewsUpcoming: number; placements: number };
}

export interface ReferralPerson {
  id: string;
  firstName: string;
  stage: 'registered' | 'paid' | 'interview' | 'joined' | 'closed';
  referredOn: string;
}

export interface PayoutLine {
  id: string;
  firstName: string;
  amountPaise: number;
  status: 'due' | 'approved' | 'paid';
  paidOn: string | null;
  upiRef: string | null;
}

export interface SignedDocument {
  id: string;
  kind: 'terms' | 'consent';
  signedAt: string;
}

export interface ReferralHome {
  kind: 'referral_partner';
  code: string | null;
  name: string;
  paused: boolean;
  pausedReason: string | null;
  steps: { terms: StepState; selfie: StepState; idCheck: StepState; upi: StepState };
  stuckReason: string | null;
  /** Personal link that registers people under this partner. */
  shareLink: string | null;
  referrals: ReferralPerson[];
  money: { rewardPaise: number; duePaise: number; approvedPaise: number; paidPaise: number; yearTotalPaise: number; payouts: PayoutLine[] };
  documents: SignedDocument[];
}

export type ProfileHome = JobSeekerHome | BusinessHome | ReferralHome;

// ---------------------------------------------------------------- vacancies

export interface VacancyDraft {
  trade: string;
  roleTitle: string | null;
  openings: number;
  salaryMinPaise: number;
  salaryMaxPaise: number | null;
  salaryPeriod: SalaryPeriod;
  shift: Shift;
  startDate: string;
  description: string;
  /** Required (true) when the salary is below the legal minimum wage. */
  legalMinimumAcknowledged: boolean;
}

// ---------------------------------------------------------------- help, privacy

export type CallbackTopic = 'registration' | 'payment' | 'interview' | 'refund' | 'business' | 'referral' | 'other';

export interface CallbackRequest {
  profileId: string | null;
  topic: CallbackTopic;
  /** "now" = within calling hours, as soon as an agent is free. */
  when: 'now' | 'later';
  date?: string | null;
  time?: string | null;
}

export interface DeletionResult {
  status: 'requested';
  /** What the law makes Laboura keep (payments, invoices), already in the person's language. */
  kept: string[];
}
