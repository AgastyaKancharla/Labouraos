import { SessionStore } from '@/auth/session';
import { createMemoryStore } from '@/lib/storage';
import { createApiClient } from './client';
import { errorText } from './errorText';
import { ApiError } from './errors';
import { liveCustomerApi, refreshSession, toAccount, toBusinessHome, toJobSeekerHome, toReferralHome } from './live';
import { MOCK_OTP, mockCustomerApi } from './mock';


type Call = { url: string; method: string; headers: Record<string, string>; body: unknown };

/** A fake fetch answering from a table of "METHOD /path" → { status, body }. */
function fakeServer(table: Record<string, { status?: number; body?: unknown } | ((call: Call) => { status?: number; body?: unknown })>) {
  const calls: Call[] = [];
  const fetchImpl = jest.fn(async (input: RequestInfo | URL, init: RequestInit = {}) => {
    const url = String(input);
    const call: Call = { url, method: init.method ?? 'GET', headers: (init.headers ?? {}) as Record<string, string>, body: init.body ? JSON.parse(String(init.body)) : undefined };
    calls.push(call);
    const key = `${call.method} ${new URL(url).pathname.replace('/customer-api/v1', '')}`;
    const entry = table[key];
    const answer = typeof entry === 'function' ? entry(call) : (entry ?? { status: 404, body: { code: 'NOT_FOUND' } });
    const status = answer.status ?? 200;
    return { ok: status < 300, status, text: async () => (answer.body === undefined ? '' : JSON.stringify(answer.body)) } as Response;
  });
  return { calls, fetchImpl: fetchImpl as unknown as typeof fetch };
}

const wireAccount = {
  id: 'acc-1',
  phone: '+919876543210',
  phoneVerified: true,
  email: null,
  displayName: 'Ravi Kumar',
  language: 'kn',
  contactMeConsent: false,
  status: 'active',
  signInMethods: ['phone'],
  lastProfileId: 'p-1',
  profiles: [
    { id: 'p-1', kind: 'job_seeker', role: 'self', code: 'JS-01234', title: 'Ravi', branchName: null },
    { id: 'p-2', kind: 'referral', role: 'self', code: 'RF-00034', title: 'Ravi', branchName: null },
    { id: 'p-3', kind: 'business', role: 'manager', code: 'BZ-00456', title: 'Test Bakery', branchName: 'Jayanagar' },
  ],
};

function live(table: Parameters<typeof fakeServer>[0], token: string | null = 'tok') {
  const server = fakeServer(table);
  const client = createApiClient({ baseUrl: 'https://api.test/customer-api/v1', getToken: () => token, onUnauthorized: jest.fn(), fetchImpl: server.fetchImpl });
  const api = liveCustomerApi(client, {
    language: async () => 'kn',
    device: async () => ({ installationId: 'install-uuid', platform: 'android', appVersion: '0.1.0' }),
  });
  return { api, ...server };
}

