import { isApiError } from '@/api/errors';

/**
 * Steps that need the other person live — OTPs, calls, payment, login —
 * are never queued (guide: "Steps that need the other person live need
 * signal"). Leave and correction requests need signal too: the agent sees at
 * once where the request went and his balance, and a request is never sent
 * twice. The queue refuses these paths so a screen cannot queue one by
 * mistake.
 */
export const LIVE_ONLY_PATTERNS: readonly RegExp[] = [
  /^\/auth\//,
  /\/otp(\/|$)/,
  /-otp(\/|$)/,
  /\/verify(-code)?(\/|$)/,
  /^\/telephony\//,
  /\/calls?(\/|$)/,
  /\/payments?(\/|$)/,
  /\/payment-links?(\/|$)/,
  /\/payouts?(\/|$)/,
  /^\/attendance\/(leave|corrections)$/,
];

export function isLiveOnlyPath(path: string): boolean {
  return LIVE_ONLY_PATTERNS.some((pattern) => pattern.test(path));
}

/** Thrown when a live step is tried without signal. Screens show `common.needsSignal`. */
export class NeedsSignalError extends Error {
  constructor() {
    super('This step needs signal');
    this.name = 'NeedsSignalError';
  }
}

export function isNeedsSignalError(error: unknown): error is NeedsSignalError {
  return error instanceof NeedsSignalError;
}

/**
 * Runs a live step (OTP, call, payment link). Refuses straight away when the
 * phone knows it is offline, and turns "could not reach the server" into
 * NeedsSignalError so the screen says the right thing.
 */
export async function runLive<T>(isOnline: boolean, step: () => Promise<T>): Promise<T> {
  if (!isOnline) throw new NeedsSignalError();
  try {
    return await step();
  } catch (error) {
    if (isApiError(error) && error.isNetworkError) throw new NeedsSignalError();
    throw error;
  }
}
