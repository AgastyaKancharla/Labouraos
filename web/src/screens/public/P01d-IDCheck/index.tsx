import { useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useT } from '../../../i18n/I18nProvider';
import type { MessageKey } from '../../../i18n/en';
import { isApiError } from '../../../lib/api/errors';
import { useScreenPath } from '../../../portals/PortalContext';
import { registrationApi, type IdCheckResult } from '../shared/api';
import { IdCheckPanel } from '../shared/IdCheckPanel';
import { useStepGuard } from '../shared/registration';
import { ActionError, isOtpExpired, LinkProblem, Loading, Muted, PageTitle, StepsBar, Warn } from '../shared/ui';

/**
 * P01d-IDCheck and P01e-IDBusy. Aadhaar through DigiLocker first; if it
 * fails (name doesn't match, phone not linked) or the service is down, PAN,
 * driving licence or voter ID work too. Under 18 stops here, before any
 * payment. Only the result is kept — never the Aadhaar number or photo.
 */
export default function IdCheck() {
  const t = useT();
  const { token, requestId, status, query, backToStart } = useStepGuard('id_check');
  const navigate = useNavigate();
  const to = useScreenPath();
  const queryClient = useQueryClient();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [result, setResult] = useState<IdCheckResult | null>(null);
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
      <IdCheckPanel busy={busy} failedMessage={failedMessage} onCheck={(method, number) => void check(method, number)} />
      <ActionError error={error} />
    </>
  );
}
