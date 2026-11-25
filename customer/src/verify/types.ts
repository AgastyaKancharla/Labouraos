/**
 * The answers of the link-page endpoints the native verification steps call
 * (the same ones the SMS link pages use: RegistrationController,
 * ReferralRegistrationController, ConsentController, PaymentController,
 * LegalController). Mirrors web/src/screens/public/shared/api.ts.
 */

export type RegistrationStep = 'consent' | 'selfie' | 'id_check' | 'payment' | 'complete';
export type RegistrationPaymentState = 'not_started' | 'pending' | 'confirming' | 'failed' | 'confirmed';

/** photo_expired: the photo of another ID card expired before a Team Lead checked it — take a new one (rev 169). */
export type IdLastResult = 'none' | 'verified' | 'pending' | 'name_mismatch' | 'under_18' | 'photo_expired' | 'failed';

export interface ReconsentView {
  documentKey: string;
  currentVersion: string;
  acceptedVersion: string | null;
  needsReconsent: boolean;
}

export interface LinkLocked {
  otpRequired: true;
  maskedPhone: string;
  registrationComplete: boolean;
}

export interface RegistrationOpen {
  otpRequired: false;
  maskedPhone: string;
  firstName: string;
  jobSeekerCode: string;
  currentStep: RegistrationStep;
  steps: { consent: boolean; selfie: boolean; idCheck: boolean; payment: boolean };
  consentGiven?: string[];
  idCheck: { waitingForTeamLead: boolean; lastResult: IdLastResult };
  stopped: 'under_18' | null;
  waitingForTrade: boolean;
  termsAcceptedAt: string | null;
  reconsent?: ReconsentView | null;
  payment: {
    state: RegistrationPaymentState;
    amountPaise: number;
    upiReference: string | null;
    confirmedAt: string | null;
    guaranteeEndsAt: string | null;
    paymentId: string | null;
  };
  receiptToken: string | null;
  payPageToken?: string | null;
}

export type RegistrationStatus = LinkLocked | RegistrationOpen;

export interface RegistrationTerms {
  jobSeekerCode: string;
  trade: string | null;
  travelDistanceKm: number | null;
  locality: string | null;
  shiftPreference: string | null;
  jobType: string | null;
  guaranteeFloorPaise: number;
  guaranteeDays: number;
  amountPaise: number;
  termsAcceptedAt: string | null;
  termsVersion?: string;
}

export interface AadhaarQrResult {
  verificationId: string | null;
  method: 'aadhaar_qr';
  status: 'verified' | 'failed';
  result: 'verified' | 'name_mismatch' | 'under_18' | 'bad_signature' | 'cert_missing' | 'old_qr' | 'unreadable';
  verifiedByUidai: boolean;
  nameMatches: boolean | null;
  isAdult: boolean | null;
  phoneLinked: 'linked' | 'not_linked' | 'unknown' | null;
  /** XXXX-XXXX-1234 */
  maskedReference: string | null;
  person: { name: string; dateOfBirth: string; gender: 'M' | 'F' | 'T' | null } | null;
  failureReason: string | null;
  dateOfBirthUnreadable?: boolean;
  offerOtherId: boolean;
}

export type OtherIdType = 'pan' | 'driving_licence' | 'voter_id';

export interface OtherIdResult {
  verificationId: string;
  method: OtherIdType;
  status: 'pending';
  idNumberLast4: string;
}

export interface OtpSent {
  requestId: string;
  phone: string;
}

export interface LegalTick {
  purpose: string;
  required: boolean;
  title: string;
  description: string;
}

export interface LegalDocument {
  key: string;
  version: string;
  title: string;
  summary: string[];
  summaryHtml: string;
  bodyHtml: string;
  hash: string;
  consents: LegalTick[];
}

export interface PaymentPage {
  amountPaise: number;
  payeeName: string;
  upiReference: string;
  upiUri: string;
  qrSvg: string;
}

