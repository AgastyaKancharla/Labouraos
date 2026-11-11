import { useEffect, useId, useState, type ReactNode } from 'react';
import { OtpInput } from '../../../components/fields/OtpInput';
import { useI18n, useT, type Language } from '../../../i18n/I18nProvider';
import type { MessageKey } from '../../../i18n/en';
import { isApiError } from '../../../lib/api/errors';
import type { OtpSent } from './api';
import './public.css';

/** The ಕನ್ನಡ · हिंदी · EN switcher starts in the person's own language, once per link. */
export function usePersonLanguage(language: string | null | undefined, token: string | undefined) {
  const { setLanguage } = useI18n();
  useEffect(() => {
    if (!token) return;
    const lang = language === 'kn' || language === 'hi' || language === 'en' ? (language as Language) : null;
    if (!lang) return;
    const key = `laboura_p_lang:${token}`;
    try {
      if (sessionStorage.getItem(key)) return;
      sessionStorage.setItem(key, lang);
    } catch {
      /* storage blocked: still default once per page load */
    }
    setLanguage(lang);
  }, [language, token, setLanguage]);
}

/** "Step 2 of 4 · Selfie" with the four-segment bar (P01…P02). */
export function StepsBar({ current, label }: { current: 1 | 2 | 3 | 4; label: string }) {
  const t = useT();
  return (
    <div className="lb-steps">
      <div className="lb-steps__bar" aria-hidden="true">
        {[1, 2, 3, 4].map((n) => (
          <span key={n} className={n < current ? 'done' : n === current ? 'on' : ''} />
        ))}
      </div>
      <span className="sub">{t('pub.step', { n: current, label })}</span>
    </div>
  );
}

export function PageTitle({ children }: { children: ReactNode }) {
  return <h1 className="lb-pub-h2">{children}</h1>;
}

export function Muted({ children, className }: { children: ReactNode; className?: string }) {
  return <p className={className ? `lb-pub-muted ${className}` : 'lb-pub-muted'}>{children}</p>;
}

export function Row({ label, children }: { label: ReactNode; children: ReactNode }) {
  return (
    <div className="row">
      <span>{label}</span>
      <span>{children}</span>
    </div>
  );
}

/** One tappable choice row (checkbox or radio) — never pre-ticked by the page. */
export function Choice({
  type = 'checkbox',
  name,
  checked,
  onChange,
  title,
  description,
  disabled,
}: {
  type?: 'checkbox' | 'radio';
  name?: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
  title: ReactNode;
  description?: ReactNode;
  disabled?: boolean;
}) {
  return (
    <label className={checked ? 'opt on lb-pub-opt' : 'opt lb-pub-opt'}>
      <input type={type} name={name} checked={checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)} />
      <span className="lb-pub-opt__text">
        <span>{title}</span>
        {description && <span className="sub">{description}</span>}
      </span>
    </label>
  );
}

export function Ok({ children }: { children: ReactNode }) {
  return (
    <div className="ok" role="status">
      {children}
    </div>
  );
}

export function Warn({ children }: { children: ReactNode }) {
  return (
    <div className="warn" role="status">
      {children}
    </div>
  );
}

export function Loading() {
  const t = useT();
  return (
    <p className="lb-pub-muted" role="status" aria-live="polite">
      {t('common.loading')}
    </p>
  );
}

/** Turns an API failure into words a job seeker or owner can act on. */
export function problemKey(error: unknown): MessageKey {
  if (!isApiError(error)) return 'pub.error.generic';
  if (error.isNetworkError) return 'pub.error.offline';
  const message = error.message.toLowerCase();
  if (/\b(otp|code)\b/.test(message)) return 'pub.error.code';
  if (message.includes('expired')) return 'pub.error.expired';
  if (message.includes('already been used') || message.includes('no longer awaiting') || message.includes('no longer valid')) return 'pub.error.used';
  if (message.includes('revoked')) return 'pub.error.replaced';
  if (error.status === 404 || message.includes('not found') || message.includes('invalid') || message.includes('valid ')) return 'pub.error.invalid';
  if (error.status >= 500) return 'pub.error.server';
  return 'pub.error.generic';
}

export function isOtpExpired(error: unknown): boolean {
  return isApiError(error) && /otp|code/i.test(error.message) && error.status === 400;
}

export function LinkProblem({ error, onRetry }: { error: unknown; onRetry?: () => void }) {
  const t = useT();
  const key = problemKey(error);
  return (
    <>
      <PageTitle>{t('pub.error.title')}</PageTitle>
      <Warn>{t(key)}</Warn>
      {onRetry && (key === 'pub.error.offline' || key === 'pub.error.server' || key === 'pub.error.generic') && (
        <button type="button" className="btn bs full" onClick={onRetry}>
          {t('common.retry')}
        </button>
      )}
    </>
  );
}

/** A short inline error under an action, in the reader's language when we know the case. */
export function ActionError({ error }: { error: unknown }) {
  const t = useT();
  if (!error) return null;
  const key = problemKey(error);
  const text = key === 'pub.error.generic' && isApiError(error) ? error.message : t(key);
  return (
    <p className="vno" role="alert">
      {text}
    </p>
  );
}

const RESEND_SECONDS = 30;
const MAX_RESENDS = 3;

