import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useT } from '../../../i18n/I18nProvider';
import { useScreenPath } from '../../../portals/PortalContext';
import { registrationApi, type RegistrationOpen } from '../shared/api';
import { registrationSession, STEP_SCREEN, useRegistrationStatus, useRegistrationToken } from '../shared/registration';
import { ActionError, LinkProblem, Loading, Muted, OtpBlock, PageTitle, Row, Warn } from '../shared/ui';

/**
 * P00-Open (the SMS link) and P02r-Resume (the same link opened again).
 * Nothing about him shows until he types the code sent to his own number;
 * then a first visit goes straight to consent, and a return visit shows the
 * finished steps and carries on from the first unfinished one.
 */
export default function RegistrationOpen() {
  const t = useT();
  const token = useRegistrationToken();
  const navigate = useNavigate();
  const to = useScreenPath();
  const queryClient = useQueryClient();
  const status = useRegistrationStatus(token);
  const [requestId, setRequestId] = useState<string | null>(null);
  const [code, setCode] = useState('');
  const [verifying, setVerifying] = useState(false);
  const [verifyError, setVerifyError] = useState<unknown>(null);

  const data = status.data;
  const open = data && !data.otpRequired ? data : null;
  const nothingDone = open ? !open.steps.consent && !open.steps.selfie && !open.steps.idCheck && !open.steps.payment : false;

  useEffect(() => {
    if (!open) return;
    if (open.currentStep === 'complete') navigate(to('P02b-Paid', { token }), { replace: true });
    else if (nothingDone) navigate(to(STEP_SCREEN[open.currentStep], { token }), { replace: true });
  }, [open, nothingDone, navigate, to, token]);

  if (status.isLoading) return <Loading />;
  if (status.error || !data) return <LinkProblem error={status.error} onRetry={() => void status.refetch()} />;

  if (open) {
    if (open.currentStep === 'complete' || nothingDone) return <Loading />;
    return <Resume status={open} onContinue={() => navigate(to(STEP_SCREEN[open.currentStep], { token }))} />;
  }

  const verify = async () => {
    if (!requestId || code.length !== 6) return;
    setVerifying(true);
    setVerifyError(null);
    try {
      const opened = await registrationApi.verifyOtp(token, requestId, code);
      registrationSession.save(token, requestId);
      queryClient.setQueryData(['registration', token, requestId], opened);
      await queryClient.invalidateQueries({ queryKey: ['registration', token] });
    } catch (e) {
      setVerifyError(e);
      setCode('');
    } finally {
      setVerifying(false);
    }
  };

  const steps: [string, string][] = [
    [t('pub.open.step1'), t('pub.open.min1')],
    [t('pub.open.step2'), t('pub.open.sec30')],
    [t('pub.open.step3'), t('pub.open.min2')],
    [t('pub.open.step4'), t('pub.open.min1')],
  ];

  return (
    <>
      <PageTitle>{t('pub.open.title')}</PageTitle>
      <Muted>{t('pub.open.intro')}</Muted>
      {data.otpRequired && data.registrationComplete && <Warn>{t('pub.open.alreadyComplete')}</Warn>}
      <div className="card">
        {steps.map(([label, time]) => (
          <Row key={label} label={label}>
            <span className="sub">{time}</span>
          </Row>
        ))}
      </div>
      <OtpBlock
        maskedPhone={data.maskedPhone}
        send={() => registrationApi.sendOtp(token)}
        requestId={requestId}
        onRequestId={setRequestId}
        code={code}
        onCode={setCode}
        invalid={Boolean(verifyError)}
        hint={t('pub.open.noSmartphone')}
      />
      <ActionError error={verifyError} />
      {requestId && (
        <button type="button" className="btn bp full" disabled={code.length !== 6 || verifying} aria-busy={verifying || undefined} onClick={() => void verify()}>
          {t('common.continue')}
        </button>
      )}
    </>
  );
}

function Resume({ status, onContinue }: { status: RegistrationOpen; onContinue: () => void }) {
  const t = useT();
  const done = [status.steps.consent, status.steps.selfie, status.steps.idCheck, status.steps.payment].filter(Boolean).length;
  const paymentTag =
    status.payment.state === 'failed'
      ? { cls: 'tag ta', text: t('pub.resume.lastTryFailed') }
      : status.payment.state === 'confirming'
        ? { cls: 'tag ta', text: t('pub.resume.confirming') }
        : status.payment.state === 'pending'
          ? { cls: 'tag ta', text: t('pub.resume.notPaidYet') }
          : { cls: 'tag tn', text: t('pub.resume.toDo') };
  const tag = (isDone: boolean) => (isDone ? <span className="tag tg">{t('pub.resume.done')}</span> : <span className="tag tn">{t('pub.resume.toDo')}</span>);
  const nextLabel: Record<string, string> = {
    consent: t('pub.resume.continueConsent'),
    selfie: t('pub.resume.continueSelfie'),
    id_check: t('pub.resume.continueId'),
    payment: t('pub.resume.continuePayment'),
  };
  return (
    <>
      <PageTitle>{t('pub.resume.title', { name: status.firstName })}</PageTitle>
      <Muted>{t('pub.resume.intro', { done })}</Muted>
      <div className="card">
        <Row label={t('pub.open.step1')}>{tag(status.steps.consent)}</Row>
        <Row label={t('pub.resume.selfie')}>{tag(status.steps.selfie)}</Row>
        <Row label={t('pub.resume.id')}>{tag(status.steps.idCheck)}</Row>
        <Row label={t('pub.open.step4')}>
          {status.steps.payment ? <span className="tag tg">{t('pub.resume.done')}</span> : <span className={paymentTag.cls}>{paymentTag.text}</span>}
        </Row>
      </div>
      <button type="button" className="btn bp full" onClick={onContinue}>
        {nextLabel[status.currentStep] ?? t('common.continue')}
      </button>
    </>
  );
}
