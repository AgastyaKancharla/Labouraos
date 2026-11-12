/**
 * OTP test mode (server: src/common/otp/otp-test-mode.ts). While every vendor
 * is pretend, no SMS reaches anyone, so the server hands the OTP back to the
 * screen that asked for it as `testModeBanner: "Test mode code: 123456"`.
 * The API client passes every such answer here, and <TestModeBanner /> shows
 * it. A live system never sends the field, so nothing is ever shown there.
 */
type Listener = (banner: string) => void;
const listeners = new Set<Listener>();

export function onTestModeBanner(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Called by the API client with every successful JSON answer. */
export function announceTestMode(body: unknown): void {
  if (!body || typeof body !== 'object') return;
  const banner = (body as { testModeBanner?: unknown }).testModeBanner;
  if (typeof banner !== 'string' || !banner.trim()) return;
  for (const listener of listeners) listener(banner);
}