describe('the contract mapping (docs/customer-app-api.md)', () => {
  it('maps GET /me: referral → referral_partner, last 4 digits only, business role and branch', () => {
    const a = toAccount(wireAccount as never);
    expect(a.phoneLast4).toBe('3210');
    expect(a.profiles.map((p) => p.kind)).toEqual(['job_seeker', 'referral_partner', 'business']);
    expect(a.profiles[2]).toMatchObject({ businessRole: 'manager', branchName: 'Jayanagar', displayName: 'Test Bakery' });
    expect(a.lastProfileId).toBe('p-1');
  });

  it('job seeker Home: "confirming", day X of 30, hits, booked interview only, refund reference', () => {
    const confirming = toJobSeekerHome({ kind: 'job_seeker', steps: { phone: true, profile: true, consent: true, selfie: true, idCheck: true, terms: true, payment: false }, currentStep: 'payment', payment: { state: 'confirming', amountPaise: 49900 }, guarantee: { active: false }, hits: { count: 0, max: 3 }, interview: null, refund: { state: 'none' } });
    expect(confirming.payment.status).toBe('confirming');
    expect(confirming.steps.payment).toBe('in_progress');
    expect(confirming.guarantee.status).toBe('not_started');

    const running = toJobSeekerHome({ kind: 'job_seeker', code: 'JS-1', firstName: 'Ravi', steps: { phone: true, profile: true, consent: true, selfie: true, idCheck: true, terms: true, payment: true }, payment: { state: 'confirmed', amountPaise: 49900 }, guarantee: { active: true, day: 12, days: 30, endsAt: '2026-12-02T00:00:00Z' }, hits: { count: 1, max: 3 }, interview: { at: '2026-11-16T05:30:00Z', businessName: 'Test Bakery', address: 'JP Nagar', latitude: 1, longitude: 2, replyBy: null, state: 'booked' }, refund: { state: 'paid', reference: 'UPI-1' } });
    expect(running.guarantee).toMatchObject({ status: 'running', day: 12, totalDays: 30, endsOn: '2026-12-02', hits: 1 });
    expect(running.interview).toMatchObject({ businessName: 'Test Bakery', startsAt: '2026-11-16T05:30:00Z' });
    expect(running.refund).toMatchObject({ status: 'paid', upiRef: 'UPI-1', amountPaise: 49900 });

    const notBooked = toJobSeekerHome({ kind: 'job_seeker', steps: {}, payment: { state: 'confirmed' }, guarantee: { active: true, day: 3 }, interview: { state: 'pending', businessName: 'Should not show' } });
    expect(notBooked.interview).toBeNull();
    expect(toJobSeekerHome({ kind: 'job_seeker', steps: {}, payment: { state: 'confirmed' }, nextAction: 'pay_again' }).guarantee.status).toBe('deactivated');
  });

  it('business Home: tracker, drafts first (confirmable), open vacancies wait for the visit until approved', () => {
    const h = toBusinessHome({ kind: 'business', code: 'BZ-1', name: 'Test Bakery', tracker: { phoneVerified: true, agreement: false, visitBooked: true, visitDone: false, approved: false }, visit: { state: 'booked', requestedFor: '2026-11-16T05:30:00Z', agentFirstName: 'Suresh' }, vacancies: [{ code: 'VC-1', trade: 'Baker', headcount: 1, status: 'open', belowLegalMinimum: false }], drafts: [{ id: 'd-1', trade: 'Helper' }], counts: { interviewsUpcoming: 0, placements: 0 } });
    expect(h.tracker).toMatchObject({ agreement: 'not_signed', visit: 'booked', visitAgentFirstName: 'Suresh', approval: 'waiting' });
    expect(h.vacancies.map((v) => [v.id, v.status])).toEqual([
      ['d-1', 'draft'],
      ['VC-1', 'waiting_for_visit'],
    ]);
  });

  it('referral Home: first name and stage only, server WhatsApp text, payout statement', () => {
    const h = toReferralHome({ kind: 'referral', code: 'RF-1', firstName: 'Manju', paused: false, steps: { terms: true, selfie: true, idCheck: true, upi: false }, share: { link: 'https://app.test/r/RF-1', whatsappText: 'Join: https://app.test/r/RF-1' }, referred: [{ firstName: 'Ravi', stage: 'joined', since: '2026-11-01T00:00:00Z' }], money: { duePaise: 20000, approvedPaise: 0, paidPaise: 40000, yearTotalPaise: 40000, statement: [{ amountPaise: 20000, status: 'paid', date: '2026-11-10T00:00:00Z', upiReference: 'U1' }] } });
    expect(h.steps.upi).toBe('not_started');
    expect(h.shareText).toBe('Join: https://app.test/r/RF-1');
    expect(h.referrals[0]).toEqual({ id: 'r-0', firstName: 'Ravi', stage: 'joined', referredOn: '2026-11-01T00:00:00Z' });
    expect(h.money.payouts[0]).toMatchObject({ status: 'paid', upiRef: 'U1', paidOn: '2026-11-10T00:00:00Z' });
    expect(h.documents).toEqual([]);
  });
});

