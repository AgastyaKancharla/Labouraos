import { useEffect, useId, useState, type ReactNode } from 'react';
import { useT } from '../../i18n/I18nProvider';
import { api } from '../../lib/api/client';
import { isApiError } from '../../lib/api/errors';
import { isValidMobile, maskMobile } from '../../lib/format/phone';
import { useClock } from '../../lib/useNow';
import { Button } from '../Button';
import { OtpInput } from './OtpInput';

/**
 * Send OTP → Verify → Resend after 30 seconds, at most 3 resends
 * (guide, Forms). The screen supplies how to send and verify — usually
 * `useStaffOtp(purpose)` below — and gets `onVerified(requestId)`.
 *
 * When the send call answers "already registered", the component shows
 * "Already registered — open it" and calls `onAlreadyRegistered` instead of
 * creating a duplicate (guide: duplicate check on every registration).
 */
export const RESEND_WAIT_SECONDS = 30;
export const MAX_RESENDS = 3;

export type OtpSendResult =
  | { requestId: string; resendAvailableAt?: string | Date; resendsLeft?: number }
  | { alreadyRegistered: true; type?: string; code?: string };

export interface OtpVerificationProps {
  /** 10-digit mobile number the code goes to. */
  mobile: string;
  onSend: (mobile: string, previousRequestId?: string) => Promise<OtpSendResult>;
  onVerify: (requestId: string, code: string) => Promise<void>;
  onVerified: (requestId: string) => void;
  onAlreadyRegistered?: (record: { type?: string; code?: string }) => void;
  disabled?: boolean;
}

type State =
  | { step: 'idle' }
  | { step: 'sent'; requestId: string; resendAt: number; resendsLeft: number }
  | { step: 'verified'; requestId: string }
  | { step: 'duplicate'; type?: string; code?: string };

function errorText(err: unknown, fallback: string): string {
  return isApiError(err) ? err.message : fallback;
}

export function OtpVerification({ mobile, onSend, onVerify, onVerified, onAlreadyRegistered, disabled }: OtpVerificationProps) {
  const t = useT();
  const clock = useClock();
  const statusId = useId();
  const [state, setState] = useState<State>({ step: 'idle' });
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState<'send' | 'verify' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [now, setNow] = useState(() => clock().getTime());

  const waiting = state.step === 'sent' && state.resendAt > now;
  useEffect(() => {
    if (!waiting) return;
    const id = setInterval(() => setNow(clock().getTime()), 1000);
    return () => clearInterval(id);
  }, [waiting, clock]);

  // A different number starts over.
  useEffect(() => {
    setState({ step: 'idle' });
    setCode('');
    setError(null);
  }, [mobile]);

  const send = async () => {
    setBusy('send');
    setError(null);
    try {
      const previous = state.step === 'sent' ? state.requestId : undefined;
      const result = await onSend(mobile, previous);
      if ('alreadyRegistered' in result) {
        setState({ step: 'duplicate', type: result.type, code: result.code });
        return;
      }
      const current = clock().getTime();
      const serverResendAt = result.resendAvailableAt ? new Date(result.resendAvailableAt).getTime() : NaN;
      const resendsLeft =
        result.resendsLeft ?? (state.step === 'sent' ? Math.max(0, state.resendsLeft - 1) : MAX_RESENDS);
      setNow(current);
      setCode('');
      setState({
        step: 'sent',
        requestId: result.requestId,
        resendAt: Number.isFinite(serverResendAt) ? serverResendAt : current + RESEND_WAIT_SECONDS * 1000,
        resendsLeft,
      });
    } catch (err) {
      setError(errorText(err, t('error.server')));
    } finally {
      setBusy(null);
    }
  };

  const verify = async (value = code) => {
    if (state.step !== 'sent') return;
    if (value.length !== 6) {
      setError(t('form.otp.incomplete'));
      return;
    }
    setBusy('verify');
    setError(null);
    try {
      await onVerify(state.requestId, value);
      setState({ step: 'verified', requestId: state.requestId });
      onVerified(state.requestId);
    } catch (err) {
      setError(errorText(err, t('error.server')));
    } finally {
      setBusy(null);
    }
  };

  const canSend = isValidMobile(mobile) && !disabled;

  let status: ReactNode = null;
  if (state.step === 'verified') status = <span className="vok">✓ {t('form.otp.verified')}</span>;

  if (state.step === 'duplicate') {
    return (
      <div className="lb-otpflow" role="status">
        <Button variant="primary" onClick={() => onAlreadyRegistered?.({ type: state.type, code: state.code })}>
          {t('form.otp.alreadyRegistered')}
          {state.code ? ` · ${state.code}` : ''}
        </Button>
      </div>
    );
  }

  return (
    <div className="lb-otpflow">
      {state.step === 'idle' && (
        <Button variant="primary" onClick={send} disabled={!canSend} loading={busy === 'send'}>
          {t('form.otp.send')}
        </Button>
      )}
      {state.step === 'sent' && (
        <>
          <span className="sub" id={statusId}>
            {t('form.otp.sentTo', { mobile: maskMobile(mobile) })}
          </span>
          <div className="lb-otpflow__row">
            <OtpInput
              value={code}
              onChange={setCode}
              label={t('form.otp.code')}
              autoFocus
              describedBy={statusId}
              invalid={!!error}
              onComplete={(c) => void verify(c)}
              disabled={busy === 'verify'}
            />
            <Button variant="primary" onClick={() => void verify()} loading={busy === 'verify'}>
              {t('form.otp.verify')}
            </Button>
          </div>
          <div className="lb-otpflow__resend" aria-live="polite">
            {state.resendsLeft <= 0 ? (
              <span className="sub">{t('form.otp.noResends')}</span>
            ) : waiting ? (
              <span className="sub">{t('form.otp.resendIn', { seconds: Math.ceil((state.resendAt - now) / 1000) })}</span>
            ) : (
              <>
                <Button onClick={send} loading={busy === 'send'}>
                  {t('form.otp.resend')}
                </Button>
                <span className="sub">{t('form.otp.resendsLeft', { count: state.resendsLeft })}</span>
              </>
            )}
          </div>
        </>
      )}
      {status}
      {error && (
        <span className="vno" role="alert">
          {error}
        </span>
      )}
    </div>
  );
}

/** The staff OTP endpoints (POST /otp/send, /otp/verify) for a given purpose. */
export type OtpPurpose = 'job_seeker' | 'business_contact' | 'referral' | 'vacancy_confirm';

export function useStaffOtp(purpose: OtpPurpose) {
  return {
    send: (mobile: string, previousRequestId?: string) =>
      api.post<OtpSendResult>('/otp/send', { phone: mobile, purpose, requestId: previousRequestId }),
    verify: async (requestId: string, code: string) => {
      await api.post('/otp/verify', { requestId, code });
    },
  };
}
