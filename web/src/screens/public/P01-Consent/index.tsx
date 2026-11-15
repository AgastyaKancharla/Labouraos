import { useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useI18n } from '../../../i18n/I18nProvider';
import { useScreenPath } from '../../../portals/PortalContext';
import { registrationApi } from '../shared/api';
import { LegalSummary, useLegalDocument } from '../shared/legal';
import { useStepGuard } from '../shared/registration';
import { ActionError, Choice, isOtpExpired, LinkProblem, Loading, Muted, PageTitle, StepsBar } from '../shared/ui';

/**
 * P01-Consent: Job Seeker Terms v1.1 (rev 176) — "In short" first, the full
 * terms behind "Read the full terms", then the six itemised ticks word for
 * word from Part B (notice 1.2, served by the server). The five required ones
 * are never pre-ticked — she ticks each herself; promotions is optional.
 * Saved the moment she taps "I agree — continue".
 */

export default function Consent() {
  const { t, language } = useI18n();
  const { token, requestId, status, query, backToStart } = useStepGuard('consent');
  const navigate = useNavigate();
  const to = useScreenPath();
  const queryClient = useQueryClient();
  const [ticked, setTicked] = useState<Record<string, boolean>>({});
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const doc = useLegalDocument('job_seeker_terms', Boolean(status));

  if (query.error) return <LinkProblem error={query.error} onRetry={() => void query.refetch()} />;
  if (doc.error) return <LinkProblem error={doc.error} onRetry={() => void doc.refetch()} />;
  if (!status || !doc.data) return <Loading />;
  const PURPOSES = doc.data.consents.map((c) => ({ id: c.purpose, title: c.title, text: c.description, required: c.required }));

  const allRequired = PURPOSES.filter((p) => p.required).every((p) => ticked[p.id]);

  const submit = async () => {
    setSaving(true);
    setError(null);
    try {
      await registrationApi.consent(token, requestId, PURPOSES.filter((p) => ticked[p.id]).map((p) => p.id), language, doc.data?.hash);
      await queryClient.invalidateQueries({ queryKey: ['registration', token] });
      navigate(to('P01c-Selfie', { token }));
    } catch (e) {
      if (isOtpExpired(e)) backToStart();
      else setError(e);
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <StepsBar current={1} label={t('pub.consent.stepLabel')} />
      <PageTitle emoji="🤝">{t('pub.consent.title')}</PageTitle>
      <Muted>{t('pub.consent.intro')}</Muted>
      <LegalSummary summaryHtml={doc.data.summaryHtml} bodyHtml={doc.data.bodyHtml} version={doc.data.version} />
      {PURPOSES.map((p) => (
        <Choice
          key={p.id}
          checked={Boolean(ticked[p.id])}
          onChange={(checked) => setTicked((prev) => ({ ...prev, [p.id]: checked }))}
          title={p.title}
          description={p.text}
        />
      ))}
      {!allRequired && <span className="sub">{t('pub.consent.needFive')}</span>}
      <ActionError error={error} />
      <button type="button" className="btn bp full" disabled={!allRequired || saving} aria-busy={saving || undefined} onClick={() => void submit()}>
        {t('pub.consent.agree')}
      </button>
    </>
  );
}