describe('the real API calls', () => {
  it('signs in by OTP with the device and language; the contact tick is saved on the account', async () => {
    const { api, calls } = live(
      {
        'POST /auth/otp/send': { body: { requestId: 'otp_1', resendAvailableAt: null, resendsLeft: 3, testModeCode: '123456' } },
        'POST /auth/otp/verify': { body: { accessToken: 'new', refreshToken: 'ref', account: wireAccount, linked: [], next: 'home' } },
        'PATCH /me': { body: { ...wireAccount, contactMeConsent: true } },
      },
      null,
    );
    const sent = await api.sendSignInOtp('9876543210');
    expect(sent.testModeBanner).toBe('Test mode code: 123456');
    const auth = await api.verifySignInOtp({ phone: '9876543210', requestId: 'otp_1', code: '123456', contactConsent: true });
    expect(calls[1].body).toEqual({ phone: '9876543210', requestId: 'otp_1', code: '123456', device: { installationId: 'install-uuid', platform: 'android', appVersion: '0.1.0' }, language: 'kn' });
    expect(calls[2]).toMatchObject({ method: 'PATCH', body: { contactMe: true } });
    expect(calls[2].headers.Authorization).toBe('Bearer new');
    expect(auth).toMatchObject({ accessToken: 'new', refreshToken: 'ref', account: { contactMe: true } });
  });

  it('every registration carries the fresh OTP in its body; 409 PROFILE_EXISTS continues the existing record', async () => {
    const { api, calls } = live({
      'POST /auth/step-up/send': { body: { requestId: 'otp_r' } },
      'POST /me/register/referral': { status: 409, body: { statusCode: 409, code: 'PROFILE_EXISTS', profileId: 'p-2' } },
    });
    await api.sendStepUp('register');
    expect(calls[0].body).toEqual({ purpose: 'register' });
    const result = await api.registerReferralPartner(
      { name: 'Manju', partnerType: 'individual', individualKind: 'auto_driver', businessType: null, businessName: null, area: 'JP Nagar', pincode: '560078', pin: { latitude: 12.9, longitude: 77.5 }, messageLanguage: 'kn', whatsappPhone: null },
      { requestId: 'otp_r', code: '123456' },
    );
    expect(calls[1].body).toMatchObject({ name: 'Manju', type: 'individual', individualRole: 'auto_driver', locality: 'JP Nagar', latitude: 12.9, heardFrom: 'laboura_app', otp: { requestId: 'otp_r', code: '123456' } });
    expect(calls[1].body).not.toHaveProperty('whatsappPhone');
    expect(result).toEqual({ profile: { id: 'p-2', kind: 'referral_partner', code: null, displayName: 'Manju' }, existing: true });
  });

  it('vacancy: draft, step-up verify, then confirm; deletion: step-up verify, then the request', async () => {
    const { api, calls } = live({
      'POST /me/profiles/p-3/vacancy-drafts': { body: { id: 'd-9', status: 'draft', warnings: { belowLegalMinimum: true, legalMinimumPaise: 2340000 } } },
      'POST /auth/step-up/verify': { body: { validUntil: 'x' } },
      'POST /me/profiles/p-3/vacancy-drafts/d-9/confirm': { status: 201, body: { vacancy: { code: 'VC-9', status: 'open' } } },
      'POST /me/deletion': { status: 201, body: { id: 'del', status: 'requested' } },
    });
    const draft = await api.createVacancy('p-3', { trade: 'Helper', roleTitle: null, openings: 2, salaryMinPaise: 2_000_000, salaryMaxPaise: null, salaryPeriod: 'monthly', shift: 'day', startDate: '2026-12-01', description: '', legalMinimumAcknowledged: true });
    expect(calls[0].body).toEqual({ form: { tradeSkill: 'Helper', headcount: 2, salaryMinPaise: 2_000_000, salaryPeriod: 'monthly', shift: 'day', startDate: '2026-12-01', ownerToldMinimumWage: true } });
    expect(draft).toMatchObject({ id: 'd-9', belowLegalMinimum: true, legalMinimumPaise: 2340000 });
    const confirmed = await api.confirmVacancy('p-3', 'd-9', { otp: { requestId: 'otp_v', code: '123456' }, ownerToldMinimumWage: true });
    expect(calls[1].body).toEqual({ purpose: 'confirm_vacancy', requestId: 'otp_v', code: '123456' });
    expect(calls[2].body).toEqual({ ownerToldMinimumWage: true });
    expect(confirmed.code).toBe('VC-9');
    await api.requestDeletion({ otp: { requestId: 'otp_d', code: '654321' }, acceptGuaranteeLoss: true });
    expect(calls[3].body).toEqual({ purpose: 'delete_account', requestId: 'otp_d', code: '654321' });
    expect(calls[4].body).toEqual({ refundLossAcknowledged: true });
  });

  it('links, home and callback paths name only my own profile ids', async () => {
    const { api, calls } = live({
      'POST /me/profiles/p%201/links': { status: 201, body: { url: 'https://app.test/p/register/t' } },
      'POST /me/callback-requests': { status: 201, body: { id: 'cb' } },
    });
    await api.sheetLink('p 1', 'referral_registration');
    expect(calls[0].body).toEqual({ purpose: 'referral_registration' });
    await api.requestCallback({ profileId: 'p-1', topic: 'business', when: 'later', from: '18:00', to: '20:00' });
    expect(calls[1].body).toEqual({ profileId: 'p-1', topic: 'vacancy', preferredFrom: '18:00', preferredTo: '20:00' });
  });
});

