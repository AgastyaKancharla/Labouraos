import { useEffect, useId, useState, type ReactNode } from 'react';
import { OtpInput } from '../../../components/fields/OtpInput';
import { useT } from '../../../i18n/I18nProvider';
import type { MessageKey } from '../../../i18n/en';
import { isApiError } from '../../../lib/api/errors';
import type { OtpSent } from './api';
import './public.css';

/** "Step 2 of 4 · Selfie" with the four-segment bar (P01…P02). */
export function StepsBar({ current, label }: { current: 1 | 2 | 3 | 4; label: string }) {
  const t = useT();
  return (
    <div className="lb-steps">
      <div className="lb-steps__bar" aria-hidden="true">
        {[1, 2, 3, 4].map((n) => (
          <span key={n} className={`lb-steps__seg-${n} ${n < current ? 'done' : n === current ? 'on' : ''}`.trim()} />
        ))}
      </div>
      <span className="sub">{t('pub.step', { n: current, label })}</span>
    </div>
  );
}

/**
 * The page heading in a blue gradient header card with the brand swoosh —
 * the customer app's look, so a page opened from a link or inside the app
 * feels the same. The emoji is a friendly picture only (hidden from screen readers).
 */
export function PageTitle({ children, emoji }: { children: ReactNode; emoji?: string }) {
  return (
    <div className="lb-pub-hero">
      {emoji && (
        <span className="lb-pub-hero__emoji" aria-hidden="true">
          {emoji}
        </span>
      )}
      <h1 className="lb-pub-h2">{children}</h1>
      <span className="swoosh lb-pub-hero__swoosh" aria-hidden="true" />
    </div>
  );
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
  missing,
}: {
  type?: 'checkbox' | 'radio';
  name?: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
  title: ReactNode;
  description?: ReactNode;
  disabled?: boolean;
  /** 22 Nov: highlighted when a button was pressed without this box ticked. */
  missing?: boolean;
}) {
  return (
    <label className={`${checked ? 'opt on lb-pub-opt' : 'opt lb-pub-opt'}${missing && !checked ? ' lb-pub-opt--missing' : ''}`}>
      <input type={type} name={name} checked={checked} disabled={disabled} aria-invalid={missing && !checked ? true : undefined} onChange={(e) => onChange(e.target.checked)} />
      <span className="lb-pub-opt__text">
        <span>{title}</span>
        {description && <span className="sub">{description}</span>}
      </span>
    </label>
  );
}

function StatusEmoji({ emoji }: { emoji?: string }) {
  if (!emoji) return null;
  return (
    <span className="lb-pub-status__emoji" aria-hidden="true">
      {emoji}
    </span>
  );
}

export function Ok({ children, emoji }: { children: ReactNode; emoji?: string }) {
  return (
    <div className={emoji ? 'ok lb-pub-status' : 'ok'} role="status">
      <StatusEmoji emoji={emoji} />
      {emoji ? <span>{children}</span> : children}
    </div>
  );
}

