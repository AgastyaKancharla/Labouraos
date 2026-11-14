import { useQuery } from '@tanstack/react-query';
import { Link, useParams } from 'react-router-dom';
import { Button } from '../../../components/Button';
import { Card } from '../../../components/Card';
import { ErrorState } from '../../../components/ErrorState';
import { SkeletonCard } from '../../../components/Skeleton';
import { StatGrid, StatTile } from '../../../components/StatTile';
import { StatusPill } from '../../../components/Badge';
import { TopBar } from '../../../components/TopBar';
import { api } from '../../../lib/api/client';
import { downloadTextFile } from '../../../lib/csv';
import { formatDateIST, formatDateTimeIST } from '../../../lib/format/date';
import { formatINR } from '../../../lib/format/money';
import { formatMobile } from '../../../lib/format/phone';
import { useScreenPath } from '../../../portals/PortalContext';
import { ActionButton } from '../_kit/actions';
import { Kv, Timeline, dateOrDash, humanize } from '../_kit/kit';
import { SEEKER_STATUS, guaranteePill } from '../_kit/labels';
import { AadhaarCheckCard } from '../_kit/AadhaarCheck';

/** CEO job seeker page — design C-JobSeeker.dc.html. */
interface Detail {
  id: string;
  code: string;
  name: string;
  phone: string;
  status: string;
  createdAt: string;
  guarantee: { days: number; paidAt: string | null; daysLeft: number | null; floorPaise: number | null };
  hits: { count: number; max: number };
  offersMade: number;
  interviews: number;
  activation: { amountPaise: number; at: string; utr: string | null; confirmedBy: string | null } | null;
  refunds: { id: string; code: string; amountPaise: number; status: string; at: string }[];
  profile: {
    trades: { trade: string; years: number; primary: boolean }[];
    locality: string | null;
    travelDistanceKm: number | null;
    salaryMinPaise: number;
    salaryMaxPaise: number;
    salaryPeriod: string | null;
    shiftPreference: string | null;
    jobType: string | null;
    languages: string[];
    qualification: string | null;
    referredBy: { id: string; code: string; name: string } | null;
    registeredBy: { id: string; name: string } | null;
    heardFrom: string | null;
  };
  registration: {
    phoneVerified: boolean;
    consentsGranted: number;
    consentsAsked: number;
    consentAt: string | null;
    selfieAt: string | null;
    idCheck: { method: string; last4?: string | null; adult?: boolean | null; status?: string; failureReason?: string | null } | null;
    paymentAt: string | null;
  };
  hitList: { id: string; reason: string; at: string; reversed: boolean; superseded: boolean }[];
  activity: { at: string; business: string | null; businessId: string | null; what: string; status: string; hit: boolean }[];
  placements: { id: string; code: string; status: string; business: string; joinedDate: string | null }[];
  history: { at: string; kind: string; text: string; by: string | null; detail?: string | null }[];
}

/** How the ID was checked (guide, 14 Nov: Aadhaar by its Secure QR, or another government ID). */
const ID_METHOD: Record<string, string> = {
  aadhaar_qr: 'Aadhaar QR',
  aadhaar_older_check: 'Aadhaar (older check)',
  pan: 'PAN',
  driving_licence: 'Driving licence',
  voter_id: 'Voter ID',
};

const ACTIVITY: Record<string, string> = {
  offered: 'Offer sent · waiting for reply',
  confirmed: 'Interview booked',
  declined: 'Offer declined',
  no_reply: 'No reply to the offer',
  completed: 'Interview done',
  no_show: "Didn't turn up",
  no_result: 'Waiting for the owner’s result',
  cancelled: 'Booking cancelled',
  no_pickup: 'No pickup (calls + message)',
  offer_declined: 'Offer declined',
  offer_no_reply: 'No reply to the offer',
  interview_no_show: "Didn't turn up",
  reversed: 'Hit reversed',
};

