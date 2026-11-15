import { useEffect, useState, type FormEvent } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { Button } from '../../../components/Button';
import { ErrorState } from '../../../components/ErrorState';
import { DateField } from '../../../components/fields/DateField';
import { SkeletonCard } from '../../../components/Skeleton';
import { useToast } from '../../../components/Toast';
import { TopBar } from '../../../components/TopBar';
import { useT } from '../../../i18n/I18nProvider';
import type { MessageKey } from '../../../i18n/en';
import { api } from '../../../lib/api/client';
import { ApiError } from '../../../lib/api/errors';
import { istDateKey } from '../../../lib/format/date';
import { useNow } from '../../../lib/useNow';
import { useScreenPath } from '../../../portals/PortalContext';
import { useProfile, type SeekerProfile } from '../_lib/api';
import { clock12, stopwatch } from '../_lib/format';
import { BestJobs, Glance, ProfileHeader } from '../_lib/ProfileParts';
import { useCallActions } from '../_lib/useCallActions';
import { useLiveCall } from '../_lib/useLiveCall';

/**
 * On a call — design CA05-OnCall. Whether the call connected comes only from
 * the calling system: until it says "answered" the form does not appear, and
 * a call that ends unanswered moves to the No answer screen (CA05n). The
 * agent picks what was said from the fixed list; "Call me back" needs a date
 * and time; turning down an offer needs a reason.
 */
const OUTCOMES = ['interested', 'accepted_offer', 'rejected_offer', 'callback_requested', 'not_interested', 'working_now', 'other'] as const;
type Outcome = (typeof OUTCOMES)[number];

export default function OnCall() {
  const { id = '' } = useParams();
  const t = useT();
  const navigate = useNavigate();
  const to = useScreenPath();
  const call = useLiveCall(id);
  const c = call.data;
  const profile = useProfile(c?.subjectId ?? '');
  const now = useNow(1000);

  useEffect(() => {
    if (!c) return;
    if (c.final && !c.answered) navigate(to('CA05n-NoAnswer', { id }), { replace: true });
    else if (c.relatedType === 'follow_up_task' && c.relatedId) navigate(`${to('CA10b-FollowUpAnswer', { id: c.relatedId })}?call=${encodeURIComponent(id)}`, { replace: true });
  }, [c, id, navigate, to]);

  const p = profile.data;
  const seconds = c?.answeredAt ? ((c.endedAt ? new Date(c.endedAt) : now).getTime() - new Date(c.answeredAt).getTime()) / 1000 : 0;

  return (
    <div className="lb-page lb-ca">
      <TopBar title={t('screen.CA05-OnCall')} titleHidden />
      {call.error && <ErrorState error={call.error} onRetry={() => void call.refetch()} />}
      {!c && !call.error && <SkeletonCard height={300} />}
      {c && (
        <div className="lb-ca-split lb-ca-split--right">
          <div className="lb-ca-main">
            <div className="card" style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              {p && <ProfileHeader profile={p} />}
              {c.answered ? (
                <div className="ok" role="status">
                  <span className="dot" style={{ background: 'var(--green)' }} />
                  <span>{t('ca.call.onCall', { time: stopwatch(seconds) })}</span>
                  <span style={{ marginLeft: 'auto', fontWeight: 600 }}>{c.endedAt ? t('ca.call.ended') : t('ca.call.confirmed')}</span>
                </div>
              ) : (
                <div className="warn" role="status" aria-live="polite">
                  {t('ca.call.ringing')}
                </div>
              )}
              {c.answered && <p className="sub">{t('ca.call.heard')}</p>}
              {c.answered && p && <OutcomeForm callId={id} purpose={c.purpose} relatedType={c.relatedType} relatedId={c.relatedId} profileCode={p.code} saved={c.agentOutcome} />}
              {!c.answered && <p className="sub">{t('ca.call.noAnswerLink')}</p>}
            </div>
          </div>
          {p?.type === 'job_seeker' && (
            <aside className="lb-ca-aside lb-ca-aside--right">
              <Glance profile={p as SeekerProfile} />
              <BestJobs profile={p as SeekerProfile} />
            </aside>
          )}
        </div>
      )}
      {c && (
        <Link to={to('CA03-Home')} className="sub">
          ← {t('ca.na.back')}
        </Link>
      )}
    </div>
  );
}

