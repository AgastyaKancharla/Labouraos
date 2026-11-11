import { api } from '../../../lib/api/client';
import { ApiError, apiErrorFromBody } from '../../../lib/api/errors';

/**
 * The public phone pages (P00…P06) call the token endpoints without a staff
 * login. Every response type here mirrors the Nest controller it names.
 */
const PUBLIC = { auth: false } as const;
const enc = encodeURIComponent;

export type PublicLanguage = 'kn' | 'hi' | 'en';

// ---- Registration link (RegistrationController, ConsentController) ----

export type RegistrationStep = 'consent' | 'selfie' | 'id_check' | 'payment' | 'complete';
export type RegistrationPaymentState = 'not_started' | 'pending' | 'confirming' | 'failed' | 'confirmed';

export interface RegistrationLocked {
  otpRequired: true;
  maskedPhone: string;
  language: PublicLanguage | null;
  registrationComplete: boolean;
}

export interface RegistrationOpen {
  otpRequired: false;
  maskedPhone: string;
  language: PublicLanguage | null;
  firstName: string;
  jobSeekerCode: string;
  currentStep: RegistrationStep;
  steps: { consent: boolean; selfie: boolean; idCheck: boolean; payment: boolean };
  idCheck: { serviceDown: boolean; waitingForService: boolean; lastResult: 'none' | 'verified' | 'name_mismatch' | 'under_18' | 'failed' };
  stopped: 'under_18' | null;
  waitingForTrade: boolean;
  termsAcceptedAt: string | null;
  payment: {
    state: RegistrationPaymentState;
    amountPaise: number;
    upiReference: string | null;
    confirmedAt: string | null;
    guaranteeEndsAt: string | null;
    paymentId: string | null;
  };
  receiptToken: string | null;
}

export type RegistrationStatus = RegistrationLocked | RegistrationOpen;

export interface RegistrationTerms {
  jobSeekerCode: string;
  trade: string | null;
  travelDistanceKm: number | null;
  shiftPreference: string | null;
  guaranteeFloorPaise: number;
  guaranteeDays: number;
  amountPaise: number;
  termsAcceptedAt: string | null;
}

export interface IdCheckResult {
  status: string;
  method: string;
  nameMatches: boolean | null;
  isAdult: boolean | null;
  failureReason: string | null;
}

export interface OtpSent {
  requestId: string;
  phone: string;
}

export const registrationApi = {
  status: (token: string, requestId?: string | null) =>
    api.get<RegistrationStatus>(`/registration/${enc(token)}/status`, { ...PUBLIC, query: { requestId: requestId ?? undefined } }),
  sendOtp: (token: string) => api.post<OtpSent>('/consent/send-otp', { token }, PUBLIC),
  verifyOtp: (token: string, requestId: string, code: string) =>
    api.post<RegistrationOpen>(`/registration/${enc(token)}/verify-otp`, { requestId, code }, PUBLIC),
  consent: (token: string, requestId: string, purposes: string[], language: PublicLanguage) =>
    api.post<{ success: boolean }>('/consent/submit', { token, otpRequestId: requestId, purposes, language }, PUBLIC),
  idCheck: (token: string, requestId: string, method: string, documentNumber?: string) =>
    api.post<IdCheckResult>(`/registration/${enc(token)}/id-check`, { requestId, method, ...(documentNumber ? { documentNumber } : {}) }, PUBLIC),
  waitForIdService: (token: string, requestId: string) =>
    api.post<{ waitingForRecovery: boolean }>(`/registration/${enc(token)}/id-check-wait`, { requestId }, PUBLIC),
  terms: (token: string, requestId: string) =>
    api.get<RegistrationTerms>(`/registration/${enc(token)}/terms`, { ...PUBLIC, query: { requestId } }),
  acceptTerms: (token: string, requestId: string) =>
    api.post<{ payment: { upiReference: string; amountPaise: number } }>(
      `/registration/${enc(token)}/terms-and-payment`,
      { requestId, acceptTerms: true },
      PUBLIC,
    ),
  sendPaymentOnlyLink: (token: string, requestId: string, phone: string) =>
    api.post<{ expiresAt: string }>(`/registration/${enc(token)}/payment-only-link`, { requestId, phone }, PUBLIC),
  /** Live camera frame only (the API refuses anything without captureSource=live_camera). */
  async selfie(token: string, requestId: string, photo: Blob): Promise<void> {
    const form = new FormData();
    form.append('requestId', requestId);
    form.append('captureSource', 'live_camera');
    form.append('photo', photo, 'selfie.jpg');
    let response: Response;
    try {
      response = await fetch(`/registration/${enc(token)}/selfie`, { method: 'POST', body: form, headers: { Accept: 'application/json' } });
    } catch {
      throw new ApiError({ status: 0, messages: ['Could not reach Laboura. Check the internet connection and try again.'], isNetworkError: true });
    }
    if (!response.ok) {
      let body: unknown;
      try {
        body = await response.json();
      } catch {
        body = undefined;
      }
      throw apiErrorFromBody(response.status, body);
    }
  },
};

