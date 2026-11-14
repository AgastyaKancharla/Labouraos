import { useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useT } from '../../../i18n/I18nProvider';
import type { MessageKey } from '../../../i18n/en';
import { isApiError } from '../../../lib/api/errors';
import { useScreenPath } from '../../../portals/PortalContext';
import { registrationApi, type AadhaarQrResult, type IdCheckResult } from '../shared/api';
import { IdCheckPanel } from '../shared/IdCheckPanel';
import { useStepGuard } from '../shared/registration';
import { ActionError, isOtpExpired, LinkProblem, Loading, PageTitle, StepsBar, Warn } from '../shared/ui';

/**
 * P01d-IDCheck (guide, "Aadhaar verification", 14 Nov): Aadhaar by its Secure
 * QR — scanned with his phone's camera, or read from his e-Aadhaar PDF opened
 * in the browser — or another government ID (PAN, driving licence, voter ID).
 * Only the QR's text is sent; UIDAI's signature, 18+, the name and the phone
 * link are checked by the server. Under 18 stops here, before any payment.
 * The PAN / driving licence / voter ID check can be down (P01e); the QR
 * check is in-house and never is.
 */
export default function IdCheck() {
  const t = useT();
  const { token, requestId, status, query, backToStart } = useStepGuard('id_check');
  const navigate = useNavigate();
  const to = useScreenPath();
  const queryClient = useQueryClient();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [qrResult, setQrResult] = useState<AadhaarQrResult | null>(null);
  const [otherResult, setOtherResult] = useState<IdCheckResult | null>(null);
  const [waiting, setWaiting] = useState(false);

  if (query.error) return <LinkProblem error={query.error} onRetry={() => void query.refetch()} />;
  if (!status) return <Loading />;

  const refresh = () => queryClient.invalidateQueries({ queryKey: ['registration', token] });

  if (status.stopped === 'under_18' || qrResult?.isAdult === false || otherResult?.isAdult === false) {
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
      const outcome = await registrationApi.aadhaarQr(token, requestId, qrText);
      // The green result stays on screen until he taps Continue (the status would move the page on).
      setQrResult(outcome);
    });

  const checkOtherId = (method: string, documentNumber: string) =>
    run(async () => {
      setQrResult(null);
      const outcome = await registrationApi.idCheck(token, requestId, method, documentNumber);
      setOtherResult(outcome);
      if (outcome.status === 'verified' && outcome.nameMatches !== false && outcome.isAdult !== false) {
        await refresh();
        navigate(to('P02-Payment', { token }));
      }
    });

  const wait = () =>
    run(async () => {
      await registrationApi.waitForIdService(token, requestId);
      setWaiting(true);
      await refresh();
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
        onContinue={() => void refresh().then(() => navigate(to('P02-Payment', { token })))}
        otherIdService={{ down: status.idCheck.serviceDown, waiting: waiting || status.idCheck.waitingForService, onWait: () => void wait() }}
      />
      <ActionError error={error} />
    </>
  );
}
