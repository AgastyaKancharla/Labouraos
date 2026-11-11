import { useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useI18n } from '../../../i18n/I18nProvider';
import type { MessageKey } from '../../../i18n/en';
import { useScreenPath } from '../../../portals/PortalContext';
import { registrationApi } from '../shared/api';
import { useStepGuard } from '../shared/registration';
import { ActionError, Choice, isOtpExpired, LinkProblem, Loading, Muted, PageTitle, StepsBar } from '../shared/ui';

/**
 * P01-Consent: one box per purpose in plain words; the five required ones are
 * never pre-ticked — she ticks each herself. Call recording is one of them.
 * Saved the moment she taps "I agree — continue".
 */
const PURPOSES: { id: string; title: MessageKey; text: MessageKey; required: boolean }[] = [
  { id: 'job_matching', title: 'pub.consent.match', text: 'pub.consent.matchText', required: true },
  { id: 'profile_sharing', title: 'pub.consent.share', text: 'pub.consent.shareText', required: true },
  { id: 'call_recording', title: 'pub.consent.record', text: 'pub.consent.recordText', required: true },
  { id: 'aadhaar_verification', title: 'pub.consent.id', text: 'pub.consent.idText', required: true },
  { id: 'job_updates', title: 'pub.consent.updates', text: 'pub.consent.updatesText', required: true },
  { id: 'promotions', title: 'pub.consent.offers', text: 'pub.consent.offersText', required: false },
];

export default function Consent() {
  const { t, language } = useI18n();
  const { token, requestId, status, query, backToStart } = useStepGuard('consent');
  const navigate = useNavigate();
  const to = useScreenPath();
  const queryClient = useQueryClient();
  const [ticked, setTicked] = useState<Record<string, boolean>>({});
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<unknown>(null);

  if (query.error) return <LinkProblem error={query.error} onRetry={() => void query.refetch()} />;
  if (!status) return <Loading />;

  const allRequired = PURPOSES.filter((p) => p.required).every((p) => ticked[p.id]);

  const submit = async () => {
    setSaving(true);
    setError(null);
    try {
      await registrationApi.consent(token, requestId, PURPOSES.filter((p) => ticked[p.id]).map((p) => p.id), language);
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
      <PageTitle>{t('pub.consent.title')}</PageTitle>
      <Muted>{t('pub.consent.intro')}</Muted>
      {PURPOSES.map((p) => (
        <Choice
          key={p.id}
          checked={Boolean(ticked[p.id])}
          onChange={(checked) => setTicked((prev) => ({ ...prev, [p.id]: checked }))}
          title={t(p.title)}
          description={t(p.text)}
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
