import { createApiClient } from './client';
import { liveCustomerApi } from './live';
import { MOCK_OTP, mockCustomerApi } from './mock';

describe('pretend data (EXPO_PUBLIC_API_MODE=mock)', () => {
  it('walks a job seeker from sign-in to day 1 of 30', async () => {
    const api = mockCustomerApi({ latencyMs: 0 });
    const sent = await api.sendSignInOtp('9876543210');
    await expect(api.verifySignInOtp({ requestId: sent.requestId, code: '000000', contactConsent: false })).rejects.toThrow(/not right/);
    const auth = await api.verifySignInOtp({ requestId: sent.requestId, code: MOCK_OTP, contactConsent: true });
    expect(auth.account).toMatchObject({ phoneVerified: true, phoneLast4: '3210', profiles: [] });
    const { profile } = await api.registerJobSeeker({ fullName: 'Ravi Kumar' } as never);
    expect(profile).toMatchObject({ kind: 'job_seeker', displayName: 'Ravi' });
    await api.sheetLink(profile.id, 'registration');
    expect(await api.home(profile.id)).toMatchObject({ payment: { status: 'confirming' } });
    await api.sheetLink(profile.id, 'registration');
    expect(await api.home(profile.id)).toMatchObject({ payment: { status: 'paid' }, guarantee: { status: 'running', day: 1 }, interview: null });
  });

  it('Google gives no phone; a number ending 0000 finds the agent-made record', async () => {
    const api = mockCustomerApi({ latencyMs: 0 });
    const auth = await api.signInWithGoogle('x');
    expect(auth.account.phoneVerified).toBe(false);
    const sent = await api.sendPhoneOtp({ phone: '9876500000', contactConsent: false });
    const verified = await api.verifyPhoneOtp({ requestId: sent.requestId, code: MOCK_OTP });
    expect(verified.linkedExisting).toEqual([{ kind: 'job_seeker', code: 'JS-1234' }]);
    expect(verified.account.profiles).toHaveLength(1);
  });
});

describe('the real API paths', () => {
  it('signs in without a token, then uses /me with it', async () => {
    const calls: { url: string; init: RequestInit }[] = [];
    const fetchImpl = jest.fn(async (url: RequestInfo | URL, init: RequestInit = {}) => {
      calls.push({ url: String(url), init });
      return { ok: true, status: 200, text: async () => '{}' } as Response;
    });
    let token: string | null = null;
    const api = liveCustomerApi(createApiClient({ baseUrl: 'https://api.test', getToken: () => token, onUnauthorized: jest.fn(), fetchImpl: fetchImpl as unknown as typeof fetch }));
    token = 'tok';
    await api.sendSignInOtp('9876543210');
    await api.home('p 1');
    await api.sheetLink('p-1', 'document', 'doc-1');
    expect(calls[0].url).toBe('https://api.test/customer-auth/otp/send');
    expect((calls[0].init.headers as Record<string, string>).Authorization).toBeUndefined();
    expect(calls[1].url).toBe('https://api.test/me/profiles/p%201/home');
    expect((calls[1].init.headers as Record<string, string>).Authorization).toBe('Bearer tok');
    expect(JSON.parse(String(calls[2].init.body))).toEqual({ purpose: 'document', documentId: 'doc-1' });
  });
});
