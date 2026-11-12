import { useEffect } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { Button } from '../../../components/Button';
import { EmptyState, ErrorState } from '../../../components/ErrorState';
import { SkeletonCard } from '../../../components/Skeleton';
import { TopBar } from '../../../components/TopBar';
import { useT } from '../../../i18n/I18nProvider';
import type { MessageKey } from '../../../i18n/en';
import { api } from '../../../lib/api/client';
import { formatDayMonthIST, istDateKey } from '../../../lib/format/date';
import { useNow } from '../../../lib/useNow';
import { useScreenPath } from '../../../portals/PortalContext';
import { useIncoming, useProfile } from '../_lib/api';
import { time12 } from '../_lib/format';
import { ProfileHeader } from '../_lib/ProfileParts';

/**
 * Incoming call — design CA17-IncomingCall. The caller's profile opens the
 * moment the call rings (pushed by the live channel), so the agent knows who
 * it is before saying hello. An unregistered number goes to CA17b.
 */
const LIKELY = ['registration', 'offer', 'job', 'job_search_refund', 'staff_vacancy', 'referral', 'general'];
const SEEKER_STATUSES = ['lead', 'consented', 'pending_activation', 'active', 'paused', 'deactivated', 'placed', 'closed', 'refunded'];

function useAnswerIncoming() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (callbackTaskId: string) => api.post(`/telephony/callbacks/${encodeURIComponent(callbackTaskId)}/complete`),
    onSettled: () => void qc.invalidateQueries({ queryKey: ['call-work'] }),
  });
}

export default function IncomingCall() {
  const t = useT();
  const to = useScreenPath();
  const navigate = useNavigate();
  const now = useNow(60_000);
  const [params] = useSearchParams();
  const task = params.get('task');
  const card = useIncoming(task);
  const c = card.data;
  const profile = useProfile(c?.caller?.code ?? '');
  const answer = useAnswerIncoming();

  useEffect(() => {
    if (c && !c.known) navigate(`${to('CA17b-UnknownCaller')}?task=${encodeURIComponent(c.callbackTaskId)}`, { replace: true });
  }, [c, navigate, to]);

  const open = () => c?.caller && navigate(to('CA04-Profile', { id: c.caller.code }));
  const s = c?.standing;
  const stands = s
    ? [
        s.status && SEEKER_STATUSES.includes(s.status) ? t(`ca.seekerStatus.${s.status}` as MessageKey) : s.status,
        s.guaranteeDay ? t('ca.reason.day', { day: s.guaranteeDay, days: s.guaranteeDays ?? 30 }) : null,
        s.hasOffer === undefined ? null : s.hasOffer ? t('ca.in.hasOffer') : t('ca.in.noOffer'),
      ]
        .filter(Boolean)
        .join(' · ')
    : '';
  const last = c?.lastContact;

  return (
    <div className="lb-page lb-ca">
      <TopBar title={t('screen.CA17-IncomingCall')} titleHidden />
      {!task && <EmptyState title={t('ca.in.none')} />}
      {card.error && <ErrorState error={card.error} onRetry={() => void card.refetch()} />}
      {task && !c && !card.error && <SkeletonCard height={260} />}
      {c?.known && (
        <div className="card" style={{ maxWidth: 820, display: 'flex', flexDirection: 'column', gap: 14 }}>
          <div className="ok lb-ca-ringing" role="status">☎ {t('ca.in.ringing', { phone: c.maskedPhone })}</div>
          {profile.data ? <ProfileHeader profile={profile.data} /> : <div className="nm">{c.caller?.name}</div>}
          <div>
            {stands && (
              <div className="row">
                <span>{t('ca.in.stands')}</span>
                <b>{stands}</b>
              </div>
            )}
            <div className="row">
              <span>{t('ca.in.last')}</span>
              <b>
                {last
                  ? [
                      istDateKey(last.at) === istDateKey(now) ? `${t('ca.today')} ${time12(last.at)}` : `${formatDayMonthIST(last.at)} ${time12(last.at)}`,
                      last.by === 'you' ? t('ca.you') : last.by,
                      last.note ? `“${last.note}”` : null,
                    ]
                      .filter(Boolean)
                      .join(' · ')
                  : '—'}
              </b>
            </div>
            <div className="row">
              <span>{t('ca.in.likely')}</span>
              <b>{c.likelyAbout && LIKELY.includes(c.likelyAbout) ? t(`ca.in.likely.${c.likelyAbout}` as MessageKey) : '—'}</b>
            </div>
          </div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <Button variant="success" loading={answer.isPending} onClick={() => answer.mutate(c.callbackTaskId, { onSettled: open })}>
              {t('ca.in.answer')}
            </Button>
            {c.caller && (
              <Link className="btn bs lb-btn" to={to('CA04-Profile', { id: c.caller.code })}>
                {t('ca.in.open')}
              </Link>
            )}
          </div>
          <p className="sub">{t('ca.in.note')}</p>
        </div>
      )}
    </div>
  );
}
