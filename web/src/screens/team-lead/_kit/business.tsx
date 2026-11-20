import { useState, type ReactNode } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { Button } from '../../../components/Button';
import { Card } from '../../../components/Card';
import { ErrorState } from '../../../components/ErrorState';
import { PeriodPicker } from '../../../components/PeriodPicker';
import { Skeleton } from '../../../components/Skeleton';
import { StatusPill } from '../../../components/Badge';
import { useToast } from '../../../components/Toast';
import { api } from '../../../lib/api/client';
import { ApiError } from '../../../lib/api/errors';
import { periodFor, periodRangeLabel, periodToUtcRange, type Period } from '../../../lib/period';
import { useNow } from '../../../lib/useNow';
import { useScreenPath } from '../../../portals/PortalContext';
import '../../ceo/_kit/ceo.css';

/** GET /team-lead/pipeline: the team's numbers for a period, counts only (rev 194). */
export interface TeamPipeline {
  jobSeekers: { registered: number; stuckBeforePaying: number; paid: number; notPaid: number; interviewed: number; offered: number; accepted: number; joined: number };
  businesses: { fieldVisits: number; signedUp: number; vacanciesAdded: number; openings: number; filled: number; droppedOut: number };
  referralPartners: { registered: number; introduced: number; introducedPaid: number; partnersPaid: number; partnersNotPaid: number };
}

/** One number that opens the matching list ("My team"), filtered where that list can be. */
function Stage({ to, label, value, foot, loading }: { to: string; label: string; value: number | undefined; foot: ReactNode; loading: boolean }) {
  return (
    <Link to={to} className="stage ceo-stage-link" aria-busy={loading || undefined} aria-label={`${label}: ${value ?? '…'}`}>
      <span className="ceo-stage-label">{label}</span>
      {loading ? <Skeleton width="50%" height={26} /> : <span className="num-l">{value ?? 0}</span>}
      <span className="ceo-stage-foot">{foot}</span>
    </Link>
  );
}

/**
 * T-Home "How the business is doing": job seekers, businesses and referral
 * partners of the team (the Team Lead and his agents) for the period picked —
 * counts only, never rupees. Each number opens the Team Lead's list.
 */
export function BusinessNumbers() {
  const to = useScreenPath();
  const now = useNow(60_000);
  const [period, setPeriod] = useState<Period>(() => periodFor('month', now));
  const query = useQuery({
    queryKey: ['team-lead', 'pipeline', period.from, period.to],
    queryFn: () => api.get<TeamPipeline>('/team-lead/pipeline', { query: periodToUtcRange(period) }),
  });
  const p = query.data;
  const loading = query.isPending;
  // Every list opens for the same period the number counted (?from&to, IST days).
  const list = (screen: string, params?: Record<string, string>) => {
    const qs = new URLSearchParams({ ...params, from: period.from, to: period.to }).toString();
    return `${to(screen)}${qs ? `?${qs}` : ''}`;
  };
  return (
    <Card icon="pipeline" tone="royal" title={`How the business is doing · ${periodRangeLabel(period)}`} aside={<PeriodPicker value={period} onChange={setPeriod} showLabel={false} />}>
      {query.isError ? (
        <ErrorState error={query.error} onRetry={() => void query.refetch()} compact />
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }} data-testid="tl-business">
          <div className="eyebrow">Job seekers</div>
          <div className="ceo-stages">
            <Stage to={list('JobSeekers')} label="Registered" value={p?.jobSeekers.registered} foot="OTP-verified" loading={loading} />
            <Stage to={list('JobSeekers', { status: 'not_paid' })} label="Stuck before paying" value={p?.jobSeekers.stuckBeforePaying} foot="link not finished · call them" loading={loading} />
            <Stage to={list('JobSeekers', { dateField: 'paid' })} label="Paid" value={p?.jobSeekers.paid} foot="paid the registration fee" loading={loading} />
            <Stage to={list('JobSeekers', { status: 'not_paid' })} label="Not paid" value={p?.jobSeekers.notPaid} foot="registered, no payment yet" loading={loading} />
            <Stage to={list('C-Interviews')} label="Interviewed" value={p?.jobSeekers.interviewed} foot="went to an interview" loading={loading} />
            <Stage to={list('C-Interviews')} label="Offered a job" value={p?.jobSeekers.offered} foot="with an offer" loading={loading} />
            <Stage to={list('C-Placements')} label="Accepted" value={p?.jobSeekers.accepted} foot="accepted the offer" loading={loading} />
            <Stage to={list('C-Placements')} label="Joined" value={p?.jobSeekers.joined} foot="started work" loading={loading} />
          </div>
          <div className="eyebrow">Businesses</div>
          <div className="ceo-stages">
            <Stage to={to('T-Visits')} label="Field visits" value={p?.businesses.fieldVisits} foot="photo + selfie + GPS" loading={loading} />
            <Stage to={list('C-Businesses')} label="Signed up" value={p?.businesses.signedUp} foot="agreement signed" loading={loading} />
            <Stage to={list('C-Vacancies')} label="Vacancies added" value={p?.businesses.vacanciesAdded} foot={`${p?.businesses.openings ?? 0} openings`} loading={loading} />
            <Stage to={list('C-Placements')} label="Filled" value={p?.businesses.filled} foot="openings filled" loading={loading} />
            <Stage to={list('C-Placements')} label="Dropped out" value={p?.businesses.droppedOut} foot="workers who left" loading={loading} />
          </div>
          <div className="eyebrow">Referral partners</div>
          <div className="ceo-stages">
            <Stage to={list('C-Referrals')} label="Registered" value={p?.referralPartners.registered} foot="new partners" loading={loading} />
            <Stage to={list('C-Referrals')} label="People introduced" value={p?.referralPartners.introduced} foot="job seekers they referred" loading={loading} />
            <Stage to={list('C-Referrals')} label="Introduced and paid" value={p?.referralPartners.introducedPaid} foot="referred people who paid" loading={loading} />
            <Stage to={list('C-Referrals')} label="Partners rewarded" value={p?.referralPartners.partnersPaid} foot="reward paid in the period" loading={loading} />
            <Stage to={list('C-Referrals')} label="Reward not paid yet" value={p?.referralPartners.partnersNotPaid} foot="right now · due or failed" loading={loading} />
          </div>
        </div>
      )}
    </Card>
  );
}

