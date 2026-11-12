import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { MobileField } from '../../../components/fields/MobileField';
import { useI18n } from '../../../i18n/I18nProvider';
import type { MessageKey } from '../../../i18n/en';
import { useScreenPath } from '../../../portals/PortalContext';
import { paymentApi, registrationApi } from '../shared/api';
import { rupees } from '../shared/format';
import { paidTappedKey, useStepGuard } from '../shared/registration';
import { ActionError, Choice, isOtpExpired, LinkProblem, Loading, Muted, PageTitle, Row, StepsBar, tabMemory, UpiQr, Warn } from '../shared/ui';

/**
 * P02-Payment, the last step: his exact guarantee terms, a tick to agree, then
 * a UPI QR and link made just for him (exact amount and reference, to the
 * company account). Someone else can pay with a payment-only link. Paying
 * never shows "done" here — the next page waits for the bank.
 */
const SHIFT: Record<string, MessageKey> = {
  day: 'pub.shift.day',
  night: 'pub.shift.night',
  rotational: 'pub.shift.rotational',
  any: 'pub.shift.any',
};

const JOB_TYPE: Record<string, MessageKey> = {
  full_time: 'pub.job.fullTime',
  part_time: 'pub.job.partTime',
  live_in: 'pub.job.liveIn',
};

