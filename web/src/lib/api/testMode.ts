/**
 * Test mode (server: src/common/otp/otp-test-mode.ts and
 * src/common/test-mode-link.ts). While every vendor is pretend, no SMS reaches
 * anyone, so the server hands back what the SMS would have carried:
 *   - the OTP, as `testModeBanner: "Test mode code: 123456"`;
 *   - a link sent by SMS (registration, agreement, partner terms, payout
 *     details, vacancy confirmation, payment-only…), as `testModeLink`.
 * The API client passes every answer here, and <TestModeBanner /> shows it.
 * A live system never sends these fields, so nothing is ever shown there.
 */
export interface TestModeNotice {
  /** "Test mode code: 123456". */
  code?: string;
  /** The full link the SMS would have carried. */
  links?: string[];
}

type Listener = (notice: TestModeNotice) => void;
const listeners = new Set<Listener>();

export function onTestModeBanner(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function httpLink(value: unknown): string | null {
  return typeof value === 'string' && /^https?:\/\//i.test(value.trim()) ? value.trim() : null;
}

/** Called by the API client with every successful JSON answer. */
export function announceTestMode(body: unknown): void {
  if (!body || typeof body !== 'object') return;
  const answer = body as { testModeBanner?: unknown; testModeLink?: unknown; testModeLinks?: unknown };
  const notice: TestModeNotice = {};
  if (typeof answer.testModeBanner === 'string' && answer.testModeBanner.trim()) notice.code = answer.testModeBanner;
  const links: string[] = [];
  if (Array.isArray(answer.testModeLinks)) {
    for (const item of answer.testModeLinks) {
      const url = httpLink((item as { url?: unknown } | null)?.url);
      if (url && !links.includes(url)) links.push(url);
    }
  }
  const first = httpLink(answer.testModeLink);
  if (first && !links.includes(first)) links.unshift(first);
  if (links.length) notice.links = links;
  if (!notice.code && !notice.links) return;
  for (const listener of listeners) listener(notice);
}
