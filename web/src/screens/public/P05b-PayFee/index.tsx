import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { useParams } from 'react-router-dom';
import { useI18n } from '../../../i18n/I18nProvider';
import { paymentApi, receiptHref } from '../shared/api';
import { dateTimeLabel, dayTimeLabel, rupees } from '../shared/format';
import { LinkProblem, Loading, Muted, Ok, PageTitle, PaidConfirming, Row, UpiQr, usePersonLanguage, Warn } from '../shared/ui';

/**
 * P05b-PayFee: a UPI payment for the exact amount, by its reference. For a
 * placement: "Selected" means pay now — 50% of the salary plus 18% GST, due
 * within 24 hours; the joining date and the candidate's details follow only
 * when the money reaches the bank. The same page serves the ₹499 payment
 * link sent to a job seeker. It never says "paid" before the bank does.
 */
export default function PayFee() {
  const { t, language } = useI18n();
  const reference = useParams<{ token: string }>().token ?? '';
  const [tapped, setTapped] = useState(false);
  const summary = useQuery({
    queryKey: ['payment-summary', reference],
    queryFn: () => paymentApi.summary(reference),
    enabled: Boolean(reference),
    refetchInterval: (q) => (q.state.data && (q.state.data.state === 'pending' || q.state.data.state === 'confirming') && tapped ? 15_000 : false),
  });
  usePersonLanguage(summary.data?.language, reference);

  if (summary.isLoading) return <Loading />;
  if (summary.error || !summary.data) return <LinkProblem error={summary.error} onRetry={() => void summary.refetch()} />;
  const s = summary.data;
  const p = s.placement;

  if (s.state === 'received') {
    return (
      <>
        <Ok>{t('pub.fee.received', { amount: rupees(s.amountPaise) })}</Ok>
        <div className="card">
          {s.confirmedAt && <Row label={t('pub.paid.confirmedBy')}>{dateTimeLabel(s.confirmedAt, language)}</Row>}
          {s.invoicePath && (
            <Row label={t('pub.fee.invoice')}>
              <a href={s.invoicePath} target="_blank" rel="noreferrer">
                {t('pub.fee.viewInvoice')}
              </a>
            </Row>
          )}
          {s.receipt && !s.invoicePath && (
            <Row label={t('pub.paid.receipt')}>
              <a href={receiptHref(s.receipt)} target="_blank" rel="noreferrer">
                {t('pub.paid.viewReceipt')}
              </a>
            </Row>
          )}
        </div>
        {p && <Muted>{t('pub.fee.receivedNote', { name: p.candidateFirstName ?? '' })}</Muted>}
      </>
    );
  }
  if (s.state === 'closed' || !s.pay) {
    return (
      <>
        <PageTitle>{t('pub.error.title')}</PageTitle>
        <Warn>{t('pub.fee.closed')}</Warn>
      </>
    );
  }

  const payButton = (
    <a className="btn bp full" href={s.pay.upiUri} onClick={() => setTapped(true)}>
      {t('pub.fee.payUpi', { amount: rupees(s.amountPaise) })}
    </a>
  );

  if (!p) {
    return (
      <>
        <PageTitle>{t('pub.pay.title', { amount: rupees(s.amountPaise) })}</PageTitle>
        {s.jobSeeker && <span className="sub">{t('pub.fee.registrationFor', { name: s.jobSeeker.firstName ?? '', code: s.jobSeeker.code })}</span>}
        <UpiQr svg={s.pay.qrSvg} payeeName={s.pay.payeeName} reference={s.pay.upiReference} />
        {payButton}
        {(tapped || s.state === 'confirming') && <PaidConfirming onHint={(utr) => paymentApi.utrHint(reference, utr)} />}
      </>
    );
  }

  return (
    <>
      <Ok>{t('pub.fee.selected', { name: p.candidateFirstName ?? '' })}</Ok>
      <div className="card">
        <Row label={t('pub.fee.fee', { percent: p.feePercent ?? 50, salary: rupees(p.agreedSalaryPaise) })}>{rupees(p.placementFeePaise)}</Row>
        <Row label={t('pub.fee.gst', { percent: p.gstPercent ?? 18 })}>{rupees(p.gstPaise)}</Row>
        <Row label={t('pub.fee.total')}>
          <strong>{rupees(s.amountPaise)}</strong>
        </Row>
        {p.paymentDueAt && (
          <Row label={t('pub.fee.payBy')}>
            <span className="tag ta">{dayTimeLabel(p.paymentDueAt, language)}</span>
          </Row>
        )}
      </div>
      {payButton}
      {(tapped || s.state === 'confirming') && <PaidConfirming onHint={(utr) => paymentApi.utrHint(reference, utr)} />}
      <Muted>{t('pub.fee.note', { name: p.candidateFirstName ?? '' })}</Muted>
    </>
  );
}
