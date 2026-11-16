import type { MessageKey } from '@/i18n';

/**
 * What a staff "Send OTP" (POST /otp/send) answered, read one way everywhere
 * in Laboura Field. The server answers either a request (`requestId`) or,
 * when the number already belongs to a job seeker, a business or a referral
 * partner, `{ alreadyRegistered: true, type, code }` (type and code only when
 * the agent may see that record). Anything else is an empty answer, shown as
 * an error rather than doing nothing.
 */
export type OtpSendOutcome =
  | { kind: 'sent'; requestId: string; resendAvailableAt?: string }
  | { kind: 'duplicate'; type: 'job_seeker' | 'business' | 'referral' | null; code: string | null }
  | { kind: 'empty' };

export function readOtpSend(answer: unknown): OtpSendOutcome {
  const body = answer && typeof answer === 'object' ? (answer as Record<string, unknown>) : {};
  if (body.alreadyRegistered === true) {
    const type = body.type === 'job_seeker' || body.type === 'business' || body.type === 'referral' ? body.type : null;
    // `code` is the API's field; `existingCode` is accepted from older answers.
    const raw = typeof body.code === 'string' && body.code ? body.code : typeof body.existingCode === 'string' && body.existingCode ? body.existingCode : null;
    return { kind: 'duplicate', type, code: raw };
  }
  if (typeof body.requestId === 'string' && body.requestId) {
    return { kind: 'sent', requestId: body.requestId, resendAvailableAt: typeof body.resendAvailableAt === 'string' ? body.resendAvailableAt : undefined };
  }
  return { kind: 'empty' };
}

/** The message for an "already registered" answer: which kind of record, and its code when visible. */
export function duplicateMessage(
  outcome: { type: 'job_seeker' | 'business' | 'referral' | null; code: string | null },
  t: (key: MessageKey, params?: Record<string, string | number>) => string,
): string {
  if (!outcome.code) return t('otp.alreadyRegistered.hidden');
  const key: MessageKey =
    outcome.type === 'business' ? 'otp.alreadyRegistered.business' : outcome.type === 'referral' ? 'otp.alreadyRegistered.referral' : outcome.type === 'job_seeker' ? 'otp.alreadyRegistered.jobSeeker' : 'otp.alreadyRegistered.record';
  return t(key, { code: outcome.code });
}
