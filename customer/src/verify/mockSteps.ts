import { ApiError } from '@/api/errors';
import type { StepsApi } from './stepsApi';
import type { LegalDocument, PartnerOpen, RegistrationOpen } from './types';

/**
 * Pretend link endpoints for EXPO_PUBLIC_API_MODE=mock: every step can be
 * clicked through with no server. Any 6-digit code works; the Aadhaar QR is
 * always "verified"; payment confirms a few seconds after "Pay".
 */
export function mockStepsApi(delayMs = 300): StepsApi {
  const wait = <T>(make: () => T): Promise<T> => new Promise((resolve, reject) => setTimeout(() => {
    try {
      resolve(make());
    } catch (e) {
      reject(e);
    }
  }, delayMs));
  const verified = new Set<string>();
  const reg: RegistrationOpen = {
    otpRequired: false,
    maskedPhone: '+91 ••••• •4321',
    firstName: 'Ravi',
    jobSeekerCode: 'JS-00001',
    currentStep: 'consent',
    steps: { consent: false, selfie: false, idCheck: false, payment: false },
    idCheck: { waitingForTeamLead: false, lastResult: 'none' },
    stopped: null,
    waitingForTrade: false,
    termsAcceptedAt: null,
    payment: { state: 'not_started', amountPaise: 49900, upiReference: null, confirmedAt: null, guaranteeEndsAt: null, paymentId: null },
    receiptToken: null,
    payPageToken: null,
  };
  const partner: PartnerOpen = {
    otpRequired: false,
    maskedPhone: '+91 ••••• •4321',
    firstName: 'Suma',
    referralCode: 'RF-00001',
    partnerType: 'individual',
    currentStep: 'terms',
    steps: { terms: { state: 'not_started' }, selfie: { state: 'not_started' }, id: { state: 'not_started' }, upi: { state: 'not_started' } },
    idCheck: { waitingForTeamLead: false, lastResult: 'none' },
    stopped: null,
    payout: null,
  };
  let paidAt: number | null = null;
  let signed: { signedAt: string; signedName: string } | null = null;
  const locked = (token: string) => ({ otpRequired: true as const, maskedPhone: '+91 ••••• •4321', registrationComplete: false, token });
  const needCode = (requestId: string) => {
    if (!verified.has(requestId)) throw new ApiError({ status: 400, messages: ['OTP to the registered mobile is required'] });
  };
  const doc = (key: string): LegalDocument => ({
    key,
    version: '1.1',
    title: 'Laboura terms',
    summary: ['<strong>₹499</strong> to register; a full refund if there is no job offer in 30 days.', 'We call you only between 9 AM and 9 PM.'],
    summaryHtml: '',
    bodyHtml: '<section><h3>1. What Laboura does</h3><p>Full terms (pretend data).</p></section>',
    hash: 'mock-hash',
    consents:
      key === 'job_seeker_terms'
        ? [
            { purpose: 'job_matching', required: true, title: 'Job matching', description: 'Use my details to find me jobs.' },
            { purpose: 'profile_sharing', required: true, title: 'Profile sharing', description: 'Show my profile to businesses.' },
            { purpose: 'call_recording', required: true, title: 'Call recording', description: 'Record calls with Laboura.' },
            { purpose: 'aadhaar_verification', required: true, title: 'ID check', description: 'Check my ID.' },
            { purpose: 'agreement_terms', required: true, title: 'Terms', description: 'I agree to the terms.' },
            { purpose: 'promotions', required: false, title: 'Offers', description: 'Send me offers (optional).' },
          ]
        : [],
  });
  const refreshPayment = () => {
    if (paidAt && Date.now() - paidAt > 4000 && reg.payment.state !== 'confirmed') {
      reg.payment = { ...reg.payment, state: 'confirmed', confirmedAt: new Date().toISOString(), guaranteeEndsAt: new Date(Date.now() + 30 * 86_400_000).toISOString() };
      reg.steps.payment = true;
      reg.currentStep = 'complete';
    }
  };
  return {
    registrationStatus: (token, requestId) =>
      wait(() => {
        refreshPayment();
        return requestId && verified.has(requestId) ? { ...reg } : locked(token);
      }),
    sendLinkOtp: () => wait(() => ({ requestId: `otp-${Math.random().toString(36).slice(2, 8)}`, phone: '+91 ••••• •4321' })),
    verifyRegistrationOtp: (_token, requestId, code) =>
      wait(() => {
        if (!/^\d{6}$/.test(code)) throw new ApiError({ status: 400, messages: ['The code is not right'] });
        verified.add(requestId);
        return { ...reg };
      }),
    legalDocument: (key) => wait(() => doc(key)),
    submitConsent: (_t, requestId) =>
      wait(() => {
        needCode(requestId);
        reg.steps.consent = true;
        reg.currentStep = 'selfie';
        return { success: true };
      }),
    registrationSelfie: (_t, requestId) =>
      wait(() => {
        needCode(requestId);
        reg.steps.selfie = true;
        reg.currentStep = 'id_check';
        return {};
      }),
    registrationAadhaarQr: (_t, requestId) =>
      wait(() => {
        needCode(requestId);
        reg.steps.idCheck = true;
        reg.idCheck = { waitingForTeamLead: false, lastResult: 'verified' };
        reg.currentStep = 'payment';
        return {
          verificationId: 'v-1', method: 'aadhaar_qr' as const, status: 'verified' as const, result: 'verified' as const, verifiedByUidai: true, nameMatches: true, isAdult: true,
          phoneLinked: 'linked' as const, maskedReference: 'XXXX-XXXX-1234', person: { name: 'Ravi Kumar', dateOfBirth: '1998-08-15', gender: 'M' as const }, failureReason: null, offerOtherId: false,
        };
      }),
    registrationCaptureNonce: () => wait(() => ({ captureNonce: 'nonce', expiresInSeconds: 120 })),
    registrationOtherId: (_t, requestId, idType, idNumber) =>
      wait(() => {
        needCode(requestId);
        reg.idCheck = { waitingForTeamLead: true, lastResult: 'pending' };
        return { verificationId: 'v-2', method: idType, status: 'pending' as const, idNumberLast4: idNumber.slice(-4) };
      }),
    registrationTerms: (_t, requestId) =>
      wait(() => {
        needCode(requestId);
        return { jobSeekerCode: reg.jobSeekerCode, trade: 'Cook', travelDistanceKm: 5, locality: 'BTM Layout', shiftPreference: 'day', jobType: 'full_time', guaranteeFloorPaise: 1_500_000, guaranteeDays: 30, amountPaise: 49900, termsAcceptedAt: reg.termsAcceptedAt };
      }),
    acceptRegistrationTerms: (_t, requestId) =>
      wait(() => {
        needCode(requestId);
        reg.termsAcceptedAt = new Date().toISOString();
        reg.payPageToken = 'mock-pay';
        reg.payment = { ...reg.payment, state: 'pending', upiReference: 'LB49900' };
        // Pretend the bank confirms the ₹499 about 8 seconds later.
        paidAt = Date.now() + 4000;
        return { payment: { upiReference: 'LB49900', amountPaise: 49900 } };
      }),
    sendPaymentOnlyLink: () => wait(() => ({ expiresAt: new Date(Date.now() + 15 * 60_000).toISOString() })),
    paymentSummary: () =>
      wait(() => ({
        type: 'activation' as const,
        state: reg.payment.state === 'confirmed' ? ('received' as const) : ('pending' as const),
        amountPaise: 49900,
        upiReference: 'LB49900',
        confirmedAt: reg.payment.confirmedAt,
        paymentOnlyLinkMinutes: 15,
        pay: {
          amountPaise: 49900,
          payeeName: 'Laboura (pretend)',
          upiReference: 'LB49900',
          upiUri: 'upi://pay?pa=laboura@bank&pn=Laboura&am=499.00&tr=LB49900',
          qrSvg: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><rect width="10" height="10" fill="#eee"/></svg>',
        },
      })),
    utrHint: () =>
      wait(() => {
        if (reg.payment.state === 'pending') reg.payment = { ...reg.payment, state: 'confirming' };
        return { saved: true };
      }),

    partnerStatus: (token, requestId) => wait(() => (requestId && verified.has(requestId) ? { ...partner } : locked(token))),
    verifyPartnerOtp: (_t, requestId, code) =>
      wait(() => {
        if (!/^\d{6}$/.test(code)) throw new ApiError({ status: 400, messages: ['The code is not right'] });
        verified.add(requestId);
        return { ...partner };
      }),
    partnerTerms: () =>
      wait(() => ({ referralPayoutPaise: 20000, version: '1.0', termsHtml: '', summaryHtml: '<p>You earn <strong>₹200</strong> when someone you refer joins a job.</p>', bodyHtml: '<p>Full terms (pretend data).</p>', payoutDetailsCoolingHours: 48, activationFeePaise: 49900 })),
    acceptPartnerTerms: (_t, requestId) =>
      wait(() => {
        needCode(requestId);
        partner.steps.terms = { state: 'done' };
        partner.currentStep = 'selfie';
        return { success: true };
      }),
    partnerSelfie: (_t, requestId) =>
      wait(() => {
        needCode(requestId);
        partner.steps.selfie = { state: 'done' };
        partner.currentStep = 'id_check';
        return {};
      }),
    partnerAadhaarQr: (_t, requestId) =>
      wait(() => {
        needCode(requestId);
        partner.steps.id = { state: 'done' };
        partner.currentStep = 'upi';
        return {
          verificationId: 'v-3', method: 'aadhaar_qr' as const, status: 'verified' as const, result: 'verified' as const, verifiedByUidai: true, nameMatches: true, isAdult: true,
          phoneLinked: 'linked' as const, maskedReference: 'XXXX-XXXX-5678', person: { name: 'Suma R', dateOfBirth: '1990-01-01', gender: 'F' as const }, failureReason: null, offerOtherId: false, nextStep: 'upi',
        };
      }),
    partnerCaptureNonce: () => wait(() => ({ captureNonce: 'nonce', expiresInSeconds: 120 })),
    partnerOtherId: (_t, requestId, idType, idNumber) =>
      wait(() => {
        needCode(requestId);
        partner.idCheck = { waitingForTeamLead: true, lastResult: 'pending' };
        return { verificationId: 'v-4', method: idType, status: 'pending' as const, idNumberLast4: idNumber.slice(-4), nextStep: 'id_check' };
      }),
    partnerPayout: (_t, requestId, details) =>
      wait(() => {
        needCode(requestId);
        const masked = details.method === 'upi' ? `${details.upiId.slice(0, 2)}•••@${details.upiId.split('@')[1] ?? ''}` : `•••• ${details.accountNumber.slice(-4)}`;
        partner.steps.upi = { state: 'done' };
        partner.currentStep = 'complete';
        partner.payout = { method: details.method, maskedValue: masked, status: 'pending', nameMatches: null };
        return { id: 'p-1', maskedValue: masked, status: 'pending' };
      }),

    agreementDetails: () =>
      wait(() => {
        if (signed) throw new ApiError({ status: 400, messages: ['This link has already been used'] });
        return {
          businessName: 'Sri Sai Bakery',
          maskedPhone: '+91 ••••• •4321',
          agreementTermsHtml: '',
          agreementSummaryHtml: '<p>50% of the first month’s salary + GST, paid when you select a candidate.</p>',
          agreementBodyHtml: '<p>Full agreement (pretend data).</p>',
          version: '1.1',
          ownerName: 'Manjunath',
          terms: { feePercent: 50, gstPercent: 18, noBypassMonths: 12, noBypassPenaltyPercent: 50 },
          guarantee: { replacementWindowDays: 60, maxFreeReplacements: 2, replacementSearchDays: 15 },
        };
      }),
    agreementSigned: () => wait(() => ({ signedAt: signed?.signedAt ?? new Date().toISOString(), signedName: signed?.signedName ?? '', businessName: 'Sri Sai Bakery' })),
    signAgreement: (_t, _r, code, signedName) =>
      wait(() => {
        if (!/^\d{6}$/.test(code)) throw new ApiError({ status: 400, messages: ['The code is not right'] });
        signed = { signedAt: new Date().toISOString(), signedName };
        return { signedAt: signed.signedAt };
      }),
  };
}
