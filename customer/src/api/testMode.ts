/**
 * OTP test mode (server: src/common/otp/otp-test-mode.ts). While every vendor
 * is pretend, no SMS reaches the owner or the job seeker, so the server hands
 * the OTP back to the phone that asked (`testModeCode: "123456"` in the
 * customer API; `testModeBanner` on the staff API). The API client passes every answer here and
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
  const { testModeBanner, testModeCode } = body as { testModeBanner?: unknown; testModeCode?: unknown };
  const banner =
    typeof testModeBanner === 'string' && testModeBanner.trim()
      ? testModeBanner
      : typeof testModeCode === 'string' && testModeCode.trim()
        ? `Test mode code: ${testModeCode}`
        : null;
  if (!banner) return;
  for (const listener of listeners) listener(banner);
}
