import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useT } from '../../../i18n/I18nProvider';
import { useScreenPath } from '../../../portals/PortalContext';
import { partnerApi, type PartnerOpen } from '../shared/api';
import { PARTNER_STEP_SCREEN, partnerSession, partnerStepsDone, usePartnerStatus, usePartnerToken } from '../shared/partner';
import { ActionError, LinkProblem, Loading, Muted, Ok, OtpBlock, PageTitle, Row } from '../shared/ui';

/**
 * The referral partner's SMS link (/p/partner/:token), opened the first time
 * or again later. No design file: it mirrors P00-Open and P02r-Resume.
 * Nothing about the partner shows until they type the code sent to their own
 * number; then a first visit goes straight to the terms, and a return visit
 * shows the finished steps and carries on from the first unfinished one.
 */
export default function PartnerOpenPage() {
  const t = useT();
  const token = usePartnerToken();
  const navigate = useNavigate();
  const to = useScreenPath();
  const queryClient = useQueryClient();
  const status = usePartnerStatus(token);
  const [requestId, setRequestId] = useState<string | null>(null);
  const [code, setCode] = useState('');
  const [verifying, setVerifying] = useState(false);
  const [verifyError, setVerifyError] = useState<unknown>(null);

  const data = status.data;
  const open = data && !data.otpRequired ? data : null;
  const nothingDone = open ? partnerStepsDone(open) === 0 && !open.payout : false;

  useEffect(() => {
    if (!open) return;
    if (open.currentStep === 'complete') navigate(to('P-PartnerDone', { token }), { replace: true });
    else if (nothingDone) navigate(to(PARTNER_STEP_SCREEN[open.currentStep], { token }), { replace: true });
  }, [open, nothingDone, navigate, to, token]);

  if (status.isLoading) return <Loading />;
  if (status.error || !data) return <LinkProblem error={status.error} onRetry={() => void status.refetch()} />;

  if (open) {
    if (open.currentStep === 'complete' || nothingDone) return <Loading />;
    return <Resume status={open} onContinue={() => navigate(to(PARTNER_STEP_SCREEN[open.currentStep], { token }))} />;
  }

  const verify = async () => {
    if (!requestId || code.length !== 6) return;
    setVerifying(true);
    setVerifyError(null);
    try {
      const opened = await partnerApi.verifyOtp(token, requestId, code);
      partnerSession.save(token, requestId);
      queryClient.setQueryData(['partner-link', token, requestId], opened);
      await queryClient.invalidateQueries({ queryKey: ['partner-link', token] });
    } catch (e) {
      setVerifyError(e);
      setCode('');
    } finally {
      setVerifying(false);
    }
  };

  const steps: [string, string][] = [
    [t('partner.open.step1'), t('pub.open.min1')],
    [t('partner.open.step2'), t('pub.open.sec30')],
    [t('partner.open.step3'), t('pub.open.min2')],
    [t('partner.open.step4'), t('pub.open.min1')],
  ];

  return (
    <>
      <PageTitle>{t('partner.open.title')}</PageTitle>
      <Muted>{t('partner.open.intro')}</Muted>
      {data.otpRequired && data.registrationComplete && <Ok>{t('partner.open.alreadyComplete')}</Ok>}
      <div className="card">
        {steps.map(([label, time]) => (
          <Row key={label} label={label}>
            <span className="sub">{time}</span>
          </Row>
        ))}
      </div>
      <OtpBlock
        maskedPhone={data.maskedPhone}
        send={() => partnerApi.sendOtp(token)}
        requestId={requestId}
        onRequestId={setRequestId}
        code={code}
        onCode={setCode}
        invalid={Boolean(verifyError)}
        hint={t('partner.open.noSmartphone')}
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

function Resume({ status, onContinue }: { status: PartnerOpen; onContinue: () => void }) {
  const t = useT();
  const tag = (state: string) =>
    state === 'done' ? <span className="tag tg">{t('pub.resume.done')}</span> : <span className="tag tn">{t('pub.resume.toDo')}</span>;
  const upiTag = status.payout && status.steps.upi.state !== 'done' ? <span className="tag ta">{t('partner.resume.checking')}</span> : tag(status.steps.upi.state);
  const nextLabel: Record<string, string> = {
    terms: t('partner.resume.continueTerms'),
    selfie: t('partner.resume.continueSelfie'),
    id_check: t('partner.resume.continueId'),
    upi: status.payout ? t('partner.resume.seeDetails') : t('partner.resume.continueUpi'),
  };
  return (
    <>
      <PageTitle>{t('partner.resume.title', { name: status.firstName })}</PageTitle>
      <Muted>{t('partner.resume.intro', { done: partnerStepsDone(status) })}</Muted>
      <span className="sub">{t('partner.resume.code', { code: status.referralCode })}</span>
      <div className="card">
        <Row label={t('partner.open.step1')}>{tag(status.steps.terms.state)}</Row>
        <Row label={t('pub.resume.selfie')}>{tag(status.steps.selfie.state)}</Row>
        <Row label={t('pub.resume.id')}>{tag(status.steps.id.state)}</Row>
        <Row label={t('partner.open.step4')}>{upiTag}</Row>
      </div>
      <button type="button" className="btn bp full" onClick={onContinue}>
        {nextLabel[status.currentStep] ?? t('common.continue')}
      </button>
    </>
  );
}
