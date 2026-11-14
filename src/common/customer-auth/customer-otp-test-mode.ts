import { anyLiveVendor } from '../otp/otp-test-mode';

/**
 * Customer OTP test mode (security review, C1). The customer app's OTP answers
 * carry the code (`testModeCode`) ONLY when all of these hold:
 *   - CUSTOMER_OTP_TEST_MODE is exactly `on` (default off; the staff OTP_TEST_MODE does not count);
 *   - the setup is explicitly marked as the test setup: LABOURA_SETUP=test;
 *   - the OTP sender is the mock one, and no vendor is live in production.
 *
 * The server refuses to start when CUSTOMER_OTP_TEST_MODE=on on any setup not
 * marked LABOURA_SETUP=test (assertCustomerOtpTestModeSafe), so the live setup
 * can never hand out codes even if the flag is copied there by mistake.
 */
export const CUSTOMER_OTP_TEST_MODE_ENV = 'CUSTOMER_OTP_TEST_MODE';
export const LABOURA_SETUP_ENV = 'LABOURA_SETUP';

export function customerOtpTestModeRequested(env: NodeJS.ProcessEnv = process.env): boolean {
  return env[CUSTOMER_OTP_TEST_MODE_ENV]?.trim().toLowerCase() === 'on';
}

export function isTestSetup(env: NodeJS.ProcessEnv = process.env): boolean {
  return env[LABOURA_SETUP_ENV]?.trim().toLowerCase() === 'test';
}

export function customerOtpTestModeEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  if (!customerOtpTestModeRequested(env) || !isTestSetup(env)) return false;
  const otpMode = env.OTP_PROVIDER_MODE?.trim().toLowerCase();
  if (otpMode && otpMode !== 'mock' && otpMode !== 'undefined') return false;
  if (env.NODE_ENV === 'production' && anyLiveVendor(env)) return false;
  return true;
}

/** Fails start-up when the customer test flag is on outside the test setup. */
export function assertCustomerOtpTestModeSafe(env: NodeJS.ProcessEnv = process.env): void {
  if (customerOtpTestModeRequested(env) && !isTestSetup(env)) {
    throw new Error(
      'CUSTOMER_OTP_TEST_MODE=on is only allowed on the test setup (LABOURA_SETUP=test). Turn it off: the live setup must never show OTP codes.',
    );
  }
}

export function isLiveSetup(env: NodeJS.ProcessEnv = process.env): boolean {
  return env[LABOURA_SETUP_ENV]?.trim().toLowerCase() === 'live';
}

/**
 * The live setup cannot start with the mock human check (its token is public):
 * a real CAPTCHA or device attestation must be chosen before the public launch
 * (security re-check N3; DEPLOY.md go-live checklist). The test setup keeps the mock.
 */
export function assertHumanCheckSafe(env: NodeJS.ProcessEnv = process.env): void {
  const mode = env.HUMAN_CHECK_PROVIDER_MODE?.trim().toLowerCase() || 'mock';
  if (isLiveSetup(env) && mode === 'mock') {
    throw new Error(
      'HUMAN_CHECK_PROVIDER_MODE=mock is not allowed on the live setup (LABOURA_SETUP=live): choose a real CAPTCHA or device attestation provider before going live.',
    );
  }
}

/** What a customer "send OTP" answer adds: the code only in customer OTP test mode. */
export function customerTestModeFields(code: string | undefined, env: NodeJS.ProcessEnv = process.env) {
  if (!code || !customerOtpTestModeEnabled(env)) return {};
  return { testModeCode: code, testModeBanner: `Test mode code: ${code}` };
}
