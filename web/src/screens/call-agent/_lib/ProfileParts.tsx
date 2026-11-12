import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Skeleton } from '../../../components/Skeleton';
import { ErrorState } from '../../../components/ErrorState';
import { useT } from '../../../i18n/I18nProvider';
import type { MessageKey } from '../../../i18n/en';
import { formatDayMonthIST, formatDateIST } from '../../../lib/format/date';
import { useNow } from '../../../lib/useNow';
import { useScreenPath } from '../../../portals/PortalContext';
import { useJobs, type HistoryRow, type Profile, type SeekerProfile } from './api';
import { clock12, salaryRange, time12 } from './format';

function initials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]!.toUpperCase())
    .join('');
}

const SEEKER_STATUSES = ['lead', 'consented', 'pending_activation', 'active', 'paused', 'deactivated', 'placed', 'closed', 'refunded'];

/** The header card: avatar, name, masked phone · trade · languages · salary, status · ID. */
export function ProfileHeader({ profile }: { profile: Profile }) {
  const t = useT();
  let line: string[] = [profile.maskedPhone];
  let status = '';
  if (profile.type === 'job_seeker') {
    const main = profile.trades[0];
    if (main) line.push(`${main.trade}, ${t('ca.years', { count: main.years })}`);
    if (profile.languages.length) line.push(profile.languages.join(', '));
    line.push(t('ca.profile.wants', { salary: salaryRange(profile.salary.minPaise, profile.salary.maxPaise) }));
    status = SEEKER_STATUSES.includes(profile.status) ? t(`ca.seekerStatus.${profile.status}` as MessageKey) : profile.status;
  } else if (profile.type === 'business') {
    line = [profile.maskedPhone, profile.businessType ?? '', profile.locality ?? ''].filter(Boolean);
    status = profile.verificationStatus ?? '';
  } else {
    line = [profile.maskedPhone, profile.occupation ?? '', profile.locality ?? ''].filter(Boolean);
    status = t('ca.ref.referred', { referred: profile.referred, joined: profile.joined });
  }
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'wrap' }}>
      <div className="av lb-ca-avatar" aria-hidden="true">
        {initials(profile.name)}
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <h2 className="h1" style={{ margin: 0 }}>
          {profile.name}
        </h2>
        <div className="sub">{line.join(' · ')}</div>
      </div>
      <span className={`tag ${profile.type === 'job_seeker' && profile.status === 'active' ? 'tg' : 'tn'}`}>
        {[status, profile.code].filter(Boolean).join(' · ')}
      </span>
    </div>
  );
}

/** "Ramesh at a glance": consent, ₹499, Aadhaar, hits, best time to call. */
export function Glance({ profile }: { profile: SeekerProfile }) {
  const t = useT();
  const g = profile.glance;
  const first = profile.name.split(/\s+/)[0] ?? profile.name;
  const aadhaar = ['verified', 'pending', 'failed', 'not_started'].includes(g.aadhaar) ? t(`ca.aadhaar.${g.aadhaar}` as MessageKey) : g.aadhaar;
  return (
    <div className="card">
      <h2 className="h2" style={{ marginBottom: 6 }}>
        {t('ca.glance.title', { name: first })}
      </h2>
      <div className="row">
        <span>{t('ca.glance.consent')}</span>
        <span className={`tag ${g.consentsGiven === g.consentsRequired ? 'tg' : 'ta'}`}>
          {g.consentsGiven === g.consentsRequired
            ? t('ca.glance.consentAll', { count: g.consentsRequired })
            : t('ca.glance.consentSome', { given: g.consentsGiven, count: g.consentsRequired })}
        </span>
      </div>
      <div className="row">
        <span>{t('ca.glance.fee')}</span>
        <span className={`tag ${g.paid ? (g.priority ? 'tr' : 'tg') : 'tn'}`}>
          {g.paid && g.guaranteeDay ? t('ca.glance.paidDay', { day: g.guaranteeDay, days: g.guaranteeDays }) : t('ca.glance.notPaid')}
        </span>
      </div>
      <div className="row">
        <span>{t('ca.glance.aadhaar')}</span>
        <span className={`tag ${g.aadhaar === 'verified' ? 'tg' : 'tn'}`}>{aadhaar}</span>
      </div>
      <div className="row">
        <span>{t('ca.glance.hits')}</span>
        <span className={`tag ${g.hits >= g.maxHits - 1 && g.hits > 0 ? 'tr' : 'tn'}`}>{t('ca.glance.hitsValue', { hits: g.hits, max: g.maxHits })}</span>
      </div>
      <div className="row">
        <span>{t('ca.glance.bestTime')}</span>
        <b>
          {clock12(profile.bestTime.start)} – {clock12(profile.bestTime.end)}
        </b>
      </div>
    </div>
  );
}

