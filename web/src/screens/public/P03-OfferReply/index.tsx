import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { useParams } from 'react-router-dom';
import { useI18n } from '../../../i18n/I18nProvider';
import type { MessageKey } from '../../../i18n/en';
import { interviewApi, type BookedDetails } from '../shared/api';
import { dayLabel, dayTimeLabel, rupeeRange, timeLabel } from '../shared/format';
import { ActionError, LinkProblem, Loading, Muted, Ok, PageTitle, Row, usePersonLanguage, Warn } from '../shared/ui';

/**
 * P03-OfferReply and P03b-OfferYes. The offer shows job, area, salary, shift
 * and the interview time — no business name yet. He has 48 hours to reply.
 * Only after "Yes" does he see the business, address and who to ask for.
 */
const SHIFT: Record<string, MessageKey> = {
  day: 'pub.shift.day',
  night: 'pub.shift.night',
  rotational: 'pub.shift.rotational',
  any: 'pub.shift.any',
};

export default function OfferReply() {
  const { t, language } = useI18n();
  const token = useParams<{ token: string }>().token ?? '';
  const offer = useQuery({ queryKey: ['offer', token], queryFn: () => interviewApi.offer(token), enabled: Boolean(token), retry: false });
  usePersonLanguage(offer.data?.language, token);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [confirmNo, setConfirmNo] = useState(false);
  const [booked, setBooked] = useState<BookedDetails | null>(null);
  const [declined, setDeclined] = useState(false);

  if (offer.isLoading) return <Loading />;
  if (offer.error || !offer.data) return <LinkProblem error={offer.error} onRetry={() => void offer.refetch()} />;
  const o = offer.data;

  if (booked) {
    return (
      <>
        <Ok>{t('pub.offer.booked', { name: o.firstName })}</Ok>
        <div className="card">
          <Row label={t('pub.offer.business')}>
            <strong>{booked.businessName}</strong>
          </Row>
          <Row label={t('pub.offer.address')}>{[booked.address, booked.area].filter(Boolean).join(', ')}</Row>
          <Row label={t('pub.offer.when')}>
            {t('pub.offer.whenValue', { day: dayLabel(booked.slotStartsAt, language), from: timeLabel(booked.slotStartsAt, language), to: timeLabel(booked.slotEndsAt, language) })}
          </Row>
          {booked.contactPerson && <Row label={t('pub.offer.askFor')}>{booked.contactPerson}</Row>}
        </div>
        <Muted>{t('pub.offer.afterNote')}</Muted>
      </>
    );
  }
  if (declined) {
    return (
      <>
        <PageTitle>{t('pub.offer.declinedTitle')}</PageTitle>
        <Muted>{t('pub.offer.declined')}</Muted>
      </>
    );
  }

  const reply = async (answer: 'yes' | 'no') => {
    setBusy(true);
    setError(null);
    try {
      const result = await interviewApi.reply(token, answer);
      if (answer === 'yes' && result.booked) setBooked(result.booked);
      else setDeclined(true);
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  };

  const period = o.salaryPeriod === 'daily' ? t('pub.offer.perDay') : t('pub.offer.perMonth');
  return (
    <>
      <PageTitle>{t('pub.offer.title', { name: o.firstName })}</PageTitle>
      <div className="card">
        <Row label={t('pub.offer.job')}>
          <strong>{o.job}</strong>
        </Row>
        {o.area && <Row label={t('pub.offer.area')}>{o.area}</Row>}
        {o.salaryMinPaise !== null && <Row label={t('pub.offer.salary')}>{`${rupeeRange(o.salaryMinPaise, o.salaryMaxPaise)} ${period}`}</Row>}
        {o.shift && <Row label={t('pub.offer.shift')}>{t(SHIFT[o.shift] ?? 'pub.shift.any')}</Row>}
        <Row label={t('pub.offer.interview')}>
          {t('pub.offer.interviewValue', { day: dayLabel(o.slotStartsAt, language), from: timeLabel(o.slotStartsAt, language), to: timeLabel(o.slotEndsAt, language) })}
        </Row>
      </div>
      {!o.awaitingReply ? (
        <Warn>{t('pub.offer.closed')}</Warn>
      ) : (
        <>
          <Muted>
            {t('pub.offer.replyBy', { when: dayTimeLabel(o.replyDueAt, language) })} {o.belowGuaranteeFloor ? t('pub.offer.belowFloor') : t('pub.offer.warning')}
          </Muted>
          {confirmNo ? (
            <div className="card lb-pub-card">
              <strong>{t('pub.offer.confirmNo')}</strong>
              {!o.belowGuaranteeFloor && <span className="sub">{t('pub.offer.confirmNoText')}</span>}
              <div className="lb-pub-grid2">
                <button type="button" className="btn bs" onClick={() => setConfirmNo(false)}>
                  {t('common.back')}
                </button>
                <button type="button" className="btn bd" disabled={busy} aria-busy={busy || undefined} onClick={() => void reply('no')}>
                  {t('pub.offer.no')}
                </button>
              </div>
            </div>
          ) : (
            <div className="lb-pub-grid2">
              <button type="button" className="btn bg" disabled={busy} aria-busy={busy || undefined} onClick={() => void reply('yes')}>
                {t('pub.offer.yes')}
              </button>
              <button type="button" className="btn bd" disabled={busy} onClick={() => setConfirmNo(true)}>
                {t('pub.offer.no')}
              </button>
            </div>
          )}
          <ActionError error={error} />
        </>
      )}
    </>
  );
}
