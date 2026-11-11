import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { Button } from '../../../components/Button';
import { EmptyState, ErrorState } from '../../../components/ErrorState';
import { SkeletonCard } from '../../../components/Skeleton';
import { TopBar } from '../../../components/TopBar';
import { useT } from '../../../i18n/I18nProvider';
import { api } from '../../../lib/api/client';
import { ApiError } from '../../../lib/api/errors';
import { formatDayMonthIST } from '../../../lib/format/date';
import { useScreenPath } from '../../../portals/PortalContext';
import { useJobs, useProfile, type JobMatch, type SeekerProfile } from '../_lib/api';
import { salaryRange, time12 } from '../_lib/format';
import { BestJobs } from '../_lib/ProfileParts';

/**
 * Book an interview — design CA06-BookInterview. A real walk-in slot at a
 * verified business, for a job the matching rules already found suitable
 * (same trade, salary inside his range, within his travel distance, his
 * shift). "Send the offer" books it (POST /interviews); the offer goes out by
 * SMS and WhatsApp with the business name hidden until he says yes.
 */
export default function BookInterview() {
  const t = useT();
  const [params] = useSearchParams();
  const person = params.get('person') ?? '';
  const vacancy = params.get('vacancy');
  const to = useScreenPath();
  const profile = useProfile(person);
  const p = profile.data?.type === 'job_seeker' ? (profile.data as SeekerProfile) : null;
  const first = p?.name.split(/\s+/)[0] ?? '';
  return (
    <div className="lb-page lb-ca">
      <TopBar title={p ? t('ca.book.title', { name: first }) : t('screen.CA06-BookInterview')} back={person ? { to: to('CA04-Profile', { id: person }), label: t('common.back') } : undefined} />
      {profile.error && <ErrorState error={profile.error} onRetry={() => void profile.refetch()} />}
      {!person && <EmptyState title={t('ca.book.pickPerson')} />}
      {person && !p && !profile.error && <SkeletonCard height={300} />}
      {p && (vacancy ? <BookJob profile={p} vacancyId={vacancy} /> : <BestJobs profile={p} />)}
    </div>
  );
}

function BookJob({ profile, vacancyId }: { profile: SeekerProfile; vacancyId: string }) {
  const t = useT();
  const jobs = useJobs(profile.code, 1, vacancyId);
  const job = jobs.data?.jobs.find((j) => j.vacancyId === vacancyId);
  if (jobs.error) return <ErrorState error={jobs.error} onRetry={() => void jobs.refetch()} />;
  if (!jobs.data) return <SkeletonCard height={300} />;
  if (!job) return <EmptyState title={t('ca.book.notFound')}>{jobs.data.blockedReason ? t(`ca.jobs.blocked.${jobs.data.blockedReason}` as never) : null}</EmptyState>;
  return <BookForm profile={profile} job={job} />;
}