describe('the HTTP client', () => {
  it('sends the installation id, renews an expired access token once and retries', async () => {
    let token = 'old';
    let n = 0;
    const server = fakeServer({
      'GET /me': (call) => (call.headers.Authorization === 'Bearer old' ? { status: 401, body: { code: 'CUSTOMER_TOKEN_EXPIRED' } } : { body: wireAccount }),
    });
    const onUnauthorized = jest.fn();
    const client = createApiClient({
      baseUrl: 'https://api.test/customer-api/v1',
      getToken: () => token,
      getHeaders: async () => ({ 'X-Laboura-Installation': 'install-uuid' }),
      refresh: async () => {
        n += 1;
        token = 'fresh';
        return true;
      },
      onUnauthorized,
      fetchImpl: server.fetchImpl,
    });
    await client.get('/me');
    expect(n).toBe(1);
    expect(server.calls.map((c) => c.headers.Authorization)).toEqual(['Bearer old', 'Bearer fresh']);
    expect(server.calls[0].headers['X-Laboura-Installation']).toBe('install-uuid');
    expect(onUnauthorized).not.toHaveBeenCalled();
  });

  it('any other 401 ends the session', async () => {
    const server = fakeServer({ 'GET /me': { status: 401, body: { code: 'CUSTOMER_SESSION_ENDED' } } });
    const onUnauthorized = jest.fn();
    const client = createApiClient({ baseUrl: 'https://api.test', getToken: () => 'tok', refresh: async () => true, onUnauthorized, fetchImpl: server.fetchImpl });
    await expect(client.get('/me')).rejects.toBeInstanceOf(ApiError);
    expect(onUnauthorized).toHaveBeenCalledWith(expect.any(String), 'CUSTOMER_SESSION_ENDED');
  });

  it('refreshSession swaps both tokens (the old refresh token stops working)', async () => {
    const store = new SessionStore(createMemoryStore());
    await store.start('old', 'refresh-1');
    const server = fakeServer({ 'POST /auth/refresh': { body: { accessToken: 'new', refreshToken: 'refresh-2', account: wireAccount } } });
    await expect(refreshSession('https://api.test/customer-api/v1', store, server.fetchImpl)).resolves.toBe(true);
    expect(server.calls[0].body).toEqual({ refreshToken: 'refresh-1' });
    expect(store.session()).toMatchObject({ accessToken: 'new', refreshToken: 'refresh-2' });
  });

  it('shows the app’s own words for contract error codes', () => {
    const t = (key: string, p?: Record<string, string | number>) => (p ? `${key}:${JSON.stringify(p)}` : key);
    const err = (body: object) => new ApiError({ status: 400, messages: ['x'], body });
    expect(errorText(t as never, err({ code: 'OTP_LIMIT', retryAfterSeconds: 300 }))).toBe('error.otpLimitWait:{"minutes":5}');
    expect(errorText(t as never, err({ code: 'PHONE_IN_USE' }))).toBe('error.phoneInUse');
    expect(errorText(t as never, err({ code: 'VALIDATION_FAILED', message: 'pincode must be 6 digits' }))).toBe('x');
    expect(errorText(t as never, new ApiError({ status: 0, messages: ['net'], isNetworkError: true }))).toBe('common.networkError');
  });
});

describe('pretend data (EXPO_PUBLIC_API_MODE=mock)', () => {
  it('walks a job seeker from sign-in to day 1 of 30, with the registration OTP', async () => {
    const api = mockCustomerApi({ latencyMs: 0 });
    const sent = await api.sendSignInOtp('9876543210');
    await expect(api.verifySignInOtp({ phone: '9876543210', requestId: sent.requestId, code: '000000', contactConsent: false })).rejects.toMatchObject({ code: 'OTP_INVALID' });
    const auth = await api.verifySignInOtp({ phone: '9876543210', requestId: sent.requestId, code: MOCK_OTP, contactConsent: true });
    expect(auth.account).toMatchObject({ phoneVerified: true, phoneLast4: '3210', profiles: [] });
    const step = await api.sendStepUp('register');
    const { profile } = await api.registerJobSeeker({ fullName: 'Ravi Kumar' } as never, { requestId: step.requestId, code: MOCK_OTP });
    expect(profile).toMatchObject({ kind: 'job_seeker', displayName: 'Ravi' });
    await api.sheetLink(profile.id, 'registration');
    expect(await api.home(profile.id)).toMatchObject({ payment: { status: 'confirming' } });
    await api.sheetLink(profile.id, 'registration');
    expect(await api.home(profile.id)).toMatchObject({ payment: { status: 'paid' }, guarantee: { status: 'running', day: 1 }, interview: null });
    expect(await api.deletionInfo()).toMatchObject({ guaranteeRunning: true });
  });

  it('Google gives no phone; a number ending 0000 finds the agent-made record', async () => {
    const api = mockCustomerApi({ latencyMs: 0 });
    const auth = await api.signInWithGoogle('x');
    expect(auth.account.phoneVerified).toBe(false);
    const sent = await api.sendPhoneOtp({ phone: '9876500000', contactConsent: false });
    const verified = await api.verifyPhoneOtp({ phone: '9876500000', requestId: sent.requestId, code: MOCK_OTP });
    expect(verified.linkedExisting).toEqual([{ kind: 'job_seeker', code: 'JS-1234' }]);
    expect(verified.account.profiles).toHaveLength(1);
  });
});
