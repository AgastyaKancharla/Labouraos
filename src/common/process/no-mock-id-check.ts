/**
 * Settings of the retired outside ID-check company (rev 154: Aadhaar is
 * checked in-house from its signed Secure QR, other IDs by the Team Lead by
 * eye) and of any mock / test ID check. None of them may be set on a
 * production process: a forgotten "mock" must never let anyone through.
 */
export const RETIRED_ID_CHECK_SETTINGS = [
  'KYC_PROVIDER_MODE',
  'KYC_API_KEY',
  'KYC_API_URL',
  'KYC_HEALTH_URL',
  'AADHAAR_QR_TEST_KEYS',
  'AADHAAR_QR_MODE',
  'ID_CHECK_MODE',
  'ID_CHECK_TEST_MODE',
] as const;

/** Refuses to start a production process (web or worker) with any of the settings above. Does nothing outside production. */
export function assertNoMockIdCheck(env: NodeJS.ProcessEnv = process.env): void {
  if (env.NODE_ENV !== 'production') return;
  const set = RETIRED_ID_CHECK_SETTINGS.filter((name) => (env[name] ?? '').trim() !== '');
  if (set.length) {
    throw new Error(
      `Refusing to start in production: ${set.join(', ')} ${set.length === 1 ? 'is' : 'are'} set. ` +
        'The ID check has no outside company or mock mode any more (Aadhaar: signed QR in-house; other IDs: the Team Lead). ' +
        'Delete these settings from the web service and the worker in the Render dashboard.',
    );
  }
}
