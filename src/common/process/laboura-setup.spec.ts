import { assertLabouraSetup, labouraSetup, liveSetupProblems } from './laboura-setup';
import { otpTestModeEnabled } from '../otp/otp-test-mode';
import { humanCheckProviderFactory, MOCK_HUMAN_CHECK_TOKEN } from '../../modules/customer-account/human-check.provider';
import { bootstrap } from '../../main';
import { bootstrapWorker } from '../../worker';

/** Every real vendor chosen: what the live setup needs. */
const LIVE_READY = {
  LABOURA_SETUP: 'live',
  OTP_PROVIDER_MODE: 'real',
  SMS_PROVIDER_MODE: 'real',
  PAYMENT_PROVIDER_MODE: 'razorpay',
  HUMAN_CHECK_PROVIDER_MODE: 'recaptcha',
} as NodeJS.ProcessEnv;

describe('LABOURA_SETUP must be exactly live or test (INF-3)', () => {
  it.each([undefined, '', 'LIVE', ' live', 'Test', 'prod', 'production', 'staging'])('refuses to start with %j', (value) => {
    const env = { ...LIVE_READY, LABOURA_SETUP: value } as NodeJS.ProcessEnv;
    if (value === undefined) delete env.LABOURA_SETUP;
    expect(labouraSetup(env)).toBeNull();
    expect(() => assertLabouraSetup(env)).toThrow(/must be exactly "live" .* or "test"/);
  });

  it('starts the test setup with every vendor mocked (made-up data only)', () => {
    expect(assertLabouraSetup({ LABOURA_SETUP: 'test' } as NodeJS.ProcessEnv)).toBe('test');
    expect(assertLabouraSetup({ LABOURA_SETUP: 'test', OTP_TEST_MODE: 'on', CUSTOMER_OTP_TEST_MODE: 'on', HUMAN_CHECK_PROVIDER_MODE: 'mock' } as NodeJS.ProcessEnv)).toBe('test');
  });

  it('starts the live setup only with every real vendor set', () => {
    expect(liveSetupProblems(LIVE_READY)).toEqual([]);
    expect(assertLabouraSetup(LIVE_READY)).toBe('live');
    // WhatsApp and telephony may still be mock on live.
    expect(assertLabouraSetup({ ...LIVE_READY, WHATSAPP_PROVIDER_MODE: 'mock', TELEPHONY_PROVIDER_MODE: 'mock' })).toBe('live');
  });

  describe('on live, refuses each mock or test setting', () => {
    it.each([
      ['OTP test mode', { OTP_TEST_MODE: 'on' }, /OTP_TEST_MODE=on/],
      ['customer OTP test mode', { CUSTOMER_OTP_TEST_MODE: 'on' }, /CUSTOMER_OTP_TEST_MODE=on/],
      ['the mock OTP sender', { OTP_PROVIDER_MODE: 'mock' }, /OTP_PROVIDER_MODE is mock/],
      ['an unset OTP sender (= mock)', { OTP_PROVIDER_MODE: undefined }, /OTP_PROVIDER_MODE is mock/],
      ['the mock SMS sender', { SMS_PROVIDER_MODE: 'mock' }, /SMS_PROVIDER_MODE is mock/],
      ['an unset SMS sender (= mock)', { SMS_PROVIDER_MODE: undefined }, /SMS_PROVIDER_MODE is mock/],
      ['mock payments', { PAYMENT_PROVIDER_MODE: 'mock' }, /PAYMENT_PROVIDER_MODE is mock/],
      ['unset payments (= mock)', { PAYMENT_PROVIDER_MODE: undefined }, /PAYMENT_PROVIDER_MODE is mock/],
      ['the mock human check', { HUMAN_CHECK_PROVIDER_MODE: 'mock' }, /HUMAN_CHECK_PROVIDER_MODE is mock/],
      ['an unset human check (= mock)', { HUMAN_CHECK_PROVIDER_MODE: undefined }, /HUMAN_CHECK_PROVIDER_MODE is mock/],
    ])('%s', (_label, change, reason) => {
      const env = { ...LIVE_READY, ...change } as NodeJS.ProcessEnv;
      for (const [k, v] of Object.entries(change)) if (v === undefined) delete env[k];
      expect(() => assertLabouraSetup(env)).toThrow(reason);
      expect(() => assertLabouraSetup(env)).toThrow(/Refusing to start the live setup/);
    });
  });

  it('OTP test mode is never on for live, and the mock human check never answers there', async () => {
    expect(otpTestModeEnabled({ LABOURA_SETUP: 'test', OTP_PROVIDER_MODE: 'mock', OTP_TEST_MODE: 'on', NODE_ENV: 'production' } as NodeJS.ProcessEnv)).toBe(true);
    expect(otpTestModeEnabled({ LABOURA_SETUP: 'live', OTP_PROVIDER_MODE: 'mock', OTP_TEST_MODE: 'on', NODE_ENV: 'production' } as NodeJS.ProcessEnv)).toBe(false);
    expect(await humanCheckProviderFactory({ LABOURA_SETUP: 'test' } as NodeJS.ProcessEnv).verify(MOCK_HUMAN_CHECK_TOKEN, { installationId: null, ip: null })).toBe(true);
    expect(await humanCheckProviderFactory({ LABOURA_SETUP: 'live' } as NodeJS.ProcessEnv).verify(MOCK_HUMAN_CHECK_TOKEN, { installationId: null, ip: null })).toBe(false);
  });

  describe('the web service and the worker check it first thing', () => {
    const saved = { ...process.env };
    afterEach(() => {
      for (const key of ['LABOURA_SETUP', 'OTP_PROVIDER_MODE', 'SMS_PROVIDER_MODE', 'PAYMENT_PROVIDER_MODE', 'HUMAN_CHECK_PROVIDER_MODE']) {
        if (saved[key] === undefined) delete process.env[key];
        else process.env[key] = saved[key];
      }
    });

    it('web: refuses to start without LABOURA_SETUP', async () => {
      delete process.env.LABOURA_SETUP;
      await expect(bootstrap()).rejects.toThrow(/LABOURA_SETUP is not set/);
    });

    it('worker: refuses to start with a wrong LABOURA_SETUP', async () => {
      process.env.LABOURA_SETUP = 'production';
      await expect(bootstrapWorker()).rejects.toThrow(/LABOURA_SETUP is "production"/);
    });

    it('web and worker: refuse the live setup with mock vendors', async () => {
      process.env.LABOURA_SETUP = 'live';
      delete process.env.OTP_PROVIDER_MODE;
      await expect(bootstrap()).rejects.toThrow(/Refusing to start the live setup/);
      await expect(bootstrapWorker()).rejects.toThrow(/Refusing to start the live setup/);
    });
  });
});
