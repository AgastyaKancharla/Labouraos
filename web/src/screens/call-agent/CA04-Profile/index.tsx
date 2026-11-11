import { Link, useParams, useSearchParams } from 'react-router-dom';
import { Button } from '../../../components/Button';
import { ErrorState } from '../../../components/ErrorState';
import { SkeletonCard } from '../../../components/Skeleton';
import { TopBar } from '../../../components/TopBar';
import { useT } from '../../../i18n/I18nProvider';
import type { MessageKey } from '../../../i18n/en';
import { formatDateIST, formatDayMonthIST } from '../../../lib/format/date';
import { useNow } from '../../../lib/useNow';
import { useScreenPath } from '../../../portals/PortalContext';
import { useJobs, useProfile, type BusinessProfile, type Profile, type ReferralProfile, type SeekerProfile, type WorkItem } from '../_lib/api';
import { clock12, followUpKindLabel, whyText } from '../_lib/format';
import { BestJobs, Glance, History, ProfileHeader } from '../_lib/ProfileParts';
import { useCallActions } from '../_lib/useCallActions';
import { WorkListAside } from '../_lib/WorkListAside';

/**
 * The one full profile — designs CA04-Profile and CA04b-FollowUpProfile.
 * Opened from Home, My follow-ups, search or an incoming call: why the
 * person is on the list, Call (through the calling system, locked outside
 * calling hours and his best time), details or the businesses he was
 * introduced to, at a glance, best matching jobs and the history.
 */
export default function PersonProfile() {
  const { id = '' } = useParams();
  const [params] = useSearchParams();
  const t = useT();
  const profile = useProfile(id);
  const data = profile.data;
  return (
    <div className="lb-page lb-ca">
      <TopBar title={data?.name ?? t('screen.CA04-Profile')} titleHidden />
      <div className="lb-ca-split">
        <WorkListAside currentId={data?.id} />
        <div className="lb-ca-main">
          {profile.error && <ErrorState error={profile.error} onRetry={() => void profile.refetch()} />}
          {!data && !profile.error && <SkeletonCard height={320} />}
          {data && <ProfileBody profile={data} followUpView={Boolean(params.get('followUp')) || isFollowUp(data.onList)} />}
        </div>
      </div>
    </div>
  );
}

function isFollowUp(item: WorkItem | null): boolean {
  return item?.kind === 'follow_up' || item?.kind === 'refund_check';
}

function callBlockReason(profile: Profile, t: ReturnType<typeof useT>): string | null {
  if (!profile.inCallingHours) return t('ca.locked.outside_calling_hours', { start: clock12(profile.callingHours.start), end: clock12(profile.callingHours.end) });
  if (!profile.attendanceAvailable) return t('ca.blocked.not_available');
  if (profile.type === 'job_seeker') {
    if (!profile.withinBestTimeNow) return t('ca.locked.outside_his_window', { start: clock12(profile.bestTime.start), end: clock12(profile.bestTime.end) });
    if (!profile.glance.callRecordingConsent && profile.onList?.call.purpose !== 'consent_explain') return t('ca.locked.no_call_consent');
  }
  return null;
}

