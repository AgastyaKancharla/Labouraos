import { Link, useParams } from 'react-router-dom';
import { useMutation } from '@tanstack/react-query';
import { api } from '../../../lib/api/client';
import { useToast } from '../../../components/Toast';
import { ApiError } from '../../../lib/api/errors';
import { ToneTile } from '../../../components/ToneTile';
import { ErrorState } from '../../../components/ErrorState';
import { SkeletonCard } from '../../../components/Skeleton';
import { TopBar } from '../../../components/TopBar';
import { useT } from '../../../i18n/I18nProvider';
import { useNow } from '../../../lib/useNow';
import { useScreenPath } from '../../../portals/PortalContext';
import { useProfile } from '../_lib/api';
import { CallNextButton } from '../_lib/CallNextButton';
import { time12, whenLabel } from '../_lib/format';
import { ProfileHeader } from '../_lib/ProfileParts';
import { useLiveCall } from '../_lib/useLiveCall';

/**
 * No answer — design CA05n-NoAnswer. Nothing is typed: the calling system
 * logged it, a WhatsApp went out and a retry is on the list. The agent moves
 * on with Call next.
 */
export default function NoAnswer() {
  const { id = '' } = useParams();
  const t = useT();
  const to = useScreenPath();
  const now = useNow(60_000);
  const call = useLiveCall(id);
  const c = call.data;
  const profile = useProfile(c?.subjectId ?? '');
  const na = c?.noAnswer;
  const toast = useToast();
  // "Busy" / "Switched off" (21 Nov fixes): a label only — it counts as no answer, the retry already follows.
  const label = useMutation({
    mutationFn: (agentOutcome: 'busy' | 'switched_off') => api.post(`/calls/${encodeURIComponent(id)}/outcome`, { agentOutcome }),
    onSuccess: () => toast.success(t('ca.na.labelSaved')),
    onError: (err) => toast.error(err instanceof ApiError ? err.message : String(err)),
  });
  const rangSeconds = c?.startedAt && c.endedAt ? Math.round((new Date(c.endedAt).getTime() - new Date(c.startedAt).getTime()) / 1000) : null;

  return (
    <div className="lb-page lb-ca">
      <TopBar title={t('screen.CA05n-NoAnswer')} titleHidden />
      {call.error && <ErrorState error={call.error} onRetry={() => void call.refetch()} />}
      {!c && !call.error && <SkeletonCard height={260} />}
      {c && (
        <div className="card" style={{ display: 'flex', flexDirection: 'column', gap: 14, maxWidth: 760 }}>
          {profile.data && <ProfileHeader profile={profile.data} />}
          <div className="warn" role="status">
            <strong>
              {rangSeconds !== null ? t('ca.na.titleRang', { seconds: rangSeconds, time: time12(na?.endedAt ?? c.endedAt ?? c.startedAt ?? now) }) : t('ca.na.title', { time: time12(na?.endedAt ?? now) })}
            </strong>
          </div>
          <div>
            <h2 className="h2 lb-h-tile" style={{ marginBottom: 6 }}>
              <ToneTile icon="callCenter" tone="orange" size="sm" />
              {t('ca.na.auto')}
            </h2>
            {c.subjectType === 'job_seeker' && (
              <div className="row">
                <span>{t('ca.na.whatsapp')}</span>
                <span className={`tag ${na?.whatsapp && na.whatsapp.status !== 'failed' ? 'tg' : 'tn'}`}>{na?.whatsapp && na.whatsapp.status !== 'failed' ? t('ca.na.sent') : t('ca.na.notSent')}</span>
              </div>
            )}
            <div className="row">
              <span>{t('ca.na.nextTry')}</span>
              <b>{na?.nextTryAt ? whenLabel(na.nextTryAt, now, t) : '—'}</b>
            </div>
            {c.subjectType === 'job_seeker' && na && (
              <div className="row">
                <span>{t('ca.na.missedToday')}</span>
                <b>{t('ca.na.missedValue', { count: na.missedToday, of: na.missedForHit })}</b>
              </div>
            )}
          </div>
          {c.final && !c.answered && (
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }} role="group" aria-label={t('ca.na.labelIt')}>
              <span className="sub">{t('ca.na.labelIt')}</span>
              <button type="button" className={`tag ${c.agentOutcome === 'busy' ? 'tb' : 'tn'} lb-ca-chip`} disabled={label.isPending} onClick={() => label.mutate('busy')}>{t('ca.na.busy')}</button>
              <button type="button" className={`tag ${c.agentOutcome === 'switched_off' ? 'tb' : 'tn'} lb-ca-chip`} disabled={label.isPending} onClick={() => label.mutate('switched_off')}>{t('ca.na.switchedOff')}</button>
            </div>
          )}
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <CallNextButton name={c.next?.name} compact={false} />
            <Link className="btn bs lb-btn" to={to('CA03-Home')}>{t('ca.na.back')}</Link>
          </div>
          <p className="sub">{t('ca.na.note')}</p>
        </div>
      )}
    </div>
  );
}
