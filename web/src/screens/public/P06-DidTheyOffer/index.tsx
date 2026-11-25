import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { useParams } from 'react-router-dom';
import { useI18n } from '../../../i18n/I18nProvider';
import { interviewApi } from '../shared/api';
import { dayLabel } from '../shared/format';
import { ActionError, LinkProblem, Loading, Muted, Ok, PageTitle } from '../shared/ui';

/**
 * P06-DidTheyOffer: sent to the candidate when the owner is asked for the
 * result. If he says yes and the owner says "not selected", a Team Lead
 * checks it the same day.
 */
export default function DidTheyOffer() {
  const { t, language } = useI18n();
  const token = useParams<{ token: string }>().token ?? '';
  const details = useQuery({ queryKey: ['offer-check', token], queryFn: () => interviewApi.offerCheck(token), enabled: Boolean(token), retry: false });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [answered, setAnswered] = useState(false);
  // B6 (rev 211): the shop question, when asked, is answered with the offer question.
  const [offer, setOffer] = useState<'yes' | 'no' | null>(null);
  const [shop, setShop] = useState<'yes' | 'no' | null>(null);

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

  const answer = async (value: 'yes' | 'no', shopValue?: 'yes' | 'no') => {
    setBusy(true);
    setError(null);
    try {
      await interviewApi.answerOfferCheck(token, value, shopValue);
      setAnswered(true);
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <PageTitle emoji="🙋">{t('pub.check.title', { name: d.firstName })}</PageTitle>
      <p className="lb-pub-muted">{t('pub.check.intro', { day: dayLabel(d.slotStartsAt, language), business: d.businessName })}</p>
      {d.askShopCheck ? (
        <>
          <div className="card"><strong>{t('pub.check.question')}</strong></div>
          <div className="lb-pub-grid2" role="group" aria-label={t('pub.check.question')}>
            <button type="button" className={offer === 'yes' ? 'btn bg' : 'btn bs'} aria-pressed={offer === 'yes'} onClick={() => setOffer('yes')}>{t('pub.check.yes')}</button>
            <button type="button" className={offer === 'no' ? 'btn bg' : 'btn bs'} aria-pressed={offer === 'no'} onClick={() => setOffer('no')}>{t('pub.check.no')}</button>
          </div>
          <div className="card"><strong>{t('pub.check.shopQuestion')}</strong></div>
          <div className="lb-pub-grid2" role="group" aria-label={t('pub.check.shopQuestion')}>
            <button type="button" className={shop === 'yes' ? 'btn bg' : 'btn bs'} aria-pressed={shop === 'yes'} onClick={() => setShop('yes')}>{t('pub.check.yes')}</button>
            <button type="button" className={shop === 'no' ? 'btn bg' : 'btn bs'} aria-pressed={shop === 'no'} onClick={() => setShop('no')}>{t('pub.check.no')}</button>
          </div>
          <button type="button" className="btn bp full" disabled={busy || !offer || !shop} onClick={() => offer && shop && void answer(offer, shop)}>
            {t('pub.check.answerBoth')}
          </button>
          <ActionError error={error} />
          <Muted>{t('pub.check.note')}</Muted>
        </>
      ) : (
        <>
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
      )}
    </>
  );
}