function ProfileBody({ profile, followUpView }: { profile: Profile; followUpView: boolean }) {
  const t = useT();
  const to = useScreenPath();
  const { call, placing } = useCallActions();
  const first = profile.name.split(/\s+/)[0] ?? profile.name;
  const blocked = callBlockReason(profile, t);
  const purpose =
    profile.onList?.call ??
    (profile.type === 'job_seeker' && profile.liveOffer
      ? { purpose: 'offer', relatedType: 'interview', relatedId: profile.liveOffer.interviewId }
      : { purpose: 'general', relatedType: null, relatedId: null });
  const placeCall = () =>
    call({ subjectType: profile.type, subjectId: profile.id, purpose: purpose.purpose, relatedType: purpose.relatedType, relatedId: purpose.relatedId });

  return (
    <>
      <div className="card" style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        <ProfileHeader profile={profile} />
        {profile.onList && (
          <div className={profile.onList.priority ? 'warn' : 'lb-ca-why'}>
            <strong>{t('ca.profile.why')}</strong> {whyText(profile.onList, t)}
          </div>
        )}
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
          <Button variant="primary" onClick={placeCall} loading={placing} disabled={Boolean(blocked)}>
            ☎ {t('ca.profile.call', { name: first })}
          </Button>
          {profile.type === 'job_seeker' && (
            <>
              <Link className="btn bs lb-btn" to={to('CA08d-SignedConsent', { id: profile.code })}>{t('ca.profile.viewConsent')}</Link>
              <Link to={to('CA08c-InProgress', { id: profile.code })} className={`tag ${profile.registration.done === profile.registration.total ? 'tg' : 'ta'}`}>
                {profile.registration.done === profile.registration.total
                  ? t('ca.profile.registrationDone')
                  : t('ca.profile.registration', { done: profile.registration.done, total: profile.registration.total })}
              </Link>
            </>
          )}
          {profile.type === 'business' && (
            <Link className="btn bs lb-btn" to={`${to('CA09-AddVacancy')}?business=${encodeURIComponent(profile.code)}`}>{t('ca.addVacancy')}</Link>
          )}
        </div>
        {blocked && <p className="sub" role="status">{blocked}</p>}
        <p className="sub">{t('ca.profile.callingNote')}</p>
      </div>

      {profile.type === 'job_seeker' && (followUpView ? <FollowUpView profile={profile} /> : <SeekerDetails profile={profile} />)}
      {profile.type === 'business' && <BusinessDetails profile={profile} />}
      {profile.type === 'referral' && <ReferralDetails profile={profile} />}
      <History rows={profile.history} />
    </>
  );
}

function SeekerDetails({ profile }: { profile: SeekerProfile }) {
  const t = useT();
  return (
    <>
      <div className="grid2" style={{ gridTemplateColumns: 'repeat(auto-fit,minmax(280px,1fr))' }}>
        <div className="card">
          <h2 className="h2" style={{ marginBottom: 6 }}>{t('ca.profile.details')}</h2>
          <div className="row">
            <span>{t('ca.profile.trades')}</span>
            <b>{profile.trades.map((tr) => `${tr.trade} (${t('ca.years', { count: tr.years })})`).join(' · ') || '—'}</b>
          </div>
          <div className="row">
            <span>{t('ca.profile.travels')}</span>
            <b>{profile.travelDistanceKm !== null ? t('ca.profile.travelsValue', { km: profile.travelDistanceKm, place: profile.locality ?? '—' }) : '—'}</b>
          </div>
          <div className="row">
            <span>{t('ca.profile.shift')}</span>
            <b>{profile.shiftPreference ?? '—'}</b>
          </div>
          <div className="row">
            <span>{t('ca.profile.availableFrom')}</span>
            <b>{profile.availableFrom ? formatDateIST(profile.availableFrom) : '—'}</b>
          </div>
          {profile.editLocked && <p className="sub" style={{ marginTop: 8 }}>{t('ca.profile.editLocked')}</p>}
        </div>
        <Glance profile={profile} />
      </div>
      <BestJobs profile={profile} />
    </>
  );
}

function introLabel(i: SeekerProfile['introductions'][number], t: ReturnType<typeof useT>): { text: string; tone: string } {
  if (i.result === 'not_selected') return { text: t('ca.intro.notSelected'), tone: 'tn' };
  if (i.result === 'selected') return { text: t('ca.intro.selected'), tone: 'tg' };
  switch (i.status) {
    case 'declined':
      return { text: t('ca.intro.declined'), tone: 'tr' };
    case 'no_reply':
      return { text: t('ca.intro.noReply'), tone: 'tr' };
    case 'no_show':
      return { text: t('ca.intro.noShow'), tone: 'tr' };
    case 'offered':
      return { text: t('ca.intro.offered'), tone: 'ta' };
    case 'confirmed':
      return { text: t('ca.intro.confirmed'), tone: 'tb' };
    case 'cancelled':
      return { text: t('ca.intro.cancelled'), tone: 'tn' };
    default:
      return { text: i.status.replace(/_/g, ' '), tone: 'tn' };
  }
}

