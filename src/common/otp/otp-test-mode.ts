/**
 * OTP test mode: while every vendor is pretend (mock), nobody can receive an
 * OTP, so the hosted test site could never finish a step that needs one. In
 * test mode the mock OTP sender hands the code back to the screen that asked
 * for it ("Test mode code: 123456") and writes it to the server log.
 *
 * It is ON only when all of these hold:
 *   - OTP_PROVIDER_MODE is `mock` (or unset, which means mock);
 *   - OTP_TEST_MODE is not `off`;
 *   - not NODE_ENV=production with any live vendor (any *_PROVIDER_MODE other
 *     than mock) — a production system with a real vendor never shows codes;
 *   - not the automated test suite (NODE_ENV=test), unless OTP_TEST_MODE=on.
 *
 * With a real OTP vendor (`OTP_PROVIDER_MODE=real`) the code is never known to
 * the server in the first place, and this mode is off.
 */
export const VENDOR_MODE_SETTINGS = [
  'OTP_PROVIDER_MODE',
  'SMS_PROVIDER_MODE',
  'PAYMENT_PROVIDER_MODE',
  'WHATSAPP_PROVIDER_MODE',
  'TELEPHONY_PROVIDER_MODE',
] as const;

function modeOf(env: NodeJS.ProcessEnv, key: string): string {
  const raw = env[key]?.trim().toLowerCase();
  return raw && raw !== 'undefined' ? raw : 'mock';
}

/** True when any vendor is set to something other than mock. */
export function anyLiveVendor(env: NodeJS.ProcessEnv = process.env): boolean {
  return VENDOR_MODE_SETTINGS.some((key) => modeOf(env, key) !== 'mock');
}

export function otpTestModeEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  if (modeOf(env, 'OTP_PROVIDER_MODE') !== 'mock') return false;
  const setting = env.OTP_TEST_MODE?.trim().toLowerCase();
  if (setting === 'off') return false;
  if (env.NODE_ENV === 'production' && anyLiveVendor(env)) return false;
  if (env.NODE_ENV === 'test' && setting !== 'on') return false;
  return true;
}

export interface TestModeFields {
  /** The 6-digit code, only in OTP test mode. */
  testModeCode?: string;
  /** Ready-made text for the banner on the screen that asked for the code. */
  testModeBanner?: string;
}

/**
 * What a "send OTP" answer adds in test mode: nothing at all otherwise.
 * Checks the mode again here, so a live system can never pass a code on even
 * if a provider returned one.
 */
export function testModeFields(
  result: { testModeCode?: string } | null | undefined,
  env: NodeJS.ProcessEnv = process.env,
): TestModeFields {
  const code = result?.testModeCode;
  if (!code || !otpTestModeEnabled(env)) return {};
  return { testModeCode: code, testModeBanner: `Test mode code: ${code}` };
}
