import { useId, useState } from 'react';
import { useT } from '../../../i18n/I18nProvider';
import type { MessageKey } from '../../../i18n/en';
import { Muted, Warn } from './ui';

/**
 * The ID step shared by the job seeker's link (P01d) and the referral
 * partner's link: Aadhaar through DigiLocker first; if it fails (name
 * doesn't match, phone not linked) PAN, driving licence or voter ID work
 * too. The page never asks for or sends an Aadhaar number — only the result
 * is kept (verified, 18+, name match, last 4 digits).
 */
export type OtherId = 'pan' | 'driving_licence' | 'voter_id';

export const OTHER_IDS: { id: OtherId; label: MessageKey; numberLabel: MessageKey; pattern: RegExp }[] = [
  { id: 'pan', label: 'pub.id.pan', numberLabel: 'pub.id.panNumber', pattern: /^[A-Z]{5}\d{4}[A-Z]$/ },
  { id: 'driving_licence', label: 'pub.id.dl', numberLabel: 'pub.id.dlNumber', pattern: /^[A-Z0-9-]{8,20}$/ },
  { id: 'voter_id', label: 'pub.id.voter', numberLabel: 'pub.id.voterNumber', pattern: /^[A-Z]{3}\d{7}$/ },
];

export function IdCheckPanel({
  busy,
  failedMessage,
  onCheck,
}: {
  busy: boolean;
  failedMessage: MessageKey | null;
  onCheck: (method: string, documentNumber?: string) => void;
}) {
  const t = useT();
  const inputId = useId();
  const [other, setOther] = useState<OtherId | null>(null);
  const [number, setNumber] = useState('');
  const otherDef = OTHER_IDS.find((o) => o.id === other);
  const cleanNumber = number.toUpperCase().replace(/\s+/g, '');

  return (
    <>
      {failedMessage && <Warn>{t(failedMessage)}</Warn>}
      <button type="button" className="btn bp full" disabled={busy} aria-busy={busy && !other ? true : undefined} onClick={() => onCheck('digilocker')}>
        {t('pub.id.aadhaar')}
      </button>
      <Muted>{t('pub.id.keep')}</Muted>
      <div className="card lb-pub-card">
        <strong>{t('pub.id.notWorking')}</strong>
        <span className="sub">{t('pub.id.notWorkingText')}</span>
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
              if (otherDef.pattern.test(cleanNumber)) onCheck(otherDef.id, cleanNumber);
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
    </>
  );
}
