import { useEffect, useState, type FormEvent } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { Button } from '../../../components/Button';
import { ErrorState } from '../../../components/ErrorState';
import { SkeletonCard } from '../../../components/Skeleton';
import { useToast } from '../../../components/Toast';
import { TopBar } from '../../../components/TopBar';
import { useT } from '../../../i18n/I18nProvider';
import { api } from '../../../lib/api/client';
import { ApiError } from '../../../lib/api/errors';
import { formatDayMonthIST } from '../../../lib/format/date';
import { useNow } from '../../../lib/useNow';
import { useScreenPath } from '../../../portals/PortalContext';
import { useFollowUp, type FollowUpDetail } from '../_lib/api';
import { stopwatch } from '../_lib/format';
import { useCallActions } from '../_lib/useCallActions';
import { useLiveCall } from '../_lib/useLiveCall';

/**
 * Follow-up answer — design CA10b-FollowUpAnswer. The live call is the
 * evidence: the answer form opens only when the calling system confirms the
 * call was answered, and the call is attached to the answer automatically.
 * "Working at the business we introduced" raises the bypass flag.
 */
type Answer = 'working_at_introduced_business' | 'working_elsewhere' | 'not_working';

export default function FollowUpAnswer() {
  const { id = '' } = useParams();
  const [params] = useSearchParams();
  const t = useT();
  const task = useFollowUp(id);
  const callId = params.get('call');
  const d = task.data;
  return (
    <div className="lb-page lb-ca">
      <TopBar title={d ? t('ca.fua.title', { name: d.name }) : t('screen.CA10b-FollowUpAnswer')} />
      {task.error && <ErrorState error={task.error} onRetry={() => void task.refetch()} />}
      {!d && !task.error && <SkeletonCard height={300} />}
      {d && (callId ? <WithCall task={d} callId={callId} /> : <StartCall task={d} />)}
    </div>
  );
}

function StartCall({ task }: { task: FollowUpDetail }) {
  const t = useT();
  const to = useScreenPath();
  const navigate = useNavigate();
  const { call, placing } = useCallActions();
  return (
    <div className="card" style={{ maxWidth: 760, display: 'flex', flexDirection: 'column', gap: 12 }}>
      <p className="sub">{t('ca.fua.waiting')}</p>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        <Button
          variant="primary"
          loading={placing}
          onClick={() => call({ subjectType: task.subjectType, subjectId: task.subjectId, ...task.call })}
        >
          ☎ {t('ca.fua.placeCall', { name: task.name.split(/\s+/)[0] ?? task.name })}
        </Button>
        <Button variant="secondary" onClick={() => navigate(to('CA10-FollowUps'))}>{t('common.back')}</Button>
      </div>
    </div>
  );
}

