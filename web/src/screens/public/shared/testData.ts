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

/** A legal document as GET /legal/documents/:key returns it (rev 176), for the public page tests. */
export function legalDocument(key: 'job_seeker_terms' | 'business_agreement' | 'referral_terms' = 'job_seeker_terms') {
  const ticks =
    key === 'job_seeker_terms'
      ? [
          { purpose: 'job_matching', required: true, title: '1. Match me to jobs', description: 'I consent to Laboura matching my profile.' },
          { purpose: 'profile_sharing', required: true, title: '2. Share my profile', description: 'Card items only, never my phone number.' },
          { purpose: 'call_recording', required: true, title: '3. Record calls', description: 'Calls are recorded.' },
          { purpose: 'aadhaar_verification', required: true, title: '4. Check my ID', description: 'Aadhaar Secure QR or another ID.' },
          { purpose: 'job_updates', required: true, title: '5. Job updates', description: 'SMS, WhatsApp and phone.' },
          { purpose: 'promotions', required: false, title: '6. Offers and news (optional)', description: 'Optional.' },
        ]
      : key === 'referral_terms'
        ? [
            { purpose: 'agreement_terms', required: true, title: 'Referral Partner Terms', description: 'I agree to these terms.' },
            { purpose: 'call_recording', required: true, title: 'Call recording', description: 'Calls are recorded.' },
            { purpose: 'aadhaar_verification', required: true, title: 'ID check and selfie', description: 'Only what clause 9.2 lists.' },
          ]
        : [];
  return {
    key,
    version: key === 'referral_terms' ? '1.0' : key === 'job_seeker_terms' ? '1.2' : '1.1',
    language: 'en',
    title: 'Terms',
    summary: ['You pay ₹499 once.'],
    summaryHtml: '<section class="lb-legal__short"><h2>In short</h2><ul><li>You pay <strong>₹499</strong> once.</li></ul></section>',
    bodyHtml: '<section class="lb-legal__full"><h3>1. What Laboura does</h3><p>Full text.</p></section>',
    hash: 'abc',
    noticeVersion: key === 'job_seeker_terms' ? '1.3' : null,
    consentNotice: key === 'job_seeker_terms' ? 'Your 30 days start only after your government ID is verified. Until then your registration is paused.' : null,
    consents: ticks.map((t) => ({ ...t, withdrawal: null })),
  };
}
