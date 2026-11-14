/**
 * OTP test mode (server: src/common/otp/otp-test-mode.ts). While every vendor
 * is pretend, no SMS reaches the owner or the job seeker, so the server hands
 * the OTP back to the phone that asked as `testModeBanner:
 * "Test mode code: 123456"`. The API client passes every answer here and
 * <TestModeBanner /> shows it. A live system never sends the field.
 */
type Listener = (banner: string) => void;
const listeners = new Set<Listener>();

export function onTestModeBanner(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function announceTestMode(body: unknown): void {
  if (!body || typeof body !== 'object') return;
  const banner = (body as { testModeBanner?: unknown }).testModeBanner;
  if (typeof banner !== 'string' || !banner.trim()) return;
  for (const listener of listeners) listener(banner);
}