// ---- Payment request by UPI reference (PaymentController) ----

export interface PaymentPage {
  amountPaise: number;
  payeeName: string;
  upiReference: string;
  upiUri: string;
  qrSvg: string;
}

export interface PaymentSummary {
  type: 'activation' | 'placement_fee';
  state: 'pending' | 'confirming' | 'received' | 'closed';
  amountPaise: number;
  upiReference: string;
  confirmedAt: string | null;
  language: PublicLanguage | null;
  jobSeeker: { firstName: string | null; code: string } | null;
  placement: {
    candidateFirstName: string | null;
    businessName: string;
    agreedSalaryPaise: number;
    feePercent: number | null;
    placementFeePaise: number;
    gstPercent: number | null;
    gstPaise: number;
    paymentDueAt: string | null;
  } | null;
  pay: PaymentPage | null;
  receipt: { paymentId: string; token: string } | null;
  invoicePath: string | null;
}

export const paymentApi = {
  summary: (reference: string) => api.get<PaymentSummary>(`/payments/request/${enc(reference)}/summary`, PUBLIC),
  utrHint: (reference: string, utr: string) => api.post<{ saved: boolean }>(`/payments/request/${enc(reference)}/utr-hint`, { utr }, PUBLIC),
};

export function receiptHref(receipt: { paymentId: string; token: string }): string {
  return `/payments/${enc(receipt.paymentId)}/receipt?token=${enc(receipt.token)}`;
}

// ---- Payment-only link (someone else pays) ----

export interface PaymentOnlyInfo {
  maskedPhone: string;
  language: PublicLanguage | null;
  expiresAt: string;
}

export interface PaymentOnlyDetails {
  firstName: string;
  displayName: string;
  jobSeekerCode: string;
  amountPaise: number;
  linkExpiresAt: string;
  language: PublicLanguage | null;
  payment: PaymentPage;
}

export const paymentOnlyApi = {
  info: (token: string) => api.get<PaymentOnlyInfo>(`/registration/payment/${enc(token)}/info`, PUBLIC),
  sendOtp: (token: string) => api.post<OtpSent>(`/registration/payment/${enc(token)}/send-otp`, {}, PUBLIC),
  verify: (token: string, requestId: string, code: string) =>
    api.post<PaymentOnlyDetails>(`/registration/payment/${enc(token)}/verify-otp`, { requestId, code }, PUBLIC),
  details: (token: string, requestId: string) =>
    api.get<PaymentOnlyDetails>(`/registration/payment/${enc(token)}`, { ...PUBLIC, query: { requestId } }),
};

// ---- Interviews (InterviewController) ----

