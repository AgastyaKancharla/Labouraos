import { assertCustomerOtpTestModeSafe, assertHumanCheckSafe, customerOtpTestModeEnabled, customerTestModeFields } from './customer-otp-test-mode';

/** Security review C1: customer OTP codes are shown only with an explicit flag, on the test setup. */
describe('Customer OTP test mode', () => {
  const base = { NODE_ENV: 'test', OTP_PROVIDER_MODE: 'mock' } as NodeJS.ProcessEnv;

  it('is off by default, even when the staff OTP test mode is on', () => {
    expect(customerOtpTestModeEnabled({ ...base, OTP_TEST_MODE: 'on', LABOURA_SETUP: 'test' })).toBe(false);
    expect(customerTestModeFields('123456', { ...base, OTP_TEST_MODE: 'on', LABOURA_SETUP: 'test' })).toEqual({});
  });

  it('is on only with CUSTOMER_OTP_TEST_MODE=on on the test setup with the mock sender', () => {
    expect(customerOtpTestModeEnabled({ ...base, CUSTOMER_OTP_TEST_MODE: 'on', LABOURA_SETUP: 'test' })).toBe(true);
    expect(customerTestModeFields('123456', { ...base, CUSTOMER_OTP_TEST_MODE: 'on', LABOURA_SETUP: 'test' })).toEqual(expect.objectContaining({ testModeCode: '123456' }));
    expect(customerOtpTestModeEnabled({ ...base, CUSTOMER_OTP_TEST_MODE: 'on', LABOURA_SETUP: 'live' })).toBe(false);
    expect(customerOtpTestModeEnabled({ ...base, CUSTOMER_OTP_TEST_MODE: 'on' })).toBe(false);
    expect(customerOtpTestModeEnabled({ ...base, CUSTOMER_OTP_TEST_MODE: 'on', LABOURA_SETUP: 'test', OTP_PROVIDER_MODE: 'real' })).toBe(false);
    expect(customerOtpTestModeEnabled({ NODE_ENV: 'production', CUSTOMER_OTP_TEST_MODE: 'on', LABOURA_SETUP: 'test', PAYMENT_PROVIDER_MODE: 'real' })).toBe(false);
  });

  it('refuses to start with the flag on outside the test setup', () => {
    expect(() => assertCustomerOtpTestModeSafe({ CUSTOMER_OTP_TEST_MODE: 'on', LABOURA_SETUP: 'live' })).toThrow(/only allowed on the test setup/);
    expect(() => assertCustomerOtpTestModeSafe({ CUSTOMER_OTP_TEST_MODE: 'on' })).toThrow();
    expect(() => assertCustomerOtpTestModeSafe({ CUSTOMER_OTP_TEST_MODE: 'on', LABOURA_SETUP: 'test' })).not.toThrow();
    expect(() => assertCustomerOtpTestModeSafe({ LABOURA_SETUP: 'live' })).not.toThrow();
  });

  it('the live setup refuses to start with the mock human check (N3)', () => {
    expect(() => assertHumanCheckSafe({ LABOURA_SETUP: 'live' })).toThrow(/not allowed on the live setup/);
    expect(() => assertHumanCheckSafe({ LABOURA_SETUP: 'live', HUMAN_CHECK_PROVIDER_MODE: 'mock' })).toThrow();
    // M2: only an implemented provider counts; none is built yet, so live refuses any value.
    expect(() => assertHumanCheckSafe({ LABOURA_SETUP: 'live', HUMAN_CHECK_PROVIDER_MODE: 'recaptcha' })).toThrow(/not an implemented human check/);
    expect(() => assertHumanCheckSafe({ LABOURA_SETUP: 'live', HUMAN_CHECK_PROVIDER_MODE: 'turnstile' }, ['turnstile'])).not.toThrow();
    expect(() => assertHumanCheckSafe({ LABOURA_SETUP: 'test', HUMAN_CHECK_PROVIDER_MODE: 'mock' })).not.toThrow();
    expect(() => assertHumanCheckSafe({})).not.toThrow();
  });
});