/** "Best matching jobs" with Book interview and Show next 3 (seeker-first matching). */
export function BestJobs({ profile, compact }: { profile: SeekerProfile; compact?: boolean }) {
  const t = useT();
  const to = useScreenPath();
  const [page, setPage] = useState(1);
  const jobs = useJobs(profile.code, page);
  const data = jobs.data;
  const more = data ? data.page * data.pageSize < data.total : false;
  return (
    <div className="card">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
        <h2 className="h2">{t('ca.jobs.title')}</h2>
        {(more || page > 1) && (
          <button type="button" className="lb-ca-link" onClick={() => setPage((p) => (more ? p + 1 : 1))}>
            {more ? t('ca.jobs.showNext', { count: data?.pageSize ?? 3 }) : t('ca.jobs.startOver')}
          </button>
        )}
      </div>
      {jobs.isLoading && <Skeleton height={60} />}
      {jobs.error && <ErrorState error={jobs.error} onRetry={() => void jobs.refetch()} compact />}
      {data?.blockedReason && <p className="sub">{t(`ca.jobs.blocked.${data.blockedReason}` as MessageKey)}</p>}
      {data && !data.blockedReason && data.jobs.length === 0 && <p className="sub">{t('ca.jobs.none')}</p>}
      {data?.jobs.map((job) => {
        const slot = job.slots[0];
        return (
          <div className="row" key={job.vacancyId} style={{ alignItems: 'flex-start' }}>
            <div style={{ minWidth: 0 }}>
              <div className="nm">
                {job.roleTitle ?? job.trade}
                {job.locality ? ` · ${job.locality}` : ''}
              </div>
              <div className="sub">
                {[
                  salaryRange(job.salaryMinPaise, job.salaryMaxPaise),
                  job.shift ? t('ca.jobs.shift', { shift: job.shift }) : null,
                  t('ca.km', { km: job.distanceKm }),
                  slot ? t('ca.jobs.walkIn', { date: formatDayMonthIST(slot.startsAt), start: time12(slot.startsAt), end: time12(slot.endsAt) }) : null,
                ]
                  .filter(Boolean)
                  .join(' · ')}
              </div>
            </div>
            {!compact && (
              <Link
                className="btn bs lb-btn"
                style={{ minHeight: 36, padding: '6px 12px', whiteSpace: 'nowrap' }}
                to={`${to('CA06-BookInterview')}?person=${encodeURIComponent(profile.code)}&vacancy=${encodeURIComponent(job.vacancyId)}`}
              >
                {t('ca.jobs.book')}
              </Link>
            )}
          </div>
        );
      })}
      <p className="sub" style={{ marginTop: 8 }}>
        {t('ca.jobs.hidden')}
      </p>
    </div>
  );
}

function historyText(row: HistoryRow, t: ReturnType<typeof useT>): string {
  switch (row.kind) {
    case 'call': {
      const by = row.by === 'you' ? t('ca.you') : (row.by as string | null) ?? '';
      if (row.direction === 'inbound') return t('ca.history.inbound');
      if (row.answered) {
        const base = t('ca.history.callAnswered', { min: Math.max(1, Math.round(Number(row.durationSec ?? 0) / 60)), by });
        return row.note ? `${base} · “${row.note as string}”` : base;
      }
      return t('ca.history.callMissed');
    }
    case 'message':
      return t('ca.history.message', { channel: row.channel === 'whatsapp' ? 'WhatsApp' : 'SMS', template: String(row.template).replace(/_/g, ' ') });
    case 'offer':
      return t('ca.history.offer', { business: String(row.businessName), status: String(row.result ?? row.status).replace(/_/g, ' ') });
    case 'payment_confirmed':
      return t('ca.history.paid');
    case 'registered':
      return t('ca.history.registered', { by: (row.by as string | null) ?? '—' });
    default:
      return row.kind;
  }
}

export function History({ rows }: { rows: HistoryRow[] }) {
  const t = useT();
  const now = useNow();
  const today = formatDateIST(now);
  return (
    <div className="card">
      <h2 className="h2" style={{ marginBottom: 6 }}>
        {t('ca.history.title')}
      </h2>
      {rows.length === 0 && <p className="sub">{t('ca.history.none')}</p>}
      {rows.map((row, i) => {
        const when = formatDateIST(row.at) === today ? `${t('ca.today')} ${time12(row.at)}` : `${formatDayMonthIST(row.at)} ${time12(row.at)}`;
        return (
          <div className="row" key={`${row.kind}-${row.at}-${i}`} style={{ justifyContent: 'flex-start' }}>
            <span className="sub" style={{ minWidth: 110 }}>
              {when}
            </span>
            <span>{historyText(row, t)}</span>
          </div>
        );
      })}
    </div>
  );
}