export interface OfferDetails {
  firstName: string;
  job: string;
  area: string;
  salaryMinPaise: number | null;
  salaryMaxPaise: number | null;
  salaryPeriod: string;
  shift: string | null;
  slotStartsAt: string;
  slotEndsAt: string;
  replyDueAt: string;
  awaitingReply: boolean;
  belowGuaranteeFloor: boolean;
  language: string | null;
}

export interface BookedDetails {
  businessName: string;
  address: string;
  area: string;
  slotStartsAt: string;
  slotEndsAt: string;
  contactPerson: string;
}

export interface OwnerResultDetails {
  candidateFirstName: string;
  businessName: string;
  job: string;
  slotStartsAt: string;
  slotEndsAt: string;
  resultDueAt: string;
  vacancySalaryMinPaise: number | null;
  maskedPhone: string;
  awaitingResult: boolean;
  reasons: string[];
  language: string | null;
}

export type OwnerResult = 'selected' | 'not_selected' | 'candidate_no_show';

export interface OwnerResultResponse {
  status: string;
  result: OwnerResult;
  placement: { payment: { upiReference: string | null } | null } | null;
}

export interface OfferCheckDetails {
  firstName: string;
  businessName: string;
  slotStartsAt: string;
  answered: boolean;
  language: string | null;
}

export const interviewApi = {
  offer: (token: string) => api.get<OfferDetails>(`/interviews/reply/${enc(token)}`, PUBLIC),
  reply: (token: string, answer: 'yes' | 'no') =>
    api.post<{ status: string; booked?: BookedDetails }>(`/interviews/reply/${enc(token)}`, { answer }, PUBLIC),
  ownerResult: (token: string) => api.get<OwnerResultDetails>(`/interviews/result/${enc(token)}`, PUBLIC),
  sendOwnerOtp: (token: string) => api.post<OtpSent>(`/interviews/result/${enc(token)}/otp`, {}, PUBLIC),
  submitOwnerResult: (
    token: string,
    body: { otpRequestId: string; otpCode: string; result: OwnerResult; resultReason?: string; selectedSalaryPaise?: number; selectedJoiningDate?: string },
  ) => api.post<OwnerResultResponse>(`/interviews/result/${enc(token)}`, body, PUBLIC),
  offerCheck: (token: string) => api.get<OfferCheckDetails>(`/interviews/check/${enc(token)}`, PUBLIC),
  answerOfferCheck: (token: string, answer: 'yes' | 'no') => api.post<{ candidateCheckAnswer: string }>(`/interviews/check/${enc(token)}`, { answer }, PUBLIC),
};

// ---- Business agreement (ConsentController) ----

export interface AgreementDetails {
  subjectType: 'business';
  businessName: string;
  maskedPhone: string;
  preferredLanguage: string;
  agreementTermsHtml: string;
  ownerName: string | null;
  terms: { feePercent: number; gstPercent: number; noBypassMonths: number; noBypassPenaltyPercent: number };
  guarantee: { replacementWindowDays: number; maxFreeReplacements: number; replacementSearchDays: number };
}

export interface SignedAgreement {
  signedAt: string;
  signedName: string;
  businessName: string;
  preferredLanguage: string;
}

export const agreementApi = {
  details: (token: string) => api.get<AgreementDetails>(`/consent/${enc(token)}`, PUBLIC),
  signed: (token: string) => api.get<SignedAgreement>(`/consent/${enc(token)}/signed`, PUBLIC),
  copyHref: (token: string) => `/consent/${enc(token)}/signed/copy`,
  sendOtp: (token: string) => api.post<OtpSent>('/consent/send-otp', { token }, PUBLIC),
  sign: (token: string, otpRequestId: string, otpCode: string, signedName: string) =>
    api.post<{ signedAt: string }>(
      '/consent/submit',
      { token, otpRequestId, otpCode, signedName, purposes: ['agreement_terms', 'call_recording'] },
      PUBLIC,
    ),
};
