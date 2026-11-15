import { Logger } from '@nestjs/common';
import { MockOtpProvider } from './mock-otp.provider';
import { anyLiveVendor, otpTestModeEnabled, testModeFields } from './otp-test-mode';
import { OtpController } from './otp.controller';
import { OtpService } from './otp.service';

const KEYS = [
  'NODE_ENV',
  'OTP_TEST_MODE',
  'OTP_PROVIDER_MODE',
  'SMS_PROVIDER_MODE',
  'PAYMENT_PROVIDER_MODE',
  'WHATSAPP_PROVIDER_MODE',
  'TELEPHONY_PROVIDER_MODE',
] as const;

function withEnv(values: Partial<Record<(typeof KEYS)[number], string>>, fn: () => Promise<void> | void) {
  return async () => {
    const saved = Object.fromEntries(KEYS.map((k) => [k, process.env[k]]));
    for (const k of KEYS) delete process.env[k];
    Object.assign(process.env, values);
    try {
      await fn();
    } finally {
      for (const k of KEYS) {
        if (saved[k] === undefined) delete process.env[k];
        else process.env[k] = saved[k];
      }
    }
  };
}

/** The hosted test site: production build, every vendor pretend. */
const HOSTED_TEST = { NODE_ENV: 'production', OTP_PROVIDER_MODE: 'mock', SMS_PROVIDER_MODE: 'mock', PAYMENT_PROVIDER_MODE: 'mock', WHATSAPP_PROVIDER_MODE: 'mock', TELEPHONY_PROVIDER_MODE: 'mock' };
/** Production with live vendors (only OTP still mock, e.g. half-way through switching). */
const LIVE = { ...HOSTED_TEST, SMS_PROVIDER_MODE: 'real', PAYMENT_PROVIDER_MODE: 'real' };

describe('B2: OTP test mode — when it is on', () => {
  it('is on with pretend vendors, in development and on the hosted test site (production, all mock)', () => {
    expect(otpTestModeEnabled({ NODE_ENV: 'development' })).toBe(true);
    expect(otpTestModeEnabled({})).toBe(true);
    expect(otpTestModeEnabled(HOSTED_TEST)).toBe(true);
  });

  it('is never on in production with any live vendor', () => {
    expect(anyLiveVendor(LIVE)).toBe(true);
    expect(otpTestModeEnabled(LIVE)).toBe(false);
    for (const key of ['SMS_PROVIDER_MODE', 'PAYMENT_PROVIDER_MODE', 'WHATSAPP_PROVIDER_MODE', 'TELEPHONY_PROVIDER_MODE']) {
      expect({ key, on: otpTestModeEnabled({ ...HOSTED_TEST, [key]: 'real' }) }).toEqual({ key, on: false });
    }
  });

  it('is off with a real OTP vendor, whatever else is set', () => {
    expect(otpTestModeEnabled({ NODE_ENV: 'development', OTP_PROVIDER_MODE: 'real' })).toBe(false);
    expect(otpTestModeEnabled({ ...HOSTED_TEST, OTP_PROVIDER_MODE: 'msg91', OTP_TEST_MODE: 'on' })).toBe(false);
  });

  it('can be switched off, and stays off in the automated tests unless asked for', () => {
    expect(otpTestModeEnabled({ ...HOSTED_TEST, OTP_TEST_MODE: 'off' })).toBe(false);
    expect(otpTestModeEnabled({ NODE_ENV: 'test' })).toBe(false);
    expect(otpTestModeEnabled({ NODE_ENV: 'test', OTP_TEST_MODE: 'on' })).toBe(true);
  });

  it('adds the banner only in test mode, and re-checks the mode itself', () => {
    expect(testModeFields({ testModeCode: '123456' }, HOSTED_TEST)).toEqual({
      testModeCode: '123456',
      testModeBanner: 'Test mode code: 123456',
    });
    // Even if a provider handed a code over, a live system never passes it on.
    expect(testModeFields({ testModeCode: '123456' }, LIVE)).toEqual({});
    expect(testModeFields({}, HOSTED_TEST)).toEqual({});
    expect(testModeFields(undefined, HOSTED_TEST)).toEqual({});
  });
});

describe('B2: the mock OTP sender in test mode and live mode', () => {
  afterEach(() => jest.restoreAllMocks());

  it('test mode: returns the code to the caller and writes it to the server log', withEnv(HOSTED_TEST, async () => {
    const log = jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
    const provider = new MockOtpProvider();
    const sent = await provider.sendOtp('+919876543210', { purpose: 'job_seeker' });
    const code = provider.getCode(sent.requestId)!;
    expect(code).toMatch(/^\d{6}$/);
    expect(sent.testModeCode).toBe(code);
    expect(log.mock.calls.map((c) => String(c[0]))).toContainEqual(expect.stringContaining(`Test mode code for ******3210: ${code}`));
    // The code shown still works exactly once.
    await expect(provider.verifyOtp(sent.requestId, code)).resolves.toBe(true);
  }));

  it('test mode: a resend shows the same code again', withEnv(HOSTED_TEST, async () => {
    jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
    let now = 1_000_000;
    const provider = new MockOtpProvider({ timeProvider: () => now });
    const first = await provider.sendOtp('+919876543210');
    now += 31_000;
    const again = await provider.sendOtp('+919876543210', { requestId: first.requestId, purpose: 'job_seeker' });
    expect(again.testModeCode).toBe(first.testModeCode);
  }));

  it('live mode: no code in the answer and none in the log', withEnv(LIVE, async () => {
    const log = jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
    const provider = new MockOtpProvider();
    const sent = await provider.sendOtp('+919876543210');
    const code = provider.getCode(sent.requestId)!;
    expect(sent).not.toHaveProperty('testModeCode');
    expect(Object.keys(sent).sort()).toEqual(['requestId', 'resendAvailableAt', 'resendsLeft']);
    for (const [line] of log.mock.calls) expect(String(line)).not.toContain(code);
  }));
});

describe('B2: the screen that asked gets the banner (POST /otp/send)', () => {
  function controllerReturning(result: object) {
    const service = { sendOtp: jest.fn().mockResolvedValue(result) } as unknown as OtpService;
    return new OtpController(service);
  }
  const req = { user: { sub: 'ca-1', role: 'call_agent' } } as never;
  const body = { phone: '+919876543210', purpose: 'job_seeker' as const };

  it('test mode: answers with "Test mode code: 123456"', withEnv(HOSTED_TEST, async () => {
    const res = await controllerReturning({ requestId: 'r1', resendAvailableAt: 'x', resendsLeft: 3, testModeCode: '123456' }).sendOtp(body, req);
    expect(res).toMatchObject({ success: true, requestId: 'r1', testModeCode: '123456', testModeBanner: 'Test mode code: 123456' });
  }));

  it('live mode: the answer is unchanged', withEnv(LIVE, async () => {
    const res = await controllerReturning({ requestId: 'r1', resendAvailableAt: 'x', resendsLeft: 3, testModeCode: '123456' }).sendOtp(body, req);
    expect(res).toEqual({ success: true, requestId: 'r1', resendAvailableAt: 'x', resendsLeft: 3 });
  }));
});