function historyText(e: Detail['history'][number]): string {
  const by = e.by ? ` · ${e.by}` : '';
  switch (e.kind) {
    case 'registered':
      return `Registered${by}${e.detail ? ` · ${humanize(e.detail)}` : ''}`;
    case 'call_answered':
      return `Call answered${e.detail ? ` · ${e.detail}` : ''}${by} · ${humanize(e.text)}`;
    case 'call_missed':
      return `Call not answered${by} · ${humanize(e.text)}`;
    case 'hit':
      return `Hit recorded — ${ACTIVITY[e.text] ?? humanize(e.text)}`;
    case 'hit_reversed':
      return `Hit reversed${by}${e.detail ? ` — ${e.detail}` : ''}`;
    case 'offer':
      return `Offer · ${e.detail ?? ''} · ${ACTIVITY[e.text] ?? humanize(e.text)}`;
    case 'status':
      return `Status → ${SEEKER_STATUS[e.text]?.label ?? humanize(e.text)}${by}${e.detail ? ` · ${humanize(e.detail)}` : ''}`;
    default:
      if (e.kind.startsWith('payment_')) return `${humanize(e.kind.slice(8))} payment ${humanize(e.text).toLowerCase()} · ${e.detail ?? ''}`;
      if (e.kind.startsWith('message_')) return `${e.kind.slice(8).toUpperCase()} · ${humanize(e.text)} · ${e.detail ?? ''}`;
      return humanize(e.text);
  }
}

