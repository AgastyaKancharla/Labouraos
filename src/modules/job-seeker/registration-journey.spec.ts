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

describe('Registration link journey (P00 → P02b)', () => {
  it('starts at consent, and the optional purpose is not enough', () => {
    const status = buildJourneyStatus(input({ grantedPurposes: ['promotions', 'job_matching'] }));
    expect(status.currentStep).toBe('consent');
    expect(status.steps).toEqual({ consent: false, selfie: false, idCheck: false, payment: false });
    expect(status.firstName).toBe('Kavya');
    expect(status.maskedPhone).toBe('******2345');
    expect(status.language).toBe('kn');
  });

  it('resumes at the first unfinished step, never asking a done step again', () => {
    expect(buildJourneyStatus(input({ grantedPurposes: REQUIRED })).currentStep).toBe('selfie');
    expect(buildJourneyStatus(input({ grantedPurposes: REQUIRED }, { photoStoragePath: 'p' })).currentStep).toBe('id_check');
    const verified = { status: 'verified', nameMatches: true, isAdult: true, failureReason: null };
    const atPayment = buildJourneyStatus(input({ grantedPurposes: REQUIRED, latestVerification: verified }, { photoStoragePath: 'p' }));
    expect(atPayment.currentStep).toBe('payment');
    expect(atPayment.steps).toEqual({ consent: true, selfie: true, idCheck: true, payment: false });
  });

  it('keeps him at the ID step on a name mismatch and stops before payment when he is under 18', () => {
    const mismatch = buildJourneyStatus(input({
      grantedPurposes: REQUIRED,
      latestVerification: { status: 'failed', nameMatches: false, isAdult: true, failureReason: 'Name mismatch' },
    }, { photoStoragePath: 'p' }));
    expect(mismatch.currentStep).toBe('id_check');
    expect(mismatch.idCheck.lastResult).toBe('name_mismatch');
    expect(mismatch.stopped).toBeNull();

    const minor = buildJourneyStatus(input({
      grantedPurposes: REQUIRED,
      under18Stop: true,
      latestVerification: { status: 'verified', nameMatches: true, isAdult: false, failureReason: null },
    }, { photoStoragePath: 'p' }));
    expect(minor.currentStep).toBe('id_check');
    expect(minor.stopped).toBe('under_18');
    expect(minor.idCheck.lastResult).toBe('under_18');
    expect(buildJourneyStatus(input({}, { isUnder18ByDateOfBirth: true })).stopped).toBe('under_18');
  });

  it('another ID waits for the Team Lead: pending keeps him at the ID step, never at payment', () => {
    const status = buildJourneyStatus(input({
      grantedPurposes: REQUIRED,
      latestVerification: { status: 'pending', nameMatches: null, isAdult: null, failureReason: null },
    }, { photoStoragePath: 'p' }));
    expect(status.currentStep).toBe('id_check');
    expect(status.steps.idCheck).toBe(false);
    expect(status.idCheck).toEqual({ waitingForTeamLead: true, lastResult: 'pending' });
  });

  it('the under-18 stop is sticky: a later verified ID does not get past it', () => {
    const status = buildJourneyStatus(input({
      grantedPurposes: REQUIRED,
      under18Stop: true,
      latestVerification: { status: 'verified', nameMatches: true, isAdult: true, failureReason: null },
    }, { photoStoragePath: 'p' }));
    expect(status.currentStep).toBe('id_check');
    expect(status.stopped).toBe('under_18');
    expect(status.idCheck.lastResult).toBe('under_18');
  });

  it('a lifted under-18 stop asks for a new ID check (not stopped, not verified)', () => {
    const status = buildJourneyStatus(input({
      grantedPurposes: REQUIRED,
      latestVerification: { status: 'verified', nameMatches: true, isAdult: false, failureReason: null },
    }, { photoStoragePath: 'p' }));
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

  it('starts the 30 days when the money is confirmed and finishes the journey', () => {
    const confirmedAt = new Date('2026-11-09T05:50:00.000Z');
    const status = buildJourneyStatus(input({
      grantedPurposes: REQUIRED,
      latestVerification: { status: 'verified', nameMatches: true, isAdult: true, failureReason: null },
      latestPayment: { id: 'pay-1', status: 'succeeded', upiReference: 'PAY-1-ab', expectedAmountPaise: 49900, payerUtrHint: null, confirmedAt },
    }, { photoStoragePath: 'p', paymentReceivedAt: confirmedAt }));
    expect(status.currentStep).toBe('complete');
    expect(status.payment).toEqual({
      state: 'confirmed', amountPaise: 49900, upiReference: null, confirmedAt,
      guaranteeEndsAt: new Date('2026-12-09T05:50:00.000Z'), paymentId: 'pay-1',
    });
  });

  it('flags a new trade that has no salary floor yet', () => {
    expect(buildJourneyStatus(input({}, { guaranteeFloorPaise: null })).waitingForTrade).toBe(true);
  });

  it('maps stored language names and shortens names for the payment-only page', () => {
    expect(publicLanguage('Kannada')).toBe('kn');
    expect(publicLanguage('hi')).toBe('hi');
    expect(publicLanguage('Tamil')).toBeNull();
    expect(publicLanguage(null)).toBeNull();
    expect(shortNameOf('Kavya Ramesh')).toBe('Kavya R.');
    expect(shortNameOf('Kavya')).toBe('Kavya');
  });
});