/**
 * "Code sent to ******2345" with the six digit boxes (P00, P02s, P04, P05).
 * Send → type the code; Resend unlocks after 30 seconds, at most 3 times.
 * The code always goes to the number on record; this page never sees it.
 */
export function OtpBlock({
  maskedPhone,
  send,
  requestId,
  onRequestId,
  code,
  onCode,
  invalid,
  hint,
}: {
  maskedPhone: string;
  send: () => Promise<OtpSent>;
  requestId: string | null;
  onRequestId: (requestId: string) => void;
  code: string;
  onCode: (code: string) => void;
  invalid?: boolean;
  hint?: ReactNode;
}) {
  const t = useT();
  const hintId = useId();
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [resends, setResends] = useState(0);
  const [wait, setWait] = useState(0);
  const [shownPhone, setShownPhone] = useState(maskedPhone);

  useEffect(() => {
    if (wait <= 0) return;
    const timer = setTimeout(() => setWait((w) => w - 1), 1000);
    return () => clearTimeout(timer);
  }, [wait]);

  const doSend = async (isResend: boolean) => {
    setSending(true);
    setError(null);
    try {
      const sent = await send();
      onRequestId(sent.requestId);
      if (sent.phone) setShownPhone(sent.phone);
      onCode('');
      setWait(RESEND_SECONDS);
      if (isResend) setResends((r) => r + 1);
    } catch (e) {
      setError(e);
    } finally {
      setSending(false);
    }
  };

  if (!requestId) {
    return (
      <div className="fld">
        <button type="button" className="btn bs full" disabled={sending} aria-busy={sending || undefined} onClick={() => void doSend(false)}>
          {t('pub.otp.send', { phone: maskedPhone })}
        </button>
        {hint && <span className="sub">{hint}</span>}
        <ActionError error={error} />
      </div>
    );
  }

  return (
    <div className="fld">
      <span className="lbl" id={`${hintId}-label`}>
        {t('pub.otp.sentTo', { phone: shownPhone })}
      </span>
      <OtpInput value={code} onChange={onCode} label={t('pub.otp.label')} autoFocus invalid={invalid} describedBy={hint ? hintId : undefined} />
      {hint && (
        <span className="sub" id={hintId}>
          {hint}
        </span>
      )}
      {resends < MAX_RESENDS && (
        <button type="button" className="lb-pub-link" disabled={wait > 0 || sending} onClick={() => void doSend(true)}>
          {wait > 0 ? t('pub.otp.resendIn', { seconds: wait }) : t('pub.otp.resend')}
        </button>
      )}
      <ActionError error={error} />
    </div>
  );
}

/** The UPI QR from the API, shown as an image (never injected as markup). */
export function UpiQr({ svg, payeeName, reference }: { svg: string; payeeName: string; reference: string }) {
  const t = useT();
  return (
    <div className="card lb-qr">
      <img src={`data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`} alt={t('pub.pay.qrAlt')} width={220} height={220} />
      <span className="sub">{t('pub.pay.payee', { payee: payeeName, reference })}</span>
    </div>
  );
}

/**
 * "Paid — confirming": shown after he taps Pay until the money is in
 * Laboura's bank. A screenshot is never proof; the optional UPI reference
 * only helps Finance find the credit faster.
 */
export function PaidConfirming({ onHint }: { onHint?: (utr: string) => Promise<unknown> }) {
  const t = useT();
  const [utr, setUtr] = useState('');
  const [saved, setSaved] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const inputId = useId();
  return (
    <>
      <Warn>
        <strong>{t('pub.confirming.title')}</strong> {t('pub.confirming.body')}
      </Warn>
      <Muted>{t('pub.confirming.noScreenshot')}</Muted>
      {onHint && !saved && (
        <form
          className="fld"
          onSubmit={(e) => {
            e.preventDefault();
            if (!/^\d{12}$/.test(utr)) return;
            setBusy(true);
            setError(null);
            onHint(utr)
              .then(() => setSaved(true))
              .catch(setError)
              .finally(() => setBusy(false));
          }}
        >
          <label htmlFor={inputId}>{t('pub.confirming.utrLabel')}</label>
          <input
            id={inputId}
            inputMode="numeric"
            autoComplete="off"
            maxLength={12}
            value={utr}
            onChange={(e) => setUtr(e.target.value.replace(/\D/g, '').slice(0, 12))}
          />
          <button type="submit" className="btn bs full" disabled={utr.length !== 12 || busy}>
            {t('pub.confirming.utrSend')}
          </button>
          <ActionError error={error} />
        </form>
      )}
      {saved && <Muted>{t('pub.confirming.utrSaved')}</Muted>}
    </>
  );
}

/** Per-link memory in this browser tab (verified OTP request, "I tapped Pay"); falls back to memory when storage is blocked. */
const memoryFallback = new Map<string, string>();
export const tabMemory = {
  get(key: string): string | null {
    try {
      return sessionStorage.getItem(key);
    } catch {
      return memoryFallback.get(key) ?? null;
    }
  },
  set(key: string, value: string) {
    try {
      sessionStorage.setItem(key, value);
    } catch {
      memoryFallback.set(key, value);
    }
  },
  remove(key: string) {
    memoryFallback.delete(key);
    try {
      sessionStorage.removeItem(key);
    } catch {
      /* storage blocked */
    }
  },
};