export default function JobSeekerDetail() {
  const { id = '' } = useParams();
  const to = useScreenPath();
  const query = useQuery({ queryKey: ['ceo', 'job-seeker', id], queryFn: () => api.get<Detail>(`/ceo/job-seekers/${id}`) });
  const d = query.data;
  const back = { to: to('JobSeekers'), label: 'Job Seekers' };

  if (query.isPending) {
    return (
      <div className="lb-page">
        <TopBar back={back} title="Job seeker" />
        <SkeletonCard height={120} />
        <SkeletonCard height={260} />
      </div>
    );
  }
  if (query.isError || !d) {
    return (
      <div className="lb-page">
        <TopBar back={back} title="Job seeker" />
        <ErrorState error={query.error} onRetry={() => void query.refetch()} />
      </div>
    );
  }

  const primary = d.profile.trades[0]?.trade ?? 'No trade';
  const g = d.guarantee;
  const day = g.paidAt && g.daysLeft !== null ? Math.min(g.days, g.days - g.daysLeft) : null;
  const statusLabel = SEEKER_STATUS[d.status]?.label ?? d.status;
  const subtitle =
    g.daysLeft !== null
      ? `${primary} · ${statusLabel.toLowerCase()} · ${g.daysLeft} days left on his ${g.days}-day guarantee${g.daysLeft <= 15 ? ` — needs a suitable offer now or he can claim ${formatINR(d.activation?.amountPaise ?? 0)}.` : '.'}`
      : `${primary} · ${statusLabel.toLowerCase()}`;
  const liveHits = d.hitList.filter((h) => !h.reversed && !h.superseded);
  const refundsActive = d.refunds.filter((r) => !['failed', 'rejected', 'reversed'].includes(r.status));

  const exportRecord = () => {
    downloadTextFile(`${d.code}.json`, JSON.stringify(d, null, 2), 'application/json');
  };

  return (
    <div className="lb-page">
      <TopBar
        back={back}
        title={`${d.name} · ${d.code}`}
        subtitle={subtitle}
        actions={
          <div className="ceo-actions">
            <Button onClick={exportRecord}>Export record</Button>
            <ActionButton
              label="Reverse a hit"
              title="Reverse a hit"
              description="Only when the hit was recorded wrongly. The Manager is told, and the reason is kept in the audit log."
              disabled={liveHits.length === 0}
              choice={{ label: 'Which hit', options: liveHits.map((h) => ({ value: h.id, label: `${formatDateIST(h.at)} · ${ACTIVITY[h.reason] ?? humanize(h.reason)}` })) }}
              reason
              run={({ reason, choice }) => api.post(`/job-seeker-hits/${choice}/reverse`, { reversalReason: reason })}
              success="Hit reversed"
            />
            <ActionButton
              label="Approve refund early"
              title="Approve the ₹499 refund"
              variant="primary"
              description="The software checks the refund rules first (30 days over, no suitable offer turned down, refund-check call recorded). If they are not met, it tells you why."
              disabled={!d.activation || refundsActive.length > 0}
              reason={{ label: 'Note (optional)' }}
              run={({ reason }) => api.post(`/job-seekers/${d.id}/refund`, reason ? { reason } : {})}
              success="Refund approved — Finance pays it and records the UTR"
            />
          </div>
        }
      />

      <StatGrid>
        <StatTile
          label={g.daysLeft !== null ? `${g.days}-day guarantee · ${g.daysLeft} days left` : `${g.days}-day guarantee`}
          value={day !== null ? `Day ${Math.max(1, day)} of ${g.days}` : 'Not started'}
          tone={g.daysLeft !== null && g.daysLeft <= 5 ? 'orange' : 'cyan'}
        />
        <StatTile label="Hits" value={`${d.hits.count} of ${d.hits.max}`} tone={d.hits.count >= d.hits.max - 1 ? 'gold' : 'royal'} />
        <StatTile label="Offers made" value={d.offersMade} tone="royal" />
        <StatTile label="Interviews" value={d.interviews} tone="navy" />
        <StatTile
          label={d.activation ? `Paid ${formatDateIST(d.activation.at)}${d.activation.utr ? ` · UTR ${d.activation.utr.slice(0, 4)}…` : ''}` : 'Not paid yet'}
          value={d.activation ? formatINR(d.activation.amountPaise) : '—'}
          tone="good"
        />
        <StatTile label="Refunds" value={refundsActive.length} tone={refundsActive.length ? 'red' : 'royal'} />
      </StatGrid>

      <div className="two-col">
        <Card title="Profile">
          <Kv
            rows={[
              [
                'Phone',
                <>
                  {d.phone.includes('*') ? d.phone : formatMobile(d.phone.replace(/^\+91/, ''))} · <span className="ceo-sub">full number shown to the CEO; every view is logged</span>
                </>,
              ],
              ['Trade', d.profile.trades.map((t) => `${t.trade} · ${t.years} yr${t.years === 1 ? '' : 's'}`).join(' · ') || '—'],
              ['Area', `${d.profile.locality ?? '—'}${d.profile.travelDistanceKm ? ` · travels up to ${d.profile.travelDistanceKm} km` : ''}`],
              [
                'Expected salary',
                `${formatINR(d.profile.salaryMinPaise)} – ${formatINR(d.profile.salaryMaxPaise).replace('₹', '')} ${d.profile.salaryPeriod === 'daily' ? 'a day' : 'a month'}${g.floorPaise ? ` · guarantee floor ${formatINR(g.floorPaise)}` : ''}`,
              ],
              ['Shift / type', [humanize(d.profile.shiftPreference), humanize(d.profile.jobType)].join(' · ')],
              ['Speaks', d.profile.languages.join(', ') || '—'],
              ['Qualification', d.profile.qualification ? humanize(d.profile.qualification) : '—'],
              [
                'Referred by',
                d.profile.referredBy ? (
                  <Link to={to('C-Partner', { id: d.profile.referredBy.id })}>
                    {d.profile.referredBy.code} · {d.profile.referredBy.name}
                  </Link>
                ) : (
                  '—'
                ),
              ],
              ['Registered by', `${d.profile.registeredBy?.name ?? '—'} · ${formatDateIST(d.createdAt)}${d.profile.heardFrom ? ` · ${humanize(d.profile.heardFrom)}` : ''}`],
            ]}
          />
        </Card>
        <Card title="Registration">
          <Kv
            rows={[
              ['Phone verified', d.registration.phoneVerified ? <StatusPill tone="good">Verified by OTP</StatusPill> : <StatusPill tone="warn">Not yet</StatusPill>],
              [
                `Consent (${d.registration.consentsGranted} of ${d.registration.consentsAsked || d.registration.consentsGranted})`,
                d.registration.consentAt ? <StatusPill tone="good">{formatDateTimeIST(d.registration.consentAt)}</StatusPill> : <StatusPill tone="muted">Not given</StatusPill>,
              ],
              ['Selfie', d.registration.selfieAt ? <StatusPill tone="good">{formatDateTimeIST(d.registration.selfieAt)}</StatusPill> : <StatusPill tone="muted">Not taken</StatusPill>],
              [
                'ID check',
                d.registration.idCheck?.last4 !== undefined && !d.registration.idCheck?.status ? (
                  <StatusPill tone="good">
                    {ID_METHOD[d.registration.idCheck.method] ?? humanize(d.registration.idCheck.method)}
                    {d.registration.idCheck.last4 ? ` · last 4: ${d.registration.idCheck.last4}` : ''}
                    {d.registration.idCheck.adult ? ' · 18+' : ''}
                  </StatusPill>
                ) : d.registration.idCheck ? (
                  <StatusPill tone={d.registration.idCheck.status === 'failed' ? 'danger' : 'warn'}>
                    {humanize(d.registration.idCheck.status)}
                    {d.registration.idCheck.failureReason ? ` · ${humanize(d.registration.idCheck.failureReason)}` : ''}
                  </StatusPill>
                ) : (
                  <StatusPill tone="muted">Not started</StatusPill>
                ),
              ],
              [
                `${formatINR(d.activation?.amountPaise ?? 49900)} payment`,
                d.activation ? (
                  <StatusPill tone="good">
                    {formatDateIST(d.activation.at)} · {d.activation.confirmedBy === 'bank_feed' ? 'bank matched' : humanize(d.activation.confirmedBy)}
                  </StatusPill>
                ) : (
                  <StatusPill tone="muted">Not paid</StatusPill>
                ),
              ],
              ['Status', <StatusPill tone={SEEKER_STATUS[d.status]?.tone ?? 'muted'}>{statusLabel}</StatusPill>],
              ['Guarantee', guaranteePill(g.daysLeft)],
            ]}
          />
        </Card>
        <AadhaarCheckCard jobSeekerId={d.id} />
      </div>

      <div className="two-col">
        <Card title="Offers, interviews and hits" flush>
          <div className="scrollx">
            <table>
              <caption className="sr-only">Offers, interviews and hits</caption>
              <thead>
                <tr>
                  <th scope="col">Date</th>
                  <th scope="col">Business</th>
                  <th scope="col">What happened</th>
                  <th scope="col">Hit</th>
                </tr>
              </thead>
              <tbody>
                {d.activity.map((a, i) => (
                  <tr key={i}>
                    <td>{dateOrDash(a.at)}</td>
                    <td>{a.businessId ? <Link to={to('C-Business', { id: a.businessId })}>{a.business}</Link> : '—'}</td>
                    <td>
                      {a.what && a.businessId ? `${a.what} · ` : ''}
                      {ACTIVITY[a.status] ?? ACTIVITY[a.what] ?? humanize(a.status)}
                    </td>
                    <td>{a.hit ? <StatusPill tone="crit">Hit</StatusPill> : a.status === 'reversed' ? <StatusPill tone="muted">Reversed</StatusPill> : <StatusPill tone="muted">Not a hit</StatusPill>}</td>
                  </tr>
                ))}
                {d.activity.length === 0 && (
                  <tr>
                    <td colSpan={4} className="ceo-sub">
                      No offers, interviews or hits yet.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
          {d.placements.length > 0 && (
            <div className="ceo-note" style={{ padding: '8px 16px' }}>
              Placements:{' '}
              {d.placements.map((p) => (
                <Link key={p.id} to={to('C-Placement', { id: p.id })} style={{ marginRight: 10 }}>
                  {p.code} · {p.business}
                </Link>
              ))}
            </div>
          )}
        </Card>
        <Card title="History">
          <Timeline events={d.history.map((e) => ({ at: e.at, text: historyText(e), tone: e.kind === 'hit' ? 'var(--gold-raw)' : e.kind.startsWith('payment') ? 'var(--good)' : undefined }))} />
        </Card>
      </div>
    </div>
  );
}
