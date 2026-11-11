import { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useI18n } from '../../../i18n/I18nProvider';
import { useScreenPath } from '../../../portals/PortalContext';
import { paymentApi, receiptHref } from '../shared/api';
import { dateTimeLabel, rupees, shortDate } from '../shared/format';
import { STEP_SCREEN, useRegistrationStatus, useRegistrationToken } from '../shared/registration';
import { LinkProblem, Loading, Muted, Ok, PaidConfirming, Row } from '../shared/ui';

/**
 * P02b-Paid. Until the ₹499 reaches Laboura's bank this says "Paid —
 * confirming" and checks again every few seconds; once the bank confirms,
 * the 30-day clock has started and it shows the date it ends.
 */
export default function Paid() {
  const { t, language } = useI18n();
  const token = useRegistrationToken();
  const navigate = useNavigate();
  const to = useScreenPath();
  const status = useRegistrationStatus(token, { poll: true });
  const data = status.data;

  const open = data && !data.otpRequired ? data : null;
  const confirmed = open ? open.payment.state === 'confirmed' : Boolean(data?.otpRequired && data.registrationComplete);
  const wrongStep = open && open.currentStep !== 'complete' && open.currentStep !== 'payment';

  useEffect(() => {
    if (wrongStep && open) navigate(to(STEP_SCREEN[open.currentStep], { token }), { replace: true });
  }, [wrongStep, open, navigate, to, token]);

  if (status.isLoading) return <Loading />;
  if (status.error || !data) return <LinkProblem error={status.error} onRetry={() => void status.refetch()} />;
  if (wrongStep) return <Loading />;

  if (confirmed) {
    return (
      <>
        <Ok>{t('pub.paid.done', { amount: rupees(open?.payment.amountPaise ?? 49900) })}</Ok>
        {open && open.payment.confirmedAt && (
          <div className="card">
            <Row label={t('pub.paid.confirmedBy')}>{dateTimeLabel(open.payment.confirmedAt, language)}</Row>
            {open.payment.guaranteeEndsAt && <Row label={t('pub.paid.daysEnd')}>{shortDate(open.payment.guaranteeEndsAt, language)}</Row>}
            {open.payment.paymentId && open.receiptToken && (
              <Row label={t('pub.paid.receipt')}>
                <a href={receiptHref({ paymentId: open.payment.paymentId, token: open.receiptToken })} target="_blank" rel="noreferrer">
                  {t('pub.paid.viewReceipt')}
                </a>
              </Row>
            )}
          </div>
        )}
        <Muted>{t('pub.paid.next')}</Muted>
      </>
    );
  }

  const reference = open?.payment.upiReference ?? null;
  return (
    <>
      <PaidConfirming onHint={reference ? (utr) => paymentApi.utrHint(reference, utr) : undefined} />
      {open && (
        <button type="button" className="btn bs full" onClick={() => navigate(to('P02-Payment', { token }))}>
          {t('pub.paid.backToPay')}
        </button>
      )}
    </>
  );
}