function FollowUpView({ profile }: { profile: SeekerProfile }) {
  const t = useT();
  const now = useNow();
  const jobs = useJobs(profile.code, 1);
  const next = jobs.data?.jobs[0];
  const g = profile.glance;
  return (
    <div className="grid2" style={{ gridTemplateColumns: 'repeat(auto-fit,minmax(280px,1fr))' }}>
      <div className="card">
        <h2 className="h2" style={{ marginBottom: 6 }}>{t('ca.intro.title')}</h2>
        {profile.introductions.length === 0 && <p className="sub">{t('ca.intro.none')}</p>}
        {profile.introductions.map((i) => {
          const label = introLabel(i, t);
          return (
            <div className="row" key={i.interviewId}>
              <span>
                {i.businessName} · {i.trade} · {t('ca.intro.interview', { date: formatDayMonthIST(i.slotStartsAt) })}
              </span>
              <span className={`tag ${label.tone}`}>{label.text}</span>
            </div>
          );
        })}
        {next && (
          <div className="row">
            <span>{t('ca.intro.nextMatch', { job: `${next.roleTitle ?? next.trade}${next.locality ? ` · ${next.locality}` : ''} · ${t('ca.km', { km: next.distanceKm })}` })}</span>
            <span className="tag tn">{t('ca.intro.notOffered')}</span>
          </div>
        )}
      </div>
      <div className="card">
        <h2 className="h2" style={{ marginBottom: 6 }}>{t('ca.status.title')}</h2>
        <div className="row">
          <span>{t('ca.status.registration')}</span>
          <b>{profile.registration.done === profile.registration.total ? t('ca.status.allDone') : `${profile.registration.done} / ${profile.registration.total}`}</b>
        </div>
        <div className="row">
          <span>{t('ca.status.guarantee')}</span>
          <b>{g.guaranteeDay ? t('ca.glance.paidDay', { day: g.guaranteeDay, days: g.guaranteeDays }) : t('ca.glance.notPaid')}</b>
        </div>
        <div className="row">
          <span>{t('ca.glance.hits')}</span>
          <b>{t('ca.glance.hitsValue', { hits: g.hits, max: g.maxHits })}</b>
        </div>
        {profile.followUpDue && (
          <div className="row">
            <span>{t('ca.status.followUpDue')}</span>
            <b>
              {new Date(profile.followUpDue.dueAt) <= now ? t('ca.today') : formatDayMonthIST(profile.followUpDue.dueAt)} · {followUpKindLabel(profile.followUpDue.kind, t)}
            </b>
          </div>
        )}
        <div className="row">
          <span>{t('ca.glance.bestTime')}</span>
          <b>{clock12(profile.bestTime.start)} – {clock12(profile.bestTime.end)}</b>
        </div>
      </div>
    </div>
  );
}

function BusinessDetails({ profile }: { profile: BusinessProfile }) {
  const t = useT();
  return (
    <div className="card">
      <h2 className="h2" style={{ marginBottom: 6 }}>{t('ca.profile.details')}</h2>
      <div className="row"><span>{t('ca.biz.contact')}</span><b>{[profile.contactName, profile.contactRole].filter(Boolean).join(' · ') || '—'}</b></div>
      <div className="row"><span>{t('ca.biz.status')}</span><b>{profile.verificationStatus ?? '—'}</b></div>
      <div className="row"><span>{t('ca.biz.agent')}</span><b>{profile.accountAgent ?? '—'}</b></div>
      <h3 className="lbl" style={{ marginTop: 12 }}>{t('ca.biz.vacancies')}</h3>
      {profile.openVacancies.length === 0 && <p className="sub">{t('ca.biz.noVacancies')}</p>}
      {profile.openVacancies.map((v) => (
        <div className="row" key={v.id}>
          <span>{v.roleTitle ?? v.tradeSkill}</span>
          <span className="tag tb">{v.code} · {t('ca.biz.headcount', { count: v.headcount })}</span>
        </div>
      ))}
    </div>
  );
}

function ReferralDetails({ profile }: { profile: ReferralProfile }) {
  const t = useT();
  return (
    <div className="card">
      <h2 className="h2" style={{ marginBottom: 6 }}>{t('ca.profile.details')}</h2>
      <div className="row"><span>{t('ca.ref.type')}</span><b>{t(`ca.ref.kind.${profile.partnerType === 'business' ? 'business' : 'individual'}` as MessageKey)}</b></div>
      <div className="row"><span>{t('ca.ref.results')}</span><b>{t('ca.ref.referred', { referred: profile.referred, joined: profile.joined })}</b></div>
    </div>
  );
}
