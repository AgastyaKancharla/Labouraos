import { createApiClient, type ApiClient } from '@/api/client';
import { isApiError } from '@/api/errors';
import type {
  AadhaarQrResult,
  AgreementDetails,
  LegalDocument,
  OtherIdResult,
  OtherIdType,
  OtpSent,
  PartnerOpen,
  PartnerPayout,
  PartnerStatus,
  PartnerTerms,
  PaymentSummary,
  PhotoFile,
  RegistrationOpen,
  RegistrationStatus,
  RegistrationTerms,
} from './types';

/**
 * The native verification steps (consent, selfie, ID check, terms and ₹499,
 * the referral partner's steps, the business agreement) call the SAME
 * endpoints as the SMS link pages, with the person's own link token — the
 * app gets it from POST /me/profiles/:id/links for the signed-in person.
 * So every server check stays exactly as it is: the code sent to the
 * person's own number for that link (AC-3), the live-camera rules, the
 * Aadhaar QR check, the terms text hash, the payment rules. Nothing new on
 * the server.
 */
export interface StepsApi {
  // Job seeker registration (/registration/:token/…)
  registrationStatus(token: string, requestId?: string | null): Promise<RegistrationStatus>;
  sendLinkOtp(token: string): Promise<OtpSent>;
  verifyRegistrationOtp(token: string, requestId: string, code: string): Promise<RegistrationOpen>;
  legalDocument(key: 'job_seeker_terms' | 'business_agreement' | 'referral_terms'): Promise<LegalDocument>;
  submitConsent(token: string, requestId: string, purposes: string[], textHash?: string): Promise<{ success: boolean }>;
  registrationSelfie(token: string, requestId: string, photo: PhotoFile): Promise<unknown>;
  registrationAadhaarQr(token: string, requestId: string, qrText: string): Promise<AadhaarQrResult>;
  registrationCaptureNonce(token: string, requestId: string): Promise<{ captureNonce: string; expiresInSeconds: number }>;
  registrationOtherId(token: string, requestId: string, idType: OtherIdType, idNumber: string, photo: PhotoFile, captureNonce: string): Promise<OtherIdResult>;
  registrationTerms(token: string, requestId: string): Promise<RegistrationTerms>;
  acceptRegistrationTerms(token: string, requestId: string): Promise<{ payment: { upiReference: string; amountPaise: number } }>;
  sendPaymentOnlyLink(token: string, requestId: string, phone: string): Promise<{ expiresAt: string }>;
  paymentSummary(payPageToken: string): Promise<PaymentSummary>;
  utrHint(payPageToken: string, utr: string): Promise<{ saved: boolean }>;

  // Referral partner (/referral-registration/:token/…)
  partnerStatus(token: string, requestId?: string | null): Promise<PartnerStatus>;
  verifyPartnerOtp(token: string, requestId: string, code: string): Promise<PartnerOpen>;
  partnerTerms(token: string, requestId: string): Promise<PartnerTerms>;
  acceptPartnerTerms(token: string, requestId: string): Promise<{ success: boolean }>;
  partnerSelfie(token: string, requestId: string, photo: PhotoFile): Promise<unknown>;
  partnerAadhaarQr(token: string, requestId: string, qrText: string): Promise<AadhaarQrResult & { nextStep?: string }>;
  partnerCaptureNonce(token: string, requestId: string): Promise<{ captureNonce: string; expiresInSeconds: number }>;
  partnerOtherId(token: string, requestId: string, idType: OtherIdType, idNumber: string, photo: PhotoFile, captureNonce: string): Promise<OtherIdResult & { nextStep?: string }>;
  partnerPayout(token: string, requestId: string, details: PartnerPayout): Promise<{ id: string; maskedValue: string; status: string }>;

  // Business agreement (/consent/:token)
  agreementDetails(token: string): Promise<AgreementDetails>;
  agreementSigned(token: string): Promise<{ signedAt: string; signedName: string; businessName: string }>;
  signAgreement(token: string, otpRequestId: string, otpCode: string, signedName: string): Promise<{ signedAt: string }>;
}

const enc = encodeURIComponent;
const PUBLIC = { auth: false } as const;
/** Photo uploads on slow signal get longer than the usual 20 seconds. */
const UPLOAD_TIMEOUT_MS = 60_000;

function photoForm(fields: Record<string, string>, photo: PhotoFile): FormData {
  const form = new FormData();
  for (const [key, value] of Object.entries(fields)) form.append(key, value);
  // The server refuses anything not marked as a live camera capture.
  form.append('captureSource', 'live_camera');
  // React Native's FormData takes a { uri, name, type } file part.
  form.append('photo', photo as unknown as Blob);
  return form;
}