interface NearRow {
  kind: 'job_seeker' | 'business';
  id: string;
  code: string;
  name: string | null;
  trade: string | null;
  daysLeft: number;
  bucket: string;
  businessName: string | null;
  agent: { id: string; name: string } | null;
}
interface NearResponse {
  windowDays: number;
  total: number;
  jobSeekers: number;
  businesses: number;
  buckets: { bucket: string; count: number }[];
  rows: NearRow[];
}

function RemindAgent({ row }: { row: NearRow }) {
  const toast = useToast();
  const remind = useMutation({
    mutationFn: () =>
      api.post('/team-lead/remind', {
        staffId: row.agent!.id,
        ...(row.kind === 'job_seeker' ? { jobSeekerId: row.id } : { text: `Close to a refund: ${row.businessName ?? row.name ?? row.code} needs a replacement — ${row.daysLeft} days left` }),
      }),
    onSuccess: () => toast.success(`Reminded ${row.agent!.name}`),
    onError: (e) => toast.error(e instanceof ApiError ? e.message : 'Could not send the reminder'),
  });
  return (
    <Button size="compact" onClick={() => remind.mutate()} loading={remind.isPending}>
      Remind the agent
    </Button>
  );
}

/**
 * T-Home "Close to a refund": the team's job seekers and businesses whose
 * guarantee ends soon (the shared close-to-refund list, as on MG-Pipeline) —
 * names, days left and counts; never a rupee figure. "Remind the agent" sends
 * the Team Lead's usual reminder; nothing to remind when he holds it himself.
 */
export function CloseToRefund({ selfId }: { selfId?: string }) {
  const to = useScreenPath();
  const query = useQuery({ queryKey: ['team-lead', 'close-to-refund'], queryFn: () => api.get<NearResponse>('/team-lead/close-to-refund') });
  const d = query.data;
  return (
    <Card icon="refunds" tone="orange" title={`Close to a refund · next ${d?.windowDays ?? 15} days`} aside={d ? <span className="tl-sub">{d.jobSeekers} job seekers · {d.businesses} businesses</span> : undefined}>
      {query.isError ? (
        <ErrorState error={query.error} onRetry={() => void query.refetch()} compact />
      ) : !d ? (
        <Skeleton height={60} />
      ) : (
        <>
          <div className="tl-pills" style={{ marginBottom: 10 }}>
            {d.buckets.map((b) => (
              <StatusPill key={b.bucket} tone={b.bucket === '0-5' ? 'danger' : b.bucket === '6-10' ? 'warn' : 'muted'}>
                {b.bucket} days · {b.count}
              </StatusPill>
            ))}
          </div>
          <div className="scrollx">
            <table>
              <caption className="sr-only">Your team's job seekers and businesses close to a refund</caption>
              <thead>
                <tr>
                  <th>Who</th>
                  <th>Trade</th>
                  <th>Days left</th>
                  <th>Agent</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {d.rows.slice(0, 10).map((r) => (
                  <tr key={`${r.kind}-${r.id}`}>
                    <td>
                      {r.kind === 'job_seeker' ? <Link to={to('C-JobSeeker', { id: r.id })}>{`${r.code} · ${r.name ?? ''}`}</Link> : `${r.businessName ?? r.name ?? r.code} · replacement`}
                    </td>
                    <td>{r.trade ?? '—'}</td>
                    <td>{r.daysLeft === 1 ? '1 day' : `${r.daysLeft} days`}</td>
                    <td>{r.agent?.name ?? '—'}</td>
                    <td>{r.agent && r.agent.id !== selfId ? <RemindAgent row={r} /> : null}</td>
                  </tr>
                ))}
                {d.rows.length === 0 && (
                  <tr>
                    <td colSpan={5} className="tl-sub">
                      Nobody in your team is close to a refund.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </>
      )}
    </Card>
  );
}
