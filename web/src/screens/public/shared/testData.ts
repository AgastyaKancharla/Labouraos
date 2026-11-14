import type { PartnerOpen, RegistrationOpen } from './api';

/** A registration status as the API returns it after the OTP, for the public page tests. */
export function openStatus(overrides: Partial<RegistrationOpen> = {}): RegistrationOpen {
  return {
    otpRequired: false,
    maskedPhone: '******2345',
    language: null,
    firstName: 'Kavya',
    jobSeekerCode: 'JS-01042',
    currentStep: 'consent',
    steps: { consent: false, selfie: false, idCheck: false, payment: false },
    idCheck: { waitingForTeamLead: false, lastResult: 'none' },
    stopped: null,
    waitingForTrade: false,
    termsAcceptedAt: null,
    payment: { state: 'not_started', amountPaise: 49900, upiReference: null, confirmedAt: null, guaranteeEndsAt: null, paymentId: null },
    receiptToken: null,
    ...overrides,
  };
}

export const TOKEN = 'tok123';
export const QR_SVG = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1 1"><rect width="1" height="1"/></svg>';

/** Pretend the person already verified the code on P00 in this tab. */
export function verifiedInThisTab(token = TOKEN, requestId = 'req-1') {
  sessionStorage.setItem(`laboura_reg_otp:${token}`, requestId);
}

/** A referral partner's link status after the code (ReferralRegistrationController). */
export function partnerStatus(overrides: Partial<PartnerOpen> = {}): PartnerOpen {
  return {
    otpRequired: false,
    maskedPhone: '******3210',
    language: null,
    firstName: 'Ramesh K.',
    referralCode: 'RF-00031',
    partnerType: 'individual',
    currentStep: 'terms',
    steps: { terms: { state: 'not_started' }, selfie: { state: 'stuck' }, id: { state: 'not_started' }, upi: { state: 'not_started' } },
    idCheck: { waitingForTeamLead: false, lastResult: 'none' },
    stopped: null,
    payout: null,
    ...overrides,
  };
}

/** Pretend the partner already verified the code on the first page in this tab. */
export function partnerVerifiedInThisTab(token = TOKEN, requestId = 'req-1') {
  sessionStorage.setItem(`laboura_partner_otp:${token}`, requestId);
}

export const DONE = { state: 'done' } as const;