export default function Payment() {
  const { t } = useI18n();
  const { token, requestId, status, query, backToStart } = useStepGuard('payment');
  const navigate = useNavigate();
  const to = useScreenPath();
  const queryClient = useQueryClient();
  const [accepting, setAccepting] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [otherOpen, setOtherOpen] = useState(false);
  const [otherPhone, setOtherPhone] = useState('');
  const [sendingOther, setSendingOther] = useState(false);
  const [otherSent, setOtherSent] = useState(false);
  const [otherError, setOtherError] = useState<unknown>(null);

  const blocked = !status || status.waitingForTrade || status.stopped !== null;
  const terms = useQuery({
    queryKey: ['registration-terms', token, requestId],
    queryFn: () => registrationApi.terms(token, requestId),
    enabled: !blocked,
  });
  const reference = status?.payment.upiReference ?? null;
  const summary = useQuery({
    queryKey: ['payment-summary', reference],
    queryFn: () => paymentApi.summary(reference!),
    enabled: Boolean(reference),
  });

  const termsExpired = Boolean(terms.error) && isOtpExpired(terms.error);
  useEffect(() => {
    if (termsExpired) backToStart();
  }, [termsExpired, backToStart]);

  if (query.error) return <LinkProblem error={query.error} onRetry={() => void query.refetch()} />;
  if (!status) return <Loading />;

  const header = (
    <>
      <StepsBar current={4} label={t('pub.pay.stepLabel')} />
      <PageTitle>{t('pub.pay.title', { amount: rupees(status.payment.amountPaise) })}</PageTitle>
    </>
  );

  if (status.waitingForTrade) {
    return (
      <>
        {header}
        <Warn>{t('pub.pay.waitingForTrade')}</Warn>
      </>
    );
  }
  if (terms.error) {
    if (termsExpired) return <Loading />;
    return <LinkProblem error={terms.error} onRetry={() => void terms.refetch()} />;
  }
  if (!terms.data) return <Loading />;

  const accepted = Boolean(status.termsAcceptedAt) && Boolean(reference);
  const accept = async () => {
    setAccepting(true);
    setError(null);
    try {
      await registrationApi.acceptTerms(token, requestId);
      await queryClient.invalidateQueries({ queryKey: ['registration', token] });
    } catch (e) {
      if (isOtpExpired(e)) backToStart();
      else setError(e);
    } finally {
      setAccepting(false);
    }
  };

  const sendOther = async () => {
    setSendingOther(true);
    setOtherError(null);
    try {
      await registrationApi.sendPaymentOnlyLink(token, requestId, `+91${otherPhone}`);
      setOtherSent(true);
    } catch (e) {
      if (isOtpExpired(e)) backToStart();
      else setOtherError(e);
    } finally {
      setSendingOther(false);
    }
  };

  const tr = terms.data;
  const suitable = [
    tr.trade,
    tr.travelDistanceKm !== null
      ? tr.locality
        ? t('pub.pay.withinKmOf', { km: tr.travelDistanceKm, area: tr.locality })
        : t('pub.pay.withinKm', { km: tr.travelDistanceKm })
      : null,
    tr.shiftPreference ? t(SHIFT[tr.shiftPreference] ?? 'pub.shift.any') : null,
    tr.jobType && JOB_TYPE[tr.jobType] ? t(JOB_TYPE[tr.jobType]!) : null,
    t('pub.pay.atLeast', { amount: rupees(tr.guaranteeFloorPaise) }),
  ]
    .filter(Boolean)
    .join(' · ');
  const pay = summary.data?.pay ?? null;

  return (
    <>
      {header}
      <div className="card lb-pub-card">
        <div className="lbl">{t('pub.pay.guarantee')}</div>
        <div className="row">
          <span>{t('pub.pay.guaranteeLine', { days: tr.guaranteeDays, amount: rupees(tr.amountPaise) })}</span>
        </div>
        <div className="row lb-pub-row-col">
          <strong>{t('pub.pay.suitableTitle')}</strong>
          <span className="sub">{suitable}</span>
        </div>
        <div className="row">
          <span>{t('pub.pay.rules')}</span>
        </div>
      </div>
      <Choice
        checked={accepted}
        disabled={accepting}
        onChange={(checked) => {
          // Once agreed it is recorded; the box stays ticked.
          if (checked && !accepted) void accept();
        }}
        title={t('pub.pay.agree')}
      />
      <ActionError error={error} />
      {accepted && pay ? (
        <UpiQr svg={pay.qrSvg} payeeName={pay.payeeName} reference={pay.upiReference} />
      ) : (
        <div className="card lb-qr lb-qr--waiting">
          <span className="sub">{accepting || summary.isLoading ? t('common.loading') : t('pub.pay.tickFirst')}</span>
        </div>
      )}
      {accepted && pay ? (
        <a
          className="btn bp full"
          href={pay.upiUri}
          onClick={() => {
            tabMemory.set(paidTappedKey(token), '1');
            window.setTimeout(() => navigate(to('P02b-Paid', { token })), 400);
          }}
        >
          {t('pub.pay.payUpi')}
        </a>
      ) : (
        <button type="button" className="btn bp full" disabled>
          {t('pub.pay.payUpi')}
        </button>
      )}
      {accepted && (
        <button type="button" className="btn bs full" aria-expanded={otherOpen} onClick={() => setOtherOpen((o) => !o)}>
          {t('pub.pay.someoneElse')}
        </button>
      )}
      {otherOpen && accepted && (
        <div className="card lb-pub-card">
          {otherSent ? (
            <Row label={t('pub.pay.otherSentTitle')}>
              <span className="sub">{t('pub.pay.otherSent', { minutes: summary.data?.paymentOnlyLinkMinutes ?? 15 })}</span>
            </Row>
          ) : (
            <>
              <MobileField label={t('pub.pay.otherPhone')} value={otherPhone} onChange={setOtherPhone} hint={t('pub.pay.otherHint', { minutes: summary.data?.paymentOnlyLinkMinutes ?? 15 })} required />
              <button
                type="button"
                className="btn bp full"
                disabled={otherPhone.length !== 10 || sendingOther}
                aria-busy={sendingOther || undefined}
                onClick={() => void sendOther()}
              >
                {t('pub.pay.otherSend')}
              </button>
              <ActionError error={otherError} />
            </>
          )}
        </div>
      )}
      {accepted && <Muted>{t('pub.pay.bankNote')}</Muted>}
    </>
  );
}
