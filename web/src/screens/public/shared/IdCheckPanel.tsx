import { useEffect, useId, useState } from 'react';
import { useT } from '../../../i18n/I18nProvider';
import type { MessageKey } from '../../../i18n/en';
import type { AadhaarQrResult } from './api';
import { AadhaarQrScanner } from './aadhaar/AadhaarQrScanner';
import { EAadhaarPdf } from './aadhaar/EAadhaarPdf';
import { Muted, Ok, Warn } from './ui';

/**
 * The ID step shared by the job seeker's link (P01d) and the referral
 * partner's link (guide, "Aadhaar verification", 14 Nov):
 *
 *   - "Aadhaar: scan the QR code" — the phone's camera reads the Secure QR on
 *     the card, in the browser;
 *   - "Aadhaar: open e-Aadhaar PDF" — the PDF is opened in the browser with its
 *     password and the QR on it is read;
 *   - "Another ID" — PAN, driving licence or voter ID, always offered (UIDAI:
 *     nobody may be refused for not using Aadhaar), and suggested whenever the
 *     QR can't be used or the name doesn't match.
 *
 * Only the QR's text is sent: never a picture of the card, never the PDF.
 * UIDAI's signature, 18+, the name and the phone link are checked by Laboura's
 * server; the page shows the result.
 */
export type OtherId = 'pan' | 'driving_licence' | 'voter_id';
type Mode = 'choose' | 'scan' | 'pdf' | 'other';

export const OTHER_IDS: { id: OtherId; label: MessageKey; numberLabel: MessageKey; pattern: RegExp }[] = [
  { id: 'pan', label: 'pub.id.pan', numberLabel: 'pub.id.panNumber', pattern: /^[A-Z]{5}\d{4}[A-Z]$/ },
  { id: 'driving_licence', label: 'pub.id.dl', numberLabel: 'pub.id.dlNumber', pattern: /^[A-Z0-9-]{8,20}$/ },
  { id: 'voter_id', label: 'pub.id.voter', numberLabel: 'pub.id.voterNumber', pattern: /^[A-Z]{3}\d{7}$/ },
];

const QR_PROBLEM: Partial<Record<AadhaarQrResult['result'], MessageKey>> = {
  name_mismatch: 'pub.qr.nameMismatch',
  old_qr: 'pub.qr.oldCard',
  bad_signature: 'pub.qr.badSignature',
  unreadable: 'pub.qr.unreadable',
};

const GENDER: Record<string, MessageKey> = { M: 'pub.qr.genderM', F: 'pub.qr.genderF', T: 'pub.qr.genderT' };

