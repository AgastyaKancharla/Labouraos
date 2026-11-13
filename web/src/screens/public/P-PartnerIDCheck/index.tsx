import { useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useT } from '../../../i18n/I18nProvider';
import type { MessageKey } from '../../../i18n/en';
import { isApiError } from '../../../lib/api/errors';
import { useScreenPath } from '../../../portals/PortalContext';
import { partnerApi, type IdCheckResult } from '../shared/api';
import { IdCheckPanel } from '../shared/IdCheckPanel';
import { usePartnerStepGuard } from '../shared/partner';
import { ActionError, isOtpExpired, LinkProblem, Loading, PageTitle, StepsBar, Warn } from '../shared/ui';

/**
 * Step 3 of the partner's link: the ID check, as on the job seeker's link
 * (P01d) — Aadhaar through DigiLocker, or another government ID (PAN,
 * driving licence, voter ID). The name must match the partner and they must
 * be 18 or older. Only the result is kept; no Aadhaar number is ever typed
 * or sent. When the ID service is down the partner can use another ID now.
 */
export default function PartnerIdCheckPage() {
  const t = useT();
  const { token, requestId, status, query, backToStart } = usePartnerStepGuard('id_check');
  const navigate = useNavigate();
  const to = useScreenPath();
  const queryClient = useQueryClient();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [result, setResult] = useState<IdCheckResult | null>(null);
  const [preferOtherId, setPreferOtherId] = useState(false);

  if (query.error) return <LinkProblem error={query.error} onRetry={() => void query.refetch()} />;
  if (!status) return <Loading />;

  const refresh = () => queryClient.invalidateQueries({ queryKey: ['partner-link', token] });

  if (status.stopped === 'under_18' || result?.isAdult === false) {
    return (
      <>
        <StepsBar current={3} label={t('pub.id.stepLabel')} />
        <PageTitle>{t('pub.id.title')}</PageTitle>
        <Warn>
          <strong>{t('partner.id.under18Title')}</strong> {t('partner.id.under18Body')}
        </Warn>
      </>
    );
  }

  const check = async (method: string, documentNumber?: string) => {
    setBusy(true);
    setError(null);
    setResult(null);
    try {
      const outcome = await partnerApi.idCheck(token, requestId, method, documentNumber);
      setResult(outcome);
      if (outcome.status === 'verified' && outcome.nameMatches === true && outcome.isAdult === true) {
        await refresh();
        navigate(to('P-PartnerUPI', { token }));
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

  if (status.idCheck.serviceDown && !preferOtherId) {
    return (
      <>
        <StepsBar current={3} label={t('pub.id.stepLabel')} />
        <Warn>
          <strong>{t('pub.busy.title')}</strong> {t('partner.id.busyBody')}
        </Warn>
        <button type="button" className="btn bp full" onClick={() => setPreferOtherId(true)}>
          {t('pub.busy.otherId')}
        </button>
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
