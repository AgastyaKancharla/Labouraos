import { useQuery } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { useI18n } from '../../../i18n/I18nProvider';
import { useNow } from '../../../lib/useNow';
import { paymentOnlyApi, type PaymentOnlyDetails } from '../shared/api';
import { rupees } from '../shared/format';
import { UpiAppButtons } from '../shared/UpiApps';
import { ActionError, LinkProblem, Loading, Muted, OtpBlock, PageTitle, PaidConfirming, UpiQr, Warn } from '../shared/ui';

/**
 * P02s-OtherPayer: someone else pays the ₹499 for a job seeker. The code goes
 * to the payer's number (the one the link was sent to). After it, the page
 * shows only her first name, JS- ID and the amount — no profile, no consent.
 * The link works for the minutes set in Settings (15 by default).
 */
export default function OtherPayer() {
  const { t } = useI18n();
  const token = useParams<{ token: string }>().token ?? '';
  const now = useNow(1000);
  const info = useQuery({ queryKey: ['payment-only', token], queryFn: () => paymentOnlyApi.info(token), enabled: Boolean(token) });
  const [requestId, setRequestId] = useState<string | null>(null);
  const [code, setCode] = useState('');
  const [verifying, setVerifying] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [details, setDetails] = useState<PaymentOnlyDetails | null>(null);
  const [tapped, setTapped] = useState(false);

  const expiresAt = details?.linkExpiresAt ?? info.data?.expiresAt;
  const secondsLeft = expiresAt ? Math.max(0, Math.floor((new Date(expiresAt).getTime() - now.getTime()) / 1000)) : null;

  useEffect(() => {
    if (details) window.scrollTo?.(0, 0);
  }, [details]);

  if (info.isLoading) return <Loading />;
  if (info.error || !info.data) return <LinkProblem error={info.error} onRetry={() => void info.refetch()} />;

  if (secondsLeft === 0) {
    return (
      <>
        <PageTitle emoji="⏰">{t('pub.other.expiredTitle')}</PageTitle>
        <Warn>{t('pub.other.expired')}</Warn>
      </>
    );
  }
  const timeLeft = secondsLeft === null ? '' : `${Math.floor(secondsLeft / 60)}:${String(secondsLeft % 60).padStart(2, '0')}`;

  if (!details) {
    const verify = async () => {
      if (!requestId || code.length !== 6) return;
      setVerifying(true);
      setError(null);
      try {
        setDetails(await paymentOnlyApi.verify(token, requestId, code));
      } catch (e) {
        setError(e);
        setCode('');
      } finally {
        setVerifying(false);
      }
    };
    return (
      <>
        <PageTitle emoji="🔒">{t('pub.other.lockedTitle')}</PageTitle>
        <span className="tag ta" style={{ alignSelf: 'flex-start' }}>
          {t('pub.other.timeLeft', { time: timeLeft })}
        </span>
        <Muted>{t('pub.other.lockedIntro')}</Muted>
        <OtpBlock
          maskedPhone={info.data.maskedPhone}
          send={() => paymentOnlyApi.sendOtp(token)}
          requestId={requestId}
          onRequestId={setRequestId}
          code={code}
          onCode={setCode}
          invalid={Boolean(error)}
        />
        <ActionError error={error} />
        {requestId && (
          <button type="button" className="btn bp full" disabled={code.length !== 6 || verifying} aria-busy={verifying || undefined} onClick={() => void verify()}>
            {t('common.continue')}
          </button>
        )}
      </>
    );
  }

  return (
    <>
      <PageTitle emoji="💳">{t('pub.other.title', { amount: rupees(details.amountPaise), name: details.displayName })}</PageTitle>
      <span className="sub">{t('pub.other.sub', { code: details.jobSeekerCode, name: details.firstName })}</span>
      <span className="tag ta" style={{ alignSelf: 'flex-start' }}>
        {t('pub.other.timeLeft', { time: timeLeft })}
      </span>
      <UpiQr svg={details.payment.qrSvg} payeeName={details.payment.payeeName} reference={details.payment.upiReference} />
      <UpiAppButtons upiUri={details.payment.upiUri} extraMethods={details.payment.extraMethods} onTap={() => setTapped(true)} />
      {tapped && <PaidConfirming />}
      <Muted>{t('pub.other.privacy')}</Muted>
    </>
  );
}