function OutcomeForm({
  callId,
  purpose,
  relatedType,
  relatedId,
  profileCode,
  saved,
}: {
  callId: string;
  purpose: string | null;
  relatedType: string | null;
  relatedId: string | null;
  profileCode: string;
  saved: string | null;
}) {
  const t = useT();
  const toast = useToast();
  const navigate = useNavigate();
  const to = useScreenPath();
  const qc = useQueryClient();
  const now = useNow();
  const { callNext } = useCallActions();
  const [outcome, setOutcome] = useState<Outcome | ''>((saved as Outcome) ?? '');
  const [date, setDate] = useState(istDateKey(now));
  const [time, setTime] = useState('');
  const [note, setNote] = useState('');
  const [error, setError] = useState<string | null>(null);

  const save = useMutation({
    mutationFn: async () => {
      const isOfferReply = purpose === 'offer' && relatedType === 'interview' && relatedId && (outcome === 'accepted_offer' || outcome === 'rejected_offer');
      if (isOfferReply) {
        return api.post(`/interviews/${encodeURIComponent(relatedId!)}/call-reply`, { callRecordId: callId, answer: outcome, reason: note.trim() || undefined });
      }
      return api.post(`/calls/${encodeURIComponent(callId)}/outcome`, {
        agentOutcome: outcome,
        reason: note.trim() || undefined,
        callbackAt: outcome === 'callback_requested' ? new Date(`${date}T${time}:00+05:30`).toISOString() : undefined,
      });
    },
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['call-work'] }),
  });

  const submit = (andNext: boolean) => (e?: FormEvent) => {
    e?.preventDefault();
    setError(null);
    if (!outcome) return setError(t('ca.call.pickOne'));
    if (outcome === 'callback_requested' && (!date || !time)) return setError(t('ca.call.needTime'));
    if (outcome === 'rejected_offer' && !note.trim()) return setError(t('ca.call.needReason'));
    save.mutate(undefined, {
      onSuccess: () => {
        toast.success(t('ca.call.saved'));
        if (andNext) callNext();
        else navigate(to('CA03-Home'));
      },
      onError: (err) => setError(err instanceof ApiError ? err.message : String(err)),
    });
  };

  return (
    <form onSubmit={submit(true)} style={{ display: 'flex', flexDirection: 'column', gap: 12 }} noValidate>
      <fieldset style={{ border: 0, padding: 0, margin: 0 }}>
        <legend className="h2" style={{ marginBottom: 8 }}>{t('ca.call.what')}</legend>
        <div className="lb-ca-options">
          {OUTCOMES.map((o) => (
            <label key={o} className={`opt${outcome === o ? ' on' : ''}`}>
              <input type="radio" name="outcome" value={o} checked={outcome === o} onChange={() => setOutcome(o)} />
              {t(`ca.outcome.${o}` as MessageKey)}
            </label>
          ))}
        </div>
      </fieldset>
      {outcome === 'callback_requested' && (
        <div className="fg">
          <DateField label={t('ca.call.callbackDate')} value={date} onChange={setDate} min={istDateKey(now)} required />
          <div className="fld">
            <label htmlFor="ca-callback-time">{t('ca.call.callbackTime')}</label>
            <input id="ca-callback-time" type="time" value={time} min="09:00" max="21:00" step={900} required onChange={(e) => setTime(e.target.value)} />
          </div>
        </div>
      )}
      <div className="fld">
        <label htmlFor="ca-note">{outcome === 'rejected_offer' ? t('ca.call.reason') : t('ca.call.note')}</label>
        <textarea id="ca-note" rows={2} value={note} onChange={(e) => setNote(e.target.value)} maxLength={500} />
      </div>
      <p className="sub">{t('ca.call.explain')}</p>
      {error && <p className="vno" role="alert">{error}</p>}
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        <Button type="submit" variant="primary" loading={save.isPending}>{t('ca.call.saveNext')}</Button>
        <Button type="button" variant="secondary" onClick={submit(false)} disabled={save.isPending}>{t('ca.call.save')}</Button>
        <Link className="btn bs lb-btn" to={`${to('CA06-BookInterview')}?person=${encodeURIComponent(profileCode)}&call=${encodeURIComponent(callId)}`}>{t('ca.call.book')}</Link>
        <Link className="btn bd lb-btn" to={`${to('CA12-Withdraw')}?person=${encodeURIComponent(profileCode)}&call=${encodeURIComponent(callId)}`}>{t('ca.call.withdraw')}</Link>
      </div>
      <p className="sub">{t('ca.call.hoursNote', { start: clock12('09:00'), end: clock12('21:00') })}</p>
    </form>
  );
}