function BookForm({ profile, job }: { profile: SeekerProfile; job: JobMatch }) {
  const t = useT();
  const navigate = useNavigate();
  const to = useScreenPath();
  const qc = useQueryClient();
  const first = profile.name.split(/\s+/)[0] ?? profile.name;
  const open = job.slots.filter((s) => s.placesLeft === null || s.placesLeft > 0);
  const [slotId, setSlotId] = useState(open[0]?.id ?? '');
  const [error, setError] = useState<string | null>(null);
  const slot = job.slots.find((s) => s.id === slotId);
  const place = [job.businessType ? t('ca.book.aBusiness', { type: job.businessType.toLowerCase() }) : null, job.locality].filter(Boolean).join(' · ');
  const book = useMutation({
    mutationFn: () => api.post<{ id: string; replyDueAt: string }>('/interviews', { vacancyId: job.vacancyId, jobSeekerId: profile.id, slotId }),
    onSuccess: (interview) => {
      void qc.invalidateQueries({ queryKey: ['call-work'] });
      navigate(
        `${to('CA06b-OfferSent')}?person=${encodeURIComponent(profile.code)}&interview=${encodeURIComponent(interview.id)}&due=${encodeURIComponent(interview.replyDueAt)}`,
      );
    },
    onError: (err) => setError(err instanceof ApiError ? err.message : String(err)),
  });

  return (
    <div className="grid2" style={{ gridTemplateColumns: 'repeat(auto-fit,minmax(320px,1fr))' }}>
      <div className="card" style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        <div>
          <div className="lbl">{t('ca.book.job')}</div>
          <h2 className="h2" style={{ marginTop: 4 }}>{t('ca.book.jobLine', { trade: job.roleTitle ?? job.trade, place })}</h2>
          <p className="sub">
            {[
              t('ca.book.perMonth', { salary: salaryRange(job.salaryMinPaise, job.salaryMaxPaise) }),
              job.shift ? `${job.shift}${job.workingHours ? `, ${job.workingHours}` : ''}` : job.workingHours,
              job.weeklyOff ? t('ca.book.weeklyOff', { day: job.weeklyOff }) : null,
              ...job.extras,
              t('ca.book.fromHim', { km: job.distanceKm, name: first }),
            ]
              .filter(Boolean)
              .join(' · ')}
          </p>
        </div>
        <div>
          <div className="lbl" style={{ marginBottom: 4 }}>{t('ca.book.suits')}</div>
          <div className="row"><span>{t('ca.book.sameTrade')}</span><span className="tag tg">{t('ca.book.yes')}</span></div>
          <div className="row"><span>{t('ca.book.salary')}</span><span className="tag tg">{t('ca.book.yes')}</span></div>
          <div className="row">
            <span>{t('ca.book.distance')}</span>
            <span className="tag tg">{t('ca.book.distanceValue', { km: job.suitability.distanceKm, max: job.suitability.travelDistanceKm })}</span>
          </div>
          <div className="row"><span>{t('ca.book.shift')}</span><span className="tag tg">{job.suitability.shift ?? t('ca.book.yes')}</span></div>
        </div>
        <fieldset style={{ border: 0, padding: 0, margin: 0, display: 'flex', flexDirection: 'column', gap: 8 }}>
          <legend className="lbl" style={{ marginBottom: 6 }}>{t('ca.book.pick')}</legend>
          {job.slots.length === 0 && <p className="sub">{t('ca.book.noSlots')}</p>}
          {job.slots.map((s) => {
            const full = s.placesLeft !== null && s.placesLeft <= 0;
            return (
              <label key={s.id} className={`opt${slotId === s.id ? ' on' : ''}${full ? ' dis' : ''}`}>
                <input type="radio" name="slot" value={s.id} checked={slotId === s.id} disabled={full} onChange={() => setSlotId(s.id)} />
                {t('ca.book.slot', { date: formatDayMonthIST(s.startsAt), start: time12(s.startsAt), end: time12(s.endsAt) })}
                {s.placesLeft !== null && ` · ${t('ca.book.places', { count: s.placesLeft })}`}
              </label>
            );
          })}
        </fieldset>
        {error && <p className="vno" role="alert">{error}</p>}
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <Button variant="primary" disabled={!slotId} loading={book.isPending} onClick={() => book.mutate()}>{t('ca.book.send')}</Button>
          <Link className="btn bs lb-btn" to={to('CA04-Profile', { id: profile.code })}>{t('common.cancel')}</Link>
        </div>
      </div>
      <div className="card" style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        <h2 className="h2">{t('ca.book.receives', { name: first })}</h2>
        <div className="script">
          {t('ca.book.preview', {
            trade: job.roleTitle ?? job.trade,
            place: job.locality ?? '',
            salary: salaryRange(job.salaryMinPaise, job.salaryMaxPaise),
            shift: job.shift ?? '',
            date: slot ? formatDayMonthIST(slot.startsAt) : '—',
            start: slot ? time12(slot.startsAt) : '',
            end: slot ? time12(slot.endsAt) : '',
          })}
        </div>
        <p className="sub">{t('ca.book.hiddenNote')}</p>
        <div className="warn">{t('ca.book.guarantee')}</div>
      </div>
    </div>
  );
}
