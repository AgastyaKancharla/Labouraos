import { buildJourneyStatus, JourneyInput, publicLanguage, shortNameOf } from './registration-journey';

const REQUIRED = ['job_matching', 'profile_sharing', 'call_recording', 'aadhaar_verification', 'job_updates'];

function input(overrides: Partial<JourneyInput> = {}, seeker: Partial<JourneyInput['seeker']> = {}): JourneyInput {
  return {
    seeker: {
      name: 'Kavya Ramesh', code: 'JS-01042', phone: '+919876512345', messageLanguage: 'kn',
      photoStoragePath: null, paymentReceivedAt: null, termsAcceptedAt: null, guaranteeFloorPaise: 1300000,
      isUnder18ByDateOfBirth: false, ...seeker,
    },
    grantedPurposes: [],
    latestVerification: null,
    latestPayment: null,
    activationFeePaise: 49900,
    guaranteeDays: 30,
    under18Stop: false,
    ...overrides,
  };
}

const PAID_AT = new Date('2026-11-09T05:50:00.000Z');
const SUCCEEDED = { id: 'pay-1', status: 'succeeded', upiReference: 'PAY-1-ab', expectedAmountPaise: 49900, payerUtrHint: null, confirmedAt: PAID_AT };

describe('Registration link journey (P00 → P02b)', () => {
  it('starts at consent, and the optional purpose is not enough', () => {
    const status = buildJourneyStatus(input({ grantedPurposes: ['promotions', 'job_matching'] }));
    expect(status.currentStep).toBe('consent');
    expect(status.steps).toEqual({ consent: false, selfie: false, idCheck: false, payment: false });
    expect(status.firstName).toBe('Kavya');
    expect(status.maskedPhone).toBe('******2345');
    expect(status.language).toBe('en'); // English only (rev 193), whatever was stored
  });

  it('rev 211: Consent → Selfie → Payment → ID check, resuming at the first unfinished step', () => {
    expect(buildJourneyStatus(input({ grantedPurposes: REQUIRED })).currentStep).toBe('selfie');
    // Payment comes right after the selfie: no ID check needed first.
    const atPayment = buildJourneyStatus(input({ grantedPurposes: REQUIRED }, { photoStoragePath: 'p' }));
    expect(atPayment.currentStep).toBe('payment');
    expect(atPayment.steps).toEqual({ consent: true, selfie: true, idCheck: false, payment: false });
    expect(atPayment.paidWaitingForId).toBe(false);
    // Paid: the ID check is left, "paid, waiting for ID", and the 30 days have not started.
    const atId = buildJourneyStatus(input({ grantedPurposes: REQUIRED, latestPayment: SUCCEEDED }, { photoStoragePath: 'p', paymentReceivedAt: PAID_AT }));
    expect(atId.currentStep).toBe('id_check');
    expect(atId.steps).toEqual({ consent: true, selfie: true, idCheck: false, payment: true });
    expect(atId.paidWaitingForId).toBe(true);
    expect(atId.payment).toMatchObject({ state: 'confirmed', confirmedAt: PAID_AT, guaranteeStartsAt: null, guaranteeEndsAt: null });
  });

  it('an ID check done before payment (a field agent in person) still counts: payment next, then complete', () => {
    const verified = { status: 'verified', nameMatches: true, isAdult: true, failureReason: null };
    const before = buildJourneyStatus(input({ grantedPurposes: REQUIRED, latestVerification: verified }, { photoStoragePath: 'p' }));
    expect(before.currentStep).toBe('payment');
    expect(before.steps.idCheck).toBe(true);
    const paid = buildJourneyStatus(
      input({ grantedPurposes: REQUIRED, latestVerification: verified, latestPayment: SUCCEEDED }, { photoStoragePath: 'p', paymentReceivedAt: PAID_AT, guaranteeStartsAt: PAID_AT }),
    );
    expect(paid.currentStep).toBe('complete');
    expect(paid.paidWaitingForId).toBe(false);
  });

  it('lists each consent item already given once, so the consent page does not ask it again (17 Nov)', () => {
    const status = buildJourneyStatus(input({ grantedPurposes: ['job_matching', 'profile_sharing', 'job_matching', 'promotions'] }));
    expect(status.currentStep).toBe('consent');
    expect(status.consentGiven).toEqual(['job_matching', 'profile_sharing', 'promotions']);
    expect(buildJourneyStatus(input({ grantedPurposes: REQUIRED })).consentGiven).toEqual(REQUIRED);
  });

  it('only items given under the current notice version count as already given; an older-notice item is asked again', () => {
    const status = buildJourneyStatus(input({ grantedPurposes: ['job_matching', 'profile_sharing'], grantedUnderCurrentNotice: ['profile_sharing'] }));
    expect(status.consentGiven).toEqual(['profile_sharing']);
  });

  it('keeps a paid job seeker at the ID step on a name mismatch, and flags under 18 (by date of birth: before payment)', () => {
    const mismatch = buildJourneyStatus(input({
      grantedPurposes: REQUIRED,
      latestPayment: SUCCEEDED,
      latestVerification: { status: 'failed', nameMatches: false, isAdult: true, failureReason: 'Name mismatch' },
    }, { photoStoragePath: 'p', paymentReceivedAt: PAID_AT }));
    expect(mismatch.currentStep).toBe('id_check');
    expect(mismatch.idCheck.lastResult).toBe('name_mismatch');
    expect(mismatch.stopped).toBeNull();

    const minor = buildJourneyStatus(input({
      grantedPurposes: REQUIRED,
      under18Stop: true,
      latestPayment: SUCCEEDED,
      latestVerification: { status: 'verified', nameMatches: true, isAdult: false, failureReason: null },
    }, { photoStoragePath: 'p', paymentReceivedAt: PAID_AT }));
    expect(minor.currentStep).toBe('id_check');
    expect(minor.stopped).toBe('under_18');
    expect(minor.idCheck.lastResult).toBe('under_18');
    // A10: under 18 by the typed date of birth is flagged from the first step (the pages stop at consent).
    const byDob = buildJourneyStatus(input({}, { isUnder18ByDateOfBirth: true }));
    expect(byDob.stopped).toBe('under_18');
    expect(byDob.currentStep).toBe('consent');
    expect(byDob.steps.payment).toBe(false);
  });

  it('another ID waiting for the Team Lead no longer holds back the payment; once paid he waits at the ID step', () => {
    const pending = { status: 'pending', nameMatches: null, isAdult: null, failureReason: null };
    expect(buildJourneyStatus(input({ grantedPurposes: REQUIRED, latestVerification: pending }, { photoStoragePath: 'p' })).currentStep).toBe('payment');
    const status = buildJourneyStatus(input({
      grantedPurposes: REQUIRED,
      latestPayment: SUCCEEDED,
      latestVerification: pending,
    }, { photoStoragePath: 'p', paymentReceivedAt: PAID_AT }));
    expect(status.currentStep).toBe('id_check');
    expect(status.steps.idCheck).toBe(false);
    expect(status.idCheck).toEqual({ waitingForTeamLead: true, lastResult: 'pending' });
  });

  it('a verified ID stays verified when a later check fails or waits (L-5)', () => {
    const status = buildJourneyStatus(input({
      grantedPurposes: REQUIRED,
      anyVerifiedCheck: true,
      latestVerification: { status: 'failed', nameMatches: false, isAdult: true, failureReason: 'Name on the Aadhaar does not match the registered name' },
    }, { photoStoragePath: 'p' }));
    expect(status.steps.idCheck).toBe(true);
    expect(status.currentStep).toBe('payment'); // not paid yet
    // ...but not past a standing under-18 stop.
    const stopped = buildJourneyStatus(input({ grantedPurposes: REQUIRED, anyVerifiedCheck: true, under18Stop: true }, { photoStoragePath: 'p' }));
    expect(stopped.steps.idCheck).toBe(false);
    expect(stopped.stopped).toBe('under_18');
  });

  it('the under-18 stop is sticky: a later verified ID does not get past it', () => {
    const status = buildJourneyStatus(input({
      grantedPurposes: REQUIRED,
      under18Stop: true,
      latestPayment: SUCCEEDED,
      latestVerification: { status: 'verified', nameMatches: true, isAdult: true, failureReason: null },
    }, { photoStoragePath: 'p', paymentReceivedAt: PAID_AT }));
    expect(status.currentStep).toBe('id_check');
    expect(status.stopped).toBe('under_18');
    expect(status.idCheck.lastResult).toBe('under_18');
  });

  it('a lifted under-18 stop asks for a new ID check (not stopped, not verified)', () => {
    const status = buildJourneyStatus(input({
      grantedPurposes: REQUIRED,
      latestPayment: SUCCEEDED,
      latestVerification: { status: 'verified', nameMatches: true, isAdult: false, failureReason: null },
    }, { photoStoragePath: 'p', paymentReceivedAt: PAID_AT }));
    expect(status.stopped).toBeNull();
    expect(status.currentStep).toBe('id_check');
    expect(status.idCheck.lastResult).toBe('failed');
  });

  it('never shows paid until the bank confirms: a typed UPI reference is only "confirming"', () => {
    const base = { id: 'pay-1', upiReference: 'PAY-1-ab', expectedAmountPaise: 49900, confirmedAt: null };
    expect(buildJourneyStatus(input({ latestPayment: { ...base, status: 'pending', payerUtrHint: null } })).payment)
      .toMatchObject({ state: 'pending', upiReference: 'PAY-1-ab', confirmedAt: null, guaranteeEndsAt: null, paymentId: null });
    expect(buildJourneyStatus(input({ latestPayment: { ...base, status: 'pending', payerUtrHint: '123456789012' } })).payment.state)
      .toBe('confirming');
    expect(buildJourneyStatus(input({ latestPayment: { ...base, status: 'failed', payerUtrHint: null } })).payment.state)
      .toBe('failed');
  });

  it('rev 211: the 30 days run from guaranteeStartsAt (paid AND ID passed), not from the payment', () => {
    const confirmedAt = PAID_AT;
    const idPassedAt = new Date('2026-11-11T08:00:00.000Z');
    const status = buildJourneyStatus(input({
      grantedPurposes: REQUIRED,
      latestVerification: { status: 'verified', nameMatches: true, isAdult: true, failureReason: null },
      latestPayment: SUCCEEDED,
    }, { photoStoragePath: 'p', paymentReceivedAt: confirmedAt, guaranteeStartsAt: idPassedAt }));
    expect(status.currentStep).toBe('complete');
    expect(status.payment).toEqual({
      state: 'confirmed', amountPaise: 49900, upiReference: null, confirmedAt,
      guaranteeStartsAt: idPassedAt, guaranteeEndsAt: new Date('2026-12-11T08:00:00.000Z'), paymentId: 'pay-1',
    });
  });

  it('flags a new trade that has no salary floor yet', () => {
    expect(buildJourneyStatus(input({}, { guaranteeFloorPaise: null })).waitingForTrade).toBe(true);
  });

  it('reads every stored language as English (rev 193) and shortens names for the payment-only page', () => {
    expect(publicLanguage('Kannada')).toBe('en');
    expect(publicLanguage('hi')).toBe('en');
    expect(publicLanguage('Tamil')).toBe('en');
    expect(publicLanguage(null)).toBe('en');
    expect(shortNameOf('Kavya Ramesh')).toBe('Kavya R.');
    expect(shortNameOf('Kavya')).toBe('Kavya');
  });
});
