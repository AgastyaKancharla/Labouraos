import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useI18n } from '../../../i18n/I18nProvider';
import type { MessageKey } from '../../../i18n/en';
import { formatINR } from '../../../lib/format/money';
import { useScreenPath } from '../../../portals/PortalContext';
import { partnerApi } from '../shared/api';
import { usePartnerStepGuard } from '../shared/partner';
import { ActionError, Choice, isOtpExpired, LinkProblem, Loading, Muted, PageTitle, StepsBar } from '../shared/ui';

/**
 * Step 1 of the partner's link: the referral terms and call-recording
 * consent (guide, "Registering a partner"). The amounts are the ones frozen
 * on the link when it was sent; the full text is the one they agree to. Two
 * boxes, never pre-ticked — the partner ticks each. Saved with the code they
 * verified on opening the link, as on the job seeker's consent page.
 */
const POINTS: MessageKey[] = ['rterms.earn.join', 'rterms.earn.notPay', 'rterms.earn.business', 'rterms.earn.self', 'rterms.paid.queued', 'rterms.paid.how', 'rterms.calls.id'];

export default function PartnerTermsPage() {
  const { t, language } = useI18n();
  const { token, requestId, status, query, backToStart } = usePartnerStepGuard('terms');
  const navigate = useNavigate();
  const to = useScreenPath();
  const queryClient = useQueryClient();
  const terms = useQuery({
    queryKey: ['partner-link', token, 'terms', requestId],
    queryFn: () => partnerApi.terms(token, requestId),
    enabled: Boolean(status && requestId),
    retry: false,
  });
  const [agreeTerms, setAgreeTerms] = useState(false);
  const [agreeRecording, setAgreeRecording] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<unknown>(null);

  const codeRanOut = isOtpExpired(terms.error);
  useEffect(() => {
    if (codeRanOut) backToStart();
  }, [codeRanOut, backToStart]);

  if (query.error) return <LinkProblem error={query.error} onRetry={() => void query.refetch()} />;
  if (terms.error && !codeRanOut) return <LinkProblem error={terms.error} onRetry={() => void terms.refetch()} />;
  if (!status || !terms.data) return <Loading />;
  const d = terms.data;
  const vars = { reward: formatINR(d.referralPayoutPaise), fee: formatINR(d.activationFeePaise), hours: d.payoutDetailsCoolingHours };

  const submit = async () => {
    setSaving(true);
    setError(null);
    try {
      await partnerApi.acceptTerms(token, requestId, language);
      await queryClient.invalidateQueries({ queryKey: ['partner-link', token] });
      navigate(to('P-PartnerSelfie', { token }));
    } catch (e) {
      if (isOtpExpired(e)) backToStart();
      else setError(e);
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <StepsBar current={1} label={t('partner.terms.stepLabel')} />
      <PageTitle>{t('partner.terms.title')}</PageTitle>
      <Muted>{t('partner.terms.intro')}</Muted>
      <div className="card">
        {POINTS.map((key) => (
          <div key={key} className="row lb-pub-row-col">
            <span className="sub">{t(key, vars)}</span>
          </div>
        ))}
      </div>
      {d.termsHtml && (
        <details className="card lb-pub-terms">
          <summary>{t('partner.terms.readFull')}</summary>
          {/* Rendered by the server from its own template and the frozen amount; no user text in it. */}
          <div dangerouslySetInnerHTML={{ __html: d.termsHtml }} />
        </details>
      )}
      <Choice checked={agreeTerms} onChange={setAgreeTerms} title={t('partner.terms.agreeTerms')} />
      <Choice checked={agreeRecording} onChange={setAgreeRecording} title={t('partner.terms.agreeRecording')} description={t('pub.consent.recordText')} />
      {!(agreeTerms && agreeRecording) && <span className="sub">{t('partner.terms.needBoth')}</span>}
      <ActionError error={error} />
      <button type="button" className="btn bp full" disabled={!agreeTerms || !agreeRecording || saving} aria-busy={saving || undefined} onClick={() => void submit()}>
        {t('partner.terms.agree')}
      </button>
    </>
  );
}
