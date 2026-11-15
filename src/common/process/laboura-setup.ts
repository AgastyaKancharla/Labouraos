/**
 * INF-3: which setup a process belongs to. LABOURA_SETUP must be exactly
 * `live` (real people, real money) or `test` (made-up data only) on the web
 * service and the worker; anything else, or nothing, refuses to start.
 *
 * On `live` the process also refuses to start with anything that hands out
 * codes or pretends a vendor answered:
 *   - OTP test mode (OTP_TEST_MODE=on) or customer OTP test mode;
 *   - the mock OTP, SMS or payment provider (each *_PROVIDER_MODE must name the
 *     real vendor; unset means mock);
 *   - the mock human check (HUMAN_CHECK_PROVIDER_MODE unset or `mock`).
 * WhatsApp and telephony may stay mock on live until those vendors are signed
 * (nothing secret or paid depends on them answering).
 *
 * The automated tests set LABOURA_SETUP=test in src/test-support/jest-setup.ts.
 */
export const LABOURA_SETUP_SETTING = 'LABOURA_SETUP';

export type LabouraSetup = 'live' | 'test';

/** The setup as configured, exactly (no trimming, no other case): null when not one of the two. */
export function labouraSetup(env: NodeJS.ProcessEnv = process.env): LabouraSetup | null {
  const raw = env[LABOURA_SETUP_SETTING];
  return raw === 'live' || raw === 'test' ? raw : null;
}

function mode(env: NodeJS.ProcessEnv, key: string): string {
  const raw = env[key]?.trim().toLowerCase();
  return raw && raw !== 'undefined' ? raw : 'mock';
}

/** Why a live process may not start (empty: it may). */
export function liveSetupProblems(env: NodeJS.ProcessEnv = process.env): string[] {
  const problems: string[] = [];
  if ((env.OTP_TEST_MODE ?? '').trim().toLowerCase() === 'on') problems.push('OTP_TEST_MODE=on (OTP codes would be shown on screen)');
  if ((env.CUSTOMER_OTP_TEST_MODE ?? '').trim().toLowerCase() === 'on') problems.push('CUSTOMER_OTP_TEST_MODE=on (OTP codes would be shown on screen)');
  if (mode(env, 'OTP_PROVIDER_MODE') === 'mock') problems.push('OTP_PROVIDER_MODE is mock (set the real OTP vendor)');
  if (mode(env, 'SMS_PROVIDER_MODE') === 'mock') problems.push('SMS_PROVIDER_MODE is mock (set the real SMS vendor)');
  const payment = (env.PAYMENT_PROVIDER_MODE || env.PAYMENT_PROVIDER || '').trim().toLowerCase();
  if (!payment || payment === 'mock' || payment === 'undefined') problems.push('PAYMENT_PROVIDER_MODE is mock (set the real payment vendor)');
  if (mode(env, 'HUMAN_CHECK_PROVIDER_MODE') === 'mock') problems.push('HUMAN_CHECK_PROVIDER_MODE is mock (choose a real CAPTCHA or device attestation provider)');
  return problems;
}

/**
 * Called first thing by the web service and the worker. Throws (so the process
 * exits and Render shows the deploy as failed) when LABOURA_SETUP is not
 * exactly live or test, or when a live process has a mock or test setting.
 */
export function assertLabouraSetup(env: NodeJS.ProcessEnv = process.env): LabouraSetup {
  const setup = labouraSetup(env);
  if (!setup) {
    const shown = env[LABOURA_SETUP_SETTING] === undefined ? 'not set' : `"${env[LABOURA_SETUP_SETTING]}"`;
    throw new Error(
      `Refusing to start: LABOURA_SETUP is ${shown}. It must be exactly "live" (real people and money) or "test" (made-up data only), on the web service and the worker.`,
    );
  }
  if (setup === 'live') {
    const problems = liveSetupProblems(env);
    if (problems.length) {
      throw new Error(
        `Refusing to start the live setup (LABOURA_SETUP=live): ${problems.join('; ')}. See DEPLOY.md, "What to set before going live".`,
      );
    }
  }
  return setup;
}