export function IdCheckPanel({
  busy,
  qrResult,
  otherIdFailed,
  onQr,
  onOtherId,
  onContinue,
  otherIdService,
}: {
  busy: boolean;
  /** The last Aadhaar QR answer on this page. */
  qrResult: AadhaarQrResult | null;
  /** A failed other-ID try (or the last result from the status). */
  otherIdFailed: MessageKey | null;
  onQr: (qrText: string) => void;
  onOtherId: (method: OtherId, documentNumber: string) => void;
  /** After "Aadhaar verified by UIDAI". */
  onContinue: () => void;
  /** The PAN / driving licence / voter ID check is down (the QR check never is). */
  otherIdService?: { down: boolean; waiting: boolean; onWait?: () => void };
}) {
  const t = useT();
  const inputId = useId();
  const [mode, setMode] = useState<Mode>('choose');
  const [other, setOther] = useState<OtherId | null>(null);
  const [number, setNumber] = useState('');
  const otherDef = OTHER_IDS.find((o) => o.id === other);
  const cleanNumber = number.toUpperCase().replace(/\s+/g, '');

  // A QR that can't be used (or a name that doesn't match) opens "Another ID".
  useEffect(() => {
    if (qrResult && qrResult.offerOtherId) setMode('other');
    else if (qrResult) setMode('choose');
  }, [qrResult]);

  if (qrResult?.result === 'verified') {
    const person = qrResult.person;
    return (
      <div className="lb-aq" data-testid="aadhaar-verified">
        <Ok>
          <strong>{t('pub.qr.verified')}</strong>
          {qrResult.maskedReference ? <> · {qrResult.maskedReference}</> : null}
        </Ok>
        {person && (
          <div className="card lb-pub-card lb-aq__person">
            <span className="sub">{t('pub.qr.name')}</span>
            <strong>{person.name}</strong>
            <span className="sub">{t('pub.qr.dob')}</span>
            <strong>{formatDob(person.dateOfBirth)}</strong>
            <span className="sub">{t('pub.qr.gender')}</span>
            <strong>{person.gender && GENDER[person.gender] ? t(GENDER[person.gender]!) : '—'}</strong>
          </div>
        )}
        <button type="button" className="btn bp full" onClick={onContinue}>
          {t('pub.qr.continue')}
        </button>
      </div>
    );
  }

  if (mode === 'scan') return <AadhaarQrScanner onText={(text) => onQr(text)} onCancel={() => setMode('choose')} />;
  if (mode === 'pdf') return <EAadhaarPdf onText={(text) => onQr(text)} onCancel={() => setMode('choose')} />;

  const qrProblem = qrResult ? QR_PROBLEM[qrResult.result] : null;
  return (
    <>
      {busy && !other && <Muted>{t('pub.qr.checking')}</Muted>}
      {qrProblem && <Warn>{t(qrProblem)}</Warn>}
      {!qrProblem && otherIdFailed && <Warn>{t(otherIdFailed)}</Warn>}
      <button type="button" className={mode === 'other' ? 'btn bs full' : 'btn bp full'} disabled={busy} onClick={() => setMode('scan')}>
        {t('pub.id.scanQr')}
      </button>
      <button type="button" className="btn bs full" disabled={busy} onClick={() => setMode('pdf')}>
        {t('pub.id.openPdf')}
      </button>
      <button type="button" className={mode === 'other' ? 'btn bp full' : 'btn bs full'} aria-expanded={mode === 'other'} onClick={() => setMode(mode === 'other' ? 'choose' : 'other')}>
        {t('pub.id.otherId')}
      </button>
      {mode === 'other' && (
        <div className="card lb-pub-card" data-testid="other-id">
          <span className="sub">{t('pub.id.otherIdText')}</span>
          {otherIdService?.down && (
            <>
              <Warn>
                <strong>{t('pub.busy.title')}</strong> {t('pub.busy.body')}
              </Warn>
              {otherIdService.onWait &&
                (otherIdService.waiting ? (
                  <Muted>{t('pub.busy.waiting')}</Muted>
                ) : (
                  <button type="button" className="btn bs full" disabled={busy} onClick={otherIdService.onWait}>
                    {t('pub.busy.wait')}
                  </button>
                ))}
            </>
          )}
          {OTHER_IDS.map((o) => (
            <button
              key={o.id}
              type="button"
              className={other === o.id ? 'btn bp full' : 'btn bs full'}
              aria-expanded={other === o.id}
              onClick={() => {
                setOther(o.id);
                setNumber('');
              }}
            >
              {t(o.label)}
            </button>
          ))}
          {otherDef && (
            <form
              className="fld"
              onSubmit={(e) => {
                e.preventDefault();
                if (otherDef.pattern.test(cleanNumber)) onOtherId(otherDef.id, cleanNumber);
              }}
            >
              <label htmlFor={inputId}>{t(otherDef.numberLabel)}</label>
              <input
                id={inputId}
                value={number}
                autoCapitalize="characters"
                autoComplete="off"
                maxLength={20}
                onChange={(e) => setNumber(e.target.value)}
                aria-invalid={number.length > 0 && !otherDef.pattern.test(cleanNumber) ? true : undefined}
              />
              <button type="submit" className="btn bp full" disabled={!otherDef.pattern.test(cleanNumber) || busy} aria-busy={busy || undefined}>
                {t('pub.id.verify')}
              </button>
            </form>
          )}
        </div>
      )}
      <div className="card lb-pub-card lb-aq__privacy" data-testid="id-privacy">
        <span className="sub">
          <strong>{t('pub.id.readTitle')}</strong> {t('pub.id.read')}
        </span>
        <span className="sub">
          <strong>{t('pub.id.keptTitle')}</strong> {t('pub.id.kept')}
        </span>
        <span className="sub">
          <strong>{t('pub.id.neverTitle')}</strong> {t('pub.id.never')}
        </span>
      </div>
    </>
  );
}

/** 1998-08-15 → 15-08-1998 (as printed on the card); a year alone stays a year. */
function formatDob(value: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  return m ? `${m[3]}-${m[2]}-${m[1]}` : value || '—';
}