export interface PaymentSummary {
  paymentOnlyLinkMinutes?: number | null;
  type: 'activation' | 'placement_fee';
  state: 'pending' | 'confirming' | 'received' | 'closed';
  stopped?: boolean;
  underReview?: boolean;
  amountPaise: number;
  upiReference: string;
  confirmedAt: string | null;
  pay: PaymentPage | null;
}

// ---- Referral partner ----

export type PartnerStep = 'terms' | 'selfie' | 'id_check' | 'upi' | 'complete';
export type PartnerStepState = 'done' | 'in_progress' | 'not_started' | 'stuck';

export interface PartnerOpen {
  otpRequired: false;
  maskedPhone: string;
  firstName: string;
  referralCode: string;
  partnerType: 'individual' | 'business';
  currentStep: PartnerStep;
  reconsent?: ReconsentView | null;
  steps: { terms: { state: PartnerStepState }; selfie: { state: PartnerStepState }; id: { state: PartnerStepState }; upi: { state: PartnerStepState } };
  idCheck: { waitingForTeamLead: boolean; lastResult: IdLastResult };
  stopped: 'under_18' | null;
  payout: { method: 'upi' | 'bank'; maskedValue: string; status: string; nameMatches: boolean | null } | null;
}

export type PartnerStatus = LinkLocked | PartnerOpen;

export interface PartnerTerms {
  referralPayoutPaise: number;
  version: string | null;
  termsHtml: string;
  summaryHtml?: string | null;
  bodyHtml?: string | null;
  payoutDetailsCoolingHours: number;
  activationFeePaise: number;
}

export type PartnerPayout = { method: 'upi'; upiId: string } | { method: 'bank'; accountNumber: string; ifsc: string };

// ---- Business agreement ----

export interface AgreementDetails {
  businessName: string;
  maskedPhone: string;
  agreementTermsHtml: string;
  agreementSummaryHtml?: string | null;
  agreementBodyHtml?: string | null;
  version?: string;
  ownerName: string | null;
  terms: { feePercent: number; gstPercent: number; noBypassMonths: number; noBypassPenaltyPercent: number };
  guarantee: { replacementWindowDays: number; maxFreeReplacements: number; replacementSearchDays: number };
  /** 25 Nov (rev 211–212): the owner's live photos taken so far; signing waits for both. */
  ownerPhotos?: OwnerPhotoState | null;
}

export type ShopPhotoKind = 'shop_board' | 'fssai_with_owner' | 'workspace';
export interface OwnerPhotoState {
  selfie: boolean;
  shop: boolean;
  shopKind: ShopPhotoKind;
  shopKinds: ShopPhotoKind[];
  smallBusiness?: boolean;
}

/** The phone's place for the shop photo, or that it was refused / not available. */
export interface PhotoPlace {
  latitude?: number;
  longitude?: number;
  accuracyMeters?: number;
  locationStatus?: 'refused' | 'unavailable';
}

/** What the owner's interview result page (P05) shows. */
export interface InterviewResultDetails {
  candidateFirstName: string;
  businessName: string;
  job: string;
  slotStartsAt: string;
  slotEndsAt: string;
  resultDueAt: string | null;
  vacancySalaryMinPaise: number | null;
  maskedPhone: string;
  awaitingResult: boolean;
  reasons: string[];
}

export type InterviewResultValue = 'selected' | 'not_selected' | 'candidate_no_show';
export interface InterviewResultInput {
  result: InterviewResultValue;
  resultReason?: string;
  selectedSalaryPaise?: number;
  selectedJoiningDate?: string;
}

export interface SignedAgreement {
  signedAt: string;
  signedName: string;
  businessName: string;
}

/** A photo on the phone, ready to send as multipart (React Native FormData file part). */
export interface PhotoFile {
  uri: string;
  name: string;
  type: 'image/jpeg';
}
