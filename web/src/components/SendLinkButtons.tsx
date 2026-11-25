import { useState } from 'react';
import { useT } from '../i18n/I18nProvider';
import type { MessageKey } from '../i18n/en';
import { isApiError } from '../lib/api/errors';
import { Button } from './Button';

/**
 * The two send buttons wherever a call agent, field agent or Finance sends a
 * person a link (Master Guide rev 211): a primary "Send on WhatsApp" (WhatsApp
 * first; the server sends the SMS by itself if WhatsApp cannot take it or it is
 * not delivered within an hour) and a small "Send by SMS". The line under them
 * says which channel actually carried it (`sentBy` in the answer). Team Lead,
 * Manager and CEO screens never show these (the server refuses them too).
 */
export type SendChannel = 'whatsapp' | 'sms';
export type SentBy = 'whatsapp' | 'sms' | null;

/** The channel a send route answered with (`sentBy`), or 'unknown' when it did not say. */
export function sentByOf(res: unknown): SentBy | 'unknown' {
  if (!res || typeof res !== 'object' || !('sentBy' in res)) return 'unknown';
  const value = (res as { sentBy?: unknown }).sentBy;
  return value === 'whatsapp' || value === 'sms' ? value : null;
}

/** The result line for a send: which channel carried it. */
export function sentResultKey(pressed: SendChannel, res: unknown): MessageKey {
  const by = sentByOf(res);
  if (by === 'unknown') return pressed === 'sms' ? 'send.result.sms' : 'send.result.whatsapp';
  if (by === null) return 'send.result.none';
  if (by === 'sms') return pressed === 'whatsapp' ? 'send.result.smsFallback' : 'send.result.sms';
  return 'send.result.whatsapp';
}

export function SendLinkButtons({
  run,
  onSent,
  disabled,
  label,
  testId,
}: {
  /** Calls the send route with the channel picked. */
  run: (channel: SendChannel) => Promise<unknown>;
  onSent?: (res: unknown, channel: SendChannel) => void;
  disabled?: boolean;
  /** What is being sent ("Registration link"), shown above the buttons. */
  label?: string;
  testId?: string;
}) {
  const t = useT();
  const [busy, setBusy] = useState<SendChannel | null>(null);
  const [result, setResult] = useState<{ key: MessageKey; ok: boolean } | null>(null);
  const [error, setError] = useState<string | null>(null);

  const send = async (channel: SendChannel) => {
    setBusy(channel);
    setError(null);
    setResult(null);
    try {
      const res = await run(channel);
      const key = sentResultKey(channel, res);
      setResult({ key, ok: key !== 'send.result.none' });
      onSent?.(res, channel);
    } catch (e) {
      setError(isApiError(e) ? e.message : t('error.server'));
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="lb-send" data-testid={testId ?? 'send-link-buttons'}>
      {label && <span className="lbl">{label}</span>}
      <div className="lb-send__row">
        <Button variant="primary" onClick={() => void send('whatsapp')} loading={busy === 'whatsapp'} disabled={disabled || busy !== null}>
          {t('send.onWhatsApp')}
        </Button>
        <button type="button" className="lb-send__sms" onClick={() => void send('sms')} disabled={disabled || busy !== null} aria-busy={busy === 'sms' || undefined}>
          {t('send.bySms')}
        </button>
      </div>
      {result && (
        <span className={result.ok ? 'sub lb-send__result' : 'vno lb-send__result'} role="status" data-testid="send-result">
          {t(result.key)}
        </span>
      )}
      {error && (
        <span className="vno" role="alert">
          {error}
        </span>
      )}
    </div>
  );
}