function WithCall({ task, callId }: { task: FollowUpDetail; callId: string }) {
  const t = useT();
  const toast = useToast();
  const navigate = useNavigate();
  const to = useScreenPath();
  const qc = useQueryClient();
  const now = useNow(1000);
  const call = useLiveCall(callId);
  const c = call.data;
  const [answer, setAnswer] = useState<Answer | ''>('');
  const [businessId, setBusinessId] = useState(task.introducedBusinesses[0]?.businessId ?? '');
  const [foundOwn, setFoundOwn] = useState(false);
  const [notes, setNotes] = useState('');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (c?.final && !c.answered) navigate(to('CA05n-NoAnswer', { id: callId }), { replace: true });
  }, [c, callId, navigate, to]);

  const save = useMutation({
    mutationFn: () =>
      api.post(`/follow-up-tasks/${encodeURIComponent(task.id)}/complete`, {
        callRecordId: callId,
        answer,
        answerBusinessId: answer === 'working_at_introduced_business' ? businessId : undefined,
        foundOwnJob: answer === 'working_elsewhere' && task.subjectType === 'job_seeker' ? foundOwn : undefined,
        notes: notes.trim() || undefined,
      }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['call-work'] });
      toast.success(t('ca.fua.saved'));
      navigate(to('CA10-FollowUps'));
    },
    onError: (err) => setError(err instanceof ApiError ? err.message : String(err)),
  });

  const submit = (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    if (!answer) return setError(t('ca.call.pickOne'));
    if (answer === 'working_at_introduced_business' && !businessId) return setError(t('ca.fua.pickBusiness'));
    save.mutate();
  };

  if (call.error) return <ErrorState error={call.error} onRetry={() => void call.refetch()} />;
  if (!c) return <SkeletonCard height={200} />;
  const seconds = c.answeredAt ? ((c.endedAt ? new Date(c.endedAt) : now).getTime() - new Date(c.answeredAt).getTime()) / 1000 : 0;
  const chosen = task.introducedBusinesses.find((b) => b.businessId === businessId);

  return (
    <div className="card" style={{ maxWidth: 820, display: 'flex', flexDirection: 'column', gap: 14 }}>
      {c.answered ? (
        <div className="ok" role="status">
          <span className="dot" style={{ background: 'var(--green)' }} />
          <span>{t('ca.fua.onCall', { time: stopwatch(seconds) })}</span>
          <span style={{ marginLeft: 'auto', fontWeight: 600 }}>{t('ca.call.confirmed')}</span>
        </div>
      ) : (
        <div className="warn" role="status" aria-live="polite">{t('ca.call.ringing')}</div>
      )}
      {c.answered && (
        <form onSubmit={submit} style={{ display: 'flex', flexDirection: 'column', gap: 12 }} noValidate>
          <fieldset style={{ border: 0, padding: 0, margin: 0 }}>
            <legend className="h2" style={{ marginBottom: 8 }}>{t('ca.fua.ask')}</legend>
            <div className="lb-ca-options">
              {(['working_at_introduced_business', 'working_elsewhere', 'not_working'] as const).map((a) => (
                <label key={a} className={`opt${answer === a ? ' on' : ''}`}>
                  <input type="radio" name="answer" value={a} checked={answer === a} onChange={() => setAnswer(a)} />
                  {t(`ca.fua.answer.${a}`)}
                </label>
              ))}
            </div>
          </fieldset>
          {answer === 'working_at_introduced_business' && (
            <>
              <div className="fld">
                <label htmlFor="ca-fua-business">{t('ca.fua.which')}</label>
                <select id="ca-fua-business" value={businessId} onChange={(e) => setBusinessId(e.target.value)}>
                  {task.introducedBusinesses.map((b) => (
                    <option key={b.businessId} value={b.businessId}>
                      {b.result === 'not_selected' && b.resultAt
                        ? t('ca.fua.optionNotSelected', { name: b.name, date: formatDayMonthIST(b.resultAt) })
                        : b.name}
                    </option>
                  ))}
                </select>
              </div>
              {chosen && !chosen.feePaid && <div className="warn">{t('ca.fua.bypass', { business: chosen.name, name: task.name.split(/\s+/)[0] ?? task.name })}</div>}
            </>
          )}
          {answer === 'working_elsewhere' && task.subjectType === 'job_seeker' && (
            <label className="opt">
              <input type="checkbox" checked={foundOwn} onChange={(e) => setFoundOwn(e.target.checked)} />
              {t('ca.fua.foundOwn')}
            </label>
          )}
          <div className="fld">
            <label htmlFor="ca-fua-notes">{t('ca.call.note')}</label>
            <textarea id="ca-fua-notes" rows={2} value={notes} maxLength={500} onChange={(e) => setNotes(e.target.value)} />
          </div>
          <p className="sub">{t('ca.fua.others')}</p>
          {error && <p className="vno" role="alert">{error}</p>}
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <Button type="submit" variant="primary" loading={save.isPending}>{t('ca.fua.save')}</Button>
            <Link className="btn bs lb-btn" to={to('CA10-FollowUps')}>{t('common.cancel')}</Link>
          </div>
        </form>
      )}
    </div>
  );
}
