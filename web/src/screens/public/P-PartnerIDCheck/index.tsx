import { useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useT } from '../../../i18n/I18nProvider';
import type { MessageKey } from '../../../i18n/en';
import { isApiError } from '../../../lib/api/errors';
import { useScreenPath } from '../../../portals/PortalContext';
import { partnerApi, type AadhaarQrResult, type IdCheckResult } from '../shared/api';
import { IdCheckPanel } from '../shared/IdCheckPanel';
import { usePartnerStepGuard } from '../shared/partner';
import { ActionError, isOtpExpired, LinkProblem, Loading, PageTitle, StepsBar, Warn } from '../shared/ui';

/**
 * Step 3 of the partner's link: the same ID step as the job seeker's link
 * (P01d, guide 14 Nov) — Aadhaar by its Secure QR (camera or e-Aadhaar PDF,
 * read on the phone; only the QR's text is sent) or another government ID
 * (PAN, driving licence, voter ID). The name must match the partner and they
 * must be 18 or older.
 */
export default function PartnerIdCheckPage() {
  const t = useT();
  const { token, requestId, status, query, backToStart } = usePartnerStepGuard('id_check');
  const navigate = useNavigate();
  const to = useScreenPath();
  const queryClient = useQueryClient();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [qrResult, setQrResult] = useState<AadhaarQrResult | null>(null);
  const [otherResult, setOtherResult] = useState<IdCheckResult | null>(null);

  if (query.error) return <LinkProblem error={query.error} onRetry={() => void query.refetch()} />;
  if (!status) return <Loading />;

  const refresh = () => queryClient.invalidateQueries({ queryKey: ['partner-link', token] });

  if (status.stopped === 'under_18' || qrResult?.isAdult === false || otherResult?.isAdult === false) {
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

  const run = async (work: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    try {
      await work();
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

  const checkQr = (qrText: string) =>
    run(async () => {
      setOtherResult(null);
      setQrResult(await partnerApi.aadhaarQr(token, requestId, qrText));
    });

  const checkOtherId = (method: string, documentNumber: string) =>
    run(async () => {
      setQrResult(null);
      const outcome = await partnerApi.idCheck(token, requestId, method, documentNumber);
      setOtherResult(outcome);
      if (outcome.status === 'verified' && outcome.nameMatches === true && outcome.isAdult === true) {
        await refresh();
        navigate(to('P-PartnerUPI', { token }));
      }
    });

  const otherIdFailed: MessageKey | null = otherResult
    ? otherResult.nameMatches === false
      ? 'pub.id.nameMismatch'
      : otherResult.status !== 'verified'
        ? 'pub.id.failed'
        : null
    : !qrResult && status.idCheck.lastResult === 'name_mismatch'
      ? 'pub.id.nameMismatch'
      : !qrResult && status.idCheck.lastResult === 'failed'
        ? 'pub.id.failed'
        : null;

  return (
    <>
      <StepsBar current={3} label={t('pub.id.stepLabel')} />
      <PageTitle>{t('pub.id.title')}</PageTitle>
      <IdCheckPanel
        busy={busy}
        qrResult={qrResult}
        otherIdFailed={otherIdFailed}
        onQr={(text) => void checkQr(text)}
        onOtherId={(method, number) => void checkOtherId(method, number)}
        onContinue={() => void refresh().then(() => navigate(to('P-PartnerUPI', { token })))}
        otherIdService={{ down: status.idCheck.serviceDown, waiting: false }}
      />
      <ActionError error={error} />
    </>
  );
}