export function Warn({ children, emoji }: { children: ReactNode; emoji?: string }) {
  return (
    <div className={emoji ? 'warn lb-pub-status' : 'warn'} role="status">
      <StatusEmoji emoji={emoji} />
      {emoji ? <span>{children}</span> : children}
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
  if (error.status === 429) return 'pub.error.tooMany';
  const message = error.message.toLowerCase();
  // Rev 181 (H2): a possible match with a banned person is being checked — a neutral message, never "ban".
  if (error.status === 409 && message.includes('being checked by our team')) return 'pub.error.underReview';
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
      <PageTitle emoji="⚠️">{t('pub.error.title')}</PageTitle>
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

/**
 * 22 Nov (owner testing): a refused "Send code" shows the server's own message (why it was refused),
 * not a guess from its words (a message about "codes" is not a wrong code). Offline / server errors
 * keep the usual wording.
 */
export function SendError({ error }: { error: unknown }) {
  if (!error) return null;
  if (isApiError(error) && !error.isNetworkError && error.status >= 400 && error.status < 500 && error.status !== 429 && error.message) {
    return (
      <p className="vno" role="alert">
        {error.message}
      </p>
    );
  }
  return <ActionError error={error} />;
}

const RESEND_SECONDS = 30;
const MAX_RESENDS = 3;

/**
 * "Code sent to ******2345" with the six digit boxes (P00, P02s, P04, P05).
 * Send → type the code; Resend unlocks after 30 seconds, at most 3 times.
 * The code always goes to the number on record; this page never sees it.
 */
/**
 * The owner's OTP on a public page. By default: "Send code to …", then the
 * code box (the page has its own submit button). With `onComplete` it is the
 * one-step flow of rev 193 (agreement, vacancy confirmation): a single primary
 * button (`sendLabel`, e.g. "Send code to sign") sends the code, and typing
 * the sixth digit submits it — signing or confirming in the same step, with no
 * second button. `submitting` shows that the code is being checked.
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
  sendLabel,
  sendDisabled,
  onComplete,
  submitting,
  submittingLabel,
  checkBeforeSend,
  onBlocked,
}: {
  maskedPhone: string;
  send: () => Promise<OtpSent>;
  requestId: string | null;
  onRequestId: (requestId: string) => void;
  code: string;
  onCode: (code: string) => void;
  invalid?: boolean;
  hint?: ReactNode;
  /** The send button's words; default "Send code to {phone}". */
  sendLabel?: string;
  /** Keeps the send button off until the page is ready (name, ticks). */
  sendDisabled?: boolean;
  /** One-step flow: called with the code when the sixth digit is typed. */
  onComplete?: (code: string) => void;
  submitting?: boolean;
  submittingLabel?: string;
  /**
   * 22 Nov (owner testing): instead of a silently disabled button, the button stays on and this
   * says what is missing (null = ready). The reason is shown next to the button.
   */
  checkBeforeSend?: () => string | null;
  /** Called when a press was blocked by checkBeforeSend (the page marks the missing fields). */
  onBlocked?: () => void;
}) {
  const t = useT();
  const hintId = useId();
  // After a press that was blocked, the reason stays up to date as the fields are filled in.
  const [triedBlocked, setTriedBlocked] = useState(false);
  const blocked = triedBlocked && checkBeforeSend ? checkBeforeSend() : null;
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
    const missing = checkBeforeSend ? checkBeforeSend() : null;
    if (missing) {
      setTriedBlocked(true);
      onBlocked?.();
      return;
    }
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

  const typed = (value: string) => {
    onCode(value);
    if (onComplete && value.length === 6 && !submitting) onComplete(value);
  };

  if (!requestId) {
    return (
      <div className="fld">
        <button
          type="button"
          className={`btn ${onComplete ? 'bp' : 'bs'} full`}
          disabled={sending || (sendDisabled && !checkBeforeSend)}
          aria-busy={sending || undefined}
          onClick={() => void doSend(false)}
        >
          {sendLabel ?? t('pub.otp.send', { phone: maskedPhone })}
        </button>
        {blocked ? (
          <span className="lb-pub-blocked" role="alert" data-testid="send-blocked">
            {blocked}
          </span>
        ) : (
          hint && <span className="sub">{hint}</span>
        )}
        <SendError error={error} />
      </div>
    );
  }

  return (
    <div className="fld">
      <span className="lbl" id={`${hintId}-label`}>
        {t('pub.otp.sentTo', { phone: shownPhone })}
      </span>
      <OtpInput value={code} onChange={typed} label={t('pub.otp.label')} autoFocus invalid={invalid} describedBy={hint ? hintId : undefined} />
      {hint && (
        <span className="sub" id={hintId}>
          {hint}
        </span>
      )}
      {submitting && (
        <span className="sub" role="status">
          {submittingLabel}
        </span>
      )}
      {resends < MAX_RESENDS && (
        <button type="button" className="lb-pub-link" disabled={wait > 0 || sending || submitting} onClick={() => void doSend(true)}>
          {wait > 0 ? t('pub.otp.resendIn', { seconds: wait }) : t('pub.otp.resend')}
        </button>
      )}
      <SendError error={error} />
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
      <Warn emoji="⏳">
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
