import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { useParams } from 'react-router-dom';
import { useI18n } from '../../../i18n/I18nProvider';
import { interviewApi } from '../shared/api';
import { dayLabel } from '../shared/format';
import { ActionError, LinkProblem, Loading, Muted, Ok, PageTitle, usePersonLanguage } from '../shared/ui';

/**
 * P06-DidTheyOffer: sent to the candidate when the owner is asked for the
 * result. If he says yes and the owner says "not selected", a Team Lead
 * checks it the same day.
 */
export default function DidTheyOffer() {
  const { t, language } = useI18n();
  const token = useParams<{ token: string }>().token ?? '';
  const details = useQuery({ queryKey: ['offer-check', token], queryFn: () => interviewApi.offerCheck(token), enabled: Boolean(token), retry: false });
  usePersonLanguage(details.data?.language, token);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [answered, setAnswered] = useState(false);

  if (details.isLoading) return <Loading />;
  if (details.error || !details.data) return <LinkProblem error={details.error} onRetry={() => void details.refetch()} />;
  const d = details.data;

  if (answered || d.answered) {
    return (
      <>
        <Ok>{t('pub.check.thanks', { name: d.firstName })}</Ok>
        <Muted>{t('pub.check.note')}</Muted>
      </>
    );
  }

  const answer = async (value: 'yes' | 'no') => {
    setBusy(true);
    setError(null);
    try {
      await interviewApi.answerOfferCheck(token, value);
      setAnswered(true);
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <PageTitle>{t('pub.check.title', { name: d.firstName })}</PageTitle>
      <p className="lb-pub-muted">{t('pub.check.intro', { day: dayLabel(d.slotStartsAt, language), business: d.businessName })}</p>
      <div className="card">
        <strong>{t('pub.check.question')}</strong>
      </div>
      <div className="lb-pub-grid2">
        <button type="button" className="btn bg" disabled={busy} onClick={() => void answer('yes')}>
          {t('pub.check.yes')}
        </button>
        <button type="button" className="btn bs" disabled={busy} onClick={() => void answer('no')}>
          {t('pub.check.no')}
        </button>
      </div>
      <ActionError error={error} />
      <Muted>{t('pub.check.note')}</Muted>
    </>
  );
}
