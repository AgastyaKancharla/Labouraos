/**
 * Which payment provider is bound (AGENTS.md §3: PAYMENT_PROVIDER_MODE, with
 * the older PAYMENT_PROVIDER as a fallback; `mock` when unset).
 */
export function paymentProviderMode(env: NodeJS.ProcessEnv = process.env): string {
  const raw = env.PAYMENT_PROVIDER_MODE || env.PAYMENT_PROVIDER;
  return raw && raw !== 'undefined' ? raw : 'mock';
}

/**
 * The mock payment tools (POST /payments/mock/simulate-webhook) mark a
 * payment as paid without any money moving, so they exist only while
 * payments are mocked, and never in production. In live mode (`real` /
 * `razorpay`) they answer 404 like a route that is not there.
 */
export function mockPaymentToolsAllowed(env: NodeJS.ProcessEnv = process.env): boolean {
  if (env.NODE_ENV === 'production') return false;
  return paymentProviderMode(env) === 'mock';
}
