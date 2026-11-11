import { useQueryClient } from '@tanstack/react-query';
import { useId, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useT } from '../../../i18n/I18nProvider';
import type { MessageKey } from '../../../i18n/en';
import { isApiError } from '../../../lib/api/errors';
import { useScreenPath } from '../../../portals/PortalContext';
import { registrationApi, type IdCheckResult } from '../shared/api';
import { useStepGuard } from '../shared/registration';
import { ActionError, isOtpExpired, LinkProblem, Loading, Muted, PageTitle, StepsBar, Warn } from '../shared/ui';

/**
 * P01d-IDCheck and P01e-IDBusy. Aadhaar through DigiLocker first; if it
 * fails (name doesn't match, phone not linked) or the service is down, PAN,
 * driving licence or voter ID work too. Under 18 stops here, before any
 * payment. Only the result is kept — never the Aadhaar number or photo.
 */
type OtherId = 'pan' | 'driving_licence' | 'voter_id';

const OTHER_IDS: { id: OtherId; label: MessageKey; numberLabel: MessageKey; pattern: RegExp }[] = [
  { id: 'pan', label: 'pub.id.pan', numberLabel: 'pub.id.panNumber', pattern: /^[A-Z]{5}\d{4}[A-Z]$/ },
  { id: 'driving_licence', label: 'pub.id.dl', numberLabel: 'pub.id.dlNumber', pattern: /^[A-Z0-9-]{8,20}$/ },
  { id: 'voter_id', label: 'pub.id.voter', numberLabel: 'pub.id.voterNumber', pattern: /^[A-Z]{3}\d{7}$/ },
];

export default function IdCheck() {
  const t = useT();
  const { token, requestId, status, query, backToStart } = useStepGuard('id_check');
  const navigate = useNavigate();
  const to = useScreenPath();
  const queryClient = useQueryClient();
  const inputId = useId();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [result, setResult] = useState<IdCheckResult | null>(null);
  const [other, setOther] = useState<OtherId | null>(null);
  const [number, setNumber] = useState('');
  const [preferOtherId, setPreferOtherId] = useState(false);
  const [waiting, setWaiting] = useState(false);

  if (query.error) return <LinkProblem error={query.error} onRetry={() => void query.refetch()} />;
  if (!status) return <Loading />;

  const refresh = () => queryClient.invalidateQueries({ queryKey: ['registration', token] });

  if (status.stopped === 'under_18' || result?.isAdult === false) {
    return (
      <>
        <StepsBar current={3} label={t('pub.id.stepLabel')} />
        <PageTitle>{t('pub.id.title')}</PageTitle>
        <Warn>
          <strong>{t('pub.id.under18Title')}</strong> {t('pub.id.under18Body')}
        </Warn>
      </>
    );
  }

  const check = async (method: string, documentNumber?: string) => {
    setBusy(true);
    setError(null);
    setResult(null);
    try {
      const outcome = await registrationApi.idCheck(token, requestId, method, documentNumber);
      setResult(outcome);
      if (outcome.status === 'verified' && outcome.nameMatches !== false && outcome.isAdult !== false) {
        await refresh();
        navigate(to('P02-Payment', { token }));
      }
    } catch (e) {
      if (isOtpExpired(e)) {
        backToStart();
        return;
      }
      setError(e);
      if (isApiError(e) && e.status >= 500) await refresh();
    } finally {
      setBusy(false);
    }
  };

  const wait = async () => {
    setBusy(true);
    setError(null);
    try {
      await registrationApi.waitForIdService(token, requestId);
      setWaiting(true);
      await refresh();
    } catch (e) {
      if (isOtpExpired(e)) backToStart();
      else setError(e);
    } finally {
      setBusy(false);
    }
  };

  const serviceDown = status.idCheck.serviceDown && !preferOtherId;
  if (serviceDown) {
    const alreadyWaiting = waiting || status.idCheck.waitingForService;
    return (
      <>
        <StepsBar current={3} label={t('pub.id.stepLabel')} />
        <Warn>
          <strong>{t('pub.busy.title')}</strong> {t('pub.busy.body')}
        </Warn>
        <button type="button" className="btn bp full" onClick={() => setPreferOtherId(true)}>
          {t('pub.busy.otherId')}
        </button>
        {alreadyWaiting ? (
          <Warn>{t('pub.busy.waiting')}</Warn>
        ) : (
          <button type="button" className="btn bs full" disabled={busy} aria-busy={busy || undefined} onClick={() => void wait()}>
            {t('pub.busy.wait')}
          </button>
        )}
        <ActionError error={error} />
        <Muted>{t('pub.busy.note')}</Muted>
      </>
    );
  }

  const otherDef = OTHER_IDS.find((o) => o.id === other);
  const cleanNumber = number.toUpperCase().replace(/\s+/g, '');
  const failedMessage: MessageKey | null = result
    ? result.nameMatches === false
      ? 'pub.id.nameMismatch'
      : result.status !== 'verified'
        ? 'pub.id.failed'
        : null
    : status.idCheck.lastResult === 'name_mismatch'
      ? 'pub.id.nameMismatch'
      : status.idCheck.lastResult === 'failed'
        ? 'pub.id.failed'
        : null;

  return (
    <>
      <StepsBar current={3} label={t('pub.id.stepLabel')} />
      <PageTitle>{t('pub.id.title')}</PageTitle>
      {failedMessage && <Warn>{t(failedMessage)}</Warn>}
      <button type="button" className="btn bp full" disabled={busy} aria-busy={busy && !other ? true : undefined} onClick={() => void check('digilocker')}>
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
              if (otherDef.pattern.test(cleanNumber)) void check(otherDef.id, cleanNumber);
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
      <ActionError error={error} />
    </>
  );
}