/** The link endpoints at the API's root (no /customer-api prefix, no customer token). */
export function liveStepsApi(baseUrl: string, fetchImpl?: typeof fetch): StepsApi {
  const api: ApiClient = createApiClient({ baseUrl, getToken: () => null, onUnauthorized: () => undefined, fetchImpl });
  const upload = <T>(path: string, form: FormData) => api.request<T>(path, { method: 'POST', form, auth: false, timeoutMs: UPLOAD_TIMEOUT_MS });
  return {
    registrationStatus: (token, requestId) => api.get(`/registration/${enc(token)}/status`, { ...PUBLIC, query: { requestId: requestId ?? undefined } }),
    sendLinkOtp: (token) => api.post('/consent/send-otp', { token }, PUBLIC),
    verifyRegistrationOtp: (token, requestId, code) => api.post(`/registration/${enc(token)}/verify-otp`, { requestId, code }, PUBLIC),
    legalDocument: (key) => api.get(`/legal/documents/${key}`, { ...PUBLIC, query: { lang: 'en' } }),
    submitConsent: (token, requestId, purposes, textHash) =>
      api.post('/consent/submit', { token, otpRequestId: requestId, purposes, language: 'en', ...(textHash ? { textHash } : {}) }, PUBLIC),
    registrationSelfie: (token, requestId, photo) => upload(`/registration/${enc(token)}/selfie`, photoForm({ requestId }, photo)),
    registrationAadhaarQr: (token, requestId, qrText) => api.post(`/registration/${enc(token)}/aadhaar-qr`, { requestId, qrText }, PUBLIC),
    registrationCaptureNonce: (token, requestId) => api.post(`/registration/${enc(token)}/other-id/capture-nonce`, { requestId }, PUBLIC),
    registrationOtherId: (token, requestId, idType, idNumber, photo, captureNonce) =>
      upload(`/registration/${enc(token)}/other-id`, photoForm({ requestId, idType, idNumber, captureNonce }, photo)),
    registrationTerms: (token, requestId) => api.get(`/registration/${enc(token)}/terms`, { ...PUBLIC, query: { requestId } }),
    acceptRegistrationTerms: (token, requestId) => api.post(`/registration/${enc(token)}/terms-and-payment`, { requestId, acceptTerms: true, language: 'en' }, PUBLIC),
    sendPaymentOnlyLink: (token, requestId, phone) => api.post(`/registration/${enc(token)}/payment-only-link`, { requestId, phone }, PUBLIC),
    paymentSummary: (payPageToken) => api.get(`/payments/request/${enc(payPageToken)}/summary`, PUBLIC),
    utrHint: (payPageToken, utr) => api.post(`/payments/request/${enc(payPageToken)}/utr-hint`, { utr }, PUBLIC),

    partnerStatus: (token, requestId) => api.get(`/referral-registration/${enc(token)}/status`, { ...PUBLIC, query: { requestId: requestId ?? undefined } }),
    verifyPartnerOtp: (token, requestId, code) => api.post(`/referral-registration/${enc(token)}/verify-otp`, { requestId, code }, PUBLIC),
    partnerTerms: (token, requestId) => api.get(`/referral-registration/${enc(token)}/terms`, { ...PUBLIC, query: { requestId } }),
    // Referral Partner Terms v1.0: the terms, call recording and the separate ID-check consent (S2).
    acceptPartnerTerms: (token, requestId) =>
      api.post('/consent/submit', { token, otpRequestId: requestId, purposes: ['agreement_terms', 'call_recording', 'aadhaar_verification'], language: 'en' }, PUBLIC),
    partnerSelfie: (token, requestId, photo) => upload(`/referral-registration/${enc(token)}/selfie`, photoForm({ requestId }, photo)),
    partnerAadhaarQr: (token, requestId, qrText) => api.post(`/referral-registration/${enc(token)}/aadhaar-qr`, { requestId, qrText }, PUBLIC),
    partnerCaptureNonce: (token, requestId) => api.post(`/referral-registration/${enc(token)}/other-id/capture-nonce`, { requestId }, PUBLIC),
    partnerOtherId: (token, requestId, idType, idNumber, photo, captureNonce) =>
      upload(`/referral-registration/${enc(token)}/other-id`, photoForm({ requestId, idType, idNumber, captureNonce }, photo)),
    partnerPayout: (token, requestId, details) => api.post(`/referral-registration/${enc(token)}/upi`, { otpRequestId: requestId, ...details }, PUBLIC),

    agreementDetails: (token) => api.get(`/consent/${enc(token)}`, PUBLIC),
    agreementSigned: (token) => api.get(`/consent/${enc(token)}/signed`, PUBLIC),
    // v1.1 "Signing by OTP": terms, authority and call recording — three ticks.
    signAgreement: (token, otpRequestId, otpCode, signedName) =>
      api.post('/consent/submit', { token, otpRequestId, otpCode, signedName, purposes: ['agreement_terms', 'agreement_authority', 'call_recording'] }, PUBLIC),
  };
}

/** The token at the end of the link the server issued (…/p/register/<token>, …/p/partner/<token>, …/p/agreement/<token>). */
export function tokenFromLink(url: string): string | null {
  const path = url.split(/[?#]/)[0] ?? '';
  const last = path.split('/').filter(Boolean).pop();
  return last && /^[A-Za-z0-9_-]{16,}$/.test(last) ? decodeURIComponent(last) : null;
}

/** The code for this link ran out (or was never verified): back to the code step; finished steps stay finished. */
export function isCodeExpired(error: unknown): boolean {
  // Only the server's "no verified code for this link" answers (registration, partner and consent
  // controllers) — not any message that happens to say "code" (e.g. "A valid IFSC code is required").
  return isApiError(error) && error.status === 400 && CODE_EXPIRED.test(error.message);
}

const CODE_EXPIRED = /OTP to the registered mobile is required|OTP verification is required|Valid owner OTP is required|Invalid or expired OTP|Wrong or expired code/i;

/** The link was already used up (the agreement is signed, the partner's payout details saved). */
export function isLinkUsed(error: unknown): boolean {
  return isApiError(error) && /already been used/i.test(error.message);
}

/** Pages the person opens in the browser from a step: the signed agreement and the ₹499 receipt (link-page routes at the API root). */
export function agreementCopyUrl(baseUrl: string, token: string): string {
  return `${baseUrl.replace(/\/$/, '')}/consent/${encodeURIComponent(token)}/signed/copy`;
}

export function receiptUrl(baseUrl: string, paymentId: string, receiptToken: string): string {
  return `${baseUrl.replace(/\/$/, '')}/payments/${encodeURIComponent(paymentId)}/receipt?token=${encodeURIComponent(receiptToken)}`;
}
