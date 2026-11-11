import { useQuery } from '@tanstack/react-query';
import { Link, useParams } from 'react-router-dom';
import { Card } from '../../../components/Card';
import { ErrorState } from '../../../components/ErrorState';
import { SkeletonCard } from '../../../components/Skeleton';
import { StatusPill } from '../../../components/Badge';
import { TopBar } from '../../../components/TopBar';
import { api } from '../../../lib/api/client';
import { formatDateIST } from '../../../lib/format/date';
import { formatINR } from '../../../lib/format/money';
import { useScreenPath } from '../../../portals/PortalContext';
import { ActionButton } from '../_kit/actions';
import { Kv, Timeline, humanize } from '../_kit/kit';
import { PAYMENT_STATUS, PLACEMENT_STAGE } from '../_kit/labels';

/** CEO placement page — design C-Placement.dc.html. */
interface Pay {
  code: string;
  status: string;
  amountPaise: number;
}
interface Detail {
  id: string;
  code: string;
  status: string;
  stage: string;
  jobSeeker: { id: string; code: string; name: string };
  business: { id: string; code: string; name: string };
  vacancy: { id: string; code: string; tradeSkill: string; roleTitle: string | null };
  salaryPaise: number;
  feePaise: number;
  gstPaise: number;
  paidAt: string | null;
  invoiceCode: string | null;
  feePayment: Pay | null;
  joinedDate: string | null;
  joiningCallsAnswered: boolean;
  referral: { partner: { id: string; code: string; name: string }; payment: Pay | null } | null;
  joiningReward: Pay | null;
  guarantee: {
    windowDays: number;
    searchDays: number;
    day: number | null;
    endedReason: string | null;
    dropoutReportedAt: string | null;
    searchDaysLeft: number | null;
    maxReplacements: number;
    maxRejections: number;
    replacementsOffered: number;
    replacementsRejected: number;
  };
  claim: { code: string; reason: string; workerLeftOn: string; reportedAt: string; reportedWithinDeadline: boolean; feePaidInFull: boolean; decision: string | null; decidedBy: string | null; decisionReason: string | null } | null;
  refund: { id: string; code: string; status: string; amountPaise: number; withCeo: boolean; ceoApprovalReason: string | null } | null;
  chain: { id: string; code: string; number: number; status: string; name: string; joinedDate: string | null }[];
  replacementCandidates: { code: string; name: string; status: string; reason: string | null; at: string }[];
  timeline: { at: string; text: string; by: string | null; detail?: string | null }[];
}

const EVENT: Record<string, string> = {
  selected: 'Selected at interview (owner OTP)',
  fee_paid: 'Fee paid',
  joined: 'Joined',
  placement_check_in_day_7: 'Day-7 check-in',
  placement_check_in_day_30: 'Day-30 check-in',
  dropout_reported: 'Owner reported the worker left',
  claim_accepted: 'Replacement claim accepted',
  claim_rejected: 'Replacement claim rejected',
  replacement_offered: 'Replacement candidate sent',
  replacement_rejected: 'Replacement rejected by the business',
};

export default function PlacementDetail() {
  const { id = '' } = useParams();
  const to = useScreenPath();
  const query = useQuery({ queryKey: ['ceo', 'placement', id], queryFn: () => api.get<Detail>(`/ceo/placements/${id}`) });
  const d = query.data;
  const back = { to: to('C-Placements'), label: 'Placements' };
  if (query.isPending)
    return (
      <div className="lb-page">
        <TopBar back={back} title="Placement" />
        <SkeletonCard height={260} />
      </div>
    );
  if (query.isError || !d)
    return (
      <div className="lb-page">
        <TopBar back={back} title="Placement" />
        <ErrorState error={query.error} onRetry={() => void query.refetch()} />
      </div>
    );

  const g = d.guarantee;
  const paused = g.endedReason === 'two_rejections';
  const subtitle = paused
    ? 'Guarantee paused: the business rejected replacement candidates. You decide.'
    : d.refund?.withCeo
      ? `A ${formatINR(d.refund.amountPaise)} refund is waiting for your approval.`
      : d.stage === 'replacement'
        ? `Replacement search · ${g.searchDaysLeft !== null && g.searchDaysLeft >= 0 ? `${g.searchDaysLeft} days left before the refund falls due` : 'refund due'}`
        : `${PLACEMENT_STAGE[d.stage]?.label ?? humanize(d.stage)}${g.day ? ` · day ${Math.min(g.day, g.windowDays)} of ${g.windowDays}` : ''}`;
  const refundAmount = d.refund?.amountPaise ?? d.feePaise;
  const canApproveByRules = !d.refund && d.stage === 'replacement';
  const payPill = (p: Pay | null) => (p ? <StatusPill tone={PAYMENT_STATUS[p.status]?.tone ?? 'muted'}>{`${formatINR(p.amountPaise)} · ${PAYMENT_STATUS[p.status]?.label ?? p.status}`}</StatusPill> : '—');

  return (
    <div className="lb-page">
      <TopBar
        back={back}
        title={`${d.code} · ${d.jobSeeker.name} at ${d.business.name}`}
        subtitle={subtitle}
        actions={
          <div className="ceo-actions">
            {d.refund?.withCeo && (
              <>
                <ActionButton
                  label={`Approve refund ${formatINR(refundAmount)}`}
                  variant="danger"
                  title={`Approve the ${formatINR(refundAmount)} refund`}
                  description="Finance then pays it within 7 days and records the UTR."
                  run={() => api.post(`/payments/${d.refund?.id}/approve`)}
                  success="Refund approved — Finance pays it"
                />
                <ActionButton
                  label="Refuse — keep searching"
                  variant="primary"
                  title="Refuse the refund"
                  description="The refund is turned down with your reason; the team keeps looking for a replacement."
                  reason
                  run={({ reason }) => api.post(`/payments/${d.refund?.id}/reject-refund`, { reason })}
                  success="Refund refused — the replacement search continues"
                />
              </>
            )}
            {canApproveByRules && (
              <ActionButton
                label={`Approve refund ${formatINR(d.feePaise)}`}
                variant="danger"
                title="Approve the business refund"
                description={`The software checks the rules first: no replacement within ${g.searchDays} days of the dropout report. If they are not met it tells you why.`}
                reason={{ label: 'Note (optional)' }}
                run={({ reason }) => api.post(`/placements/${d.id}/refund`, reason ? { reason } : {})}
                success="Refund approved"
              />
            )}
          </div>
        }
      />
      <div className="two-col">
        <Card title="Placement">
          <Kv
            rows={[
              ['Candidate', <Link to={to('C-JobSeeker', { id: d.jobSeeker.id })}>{`${d.jobSeeker.name} · ${d.jobSeeker.code}`}</Link>],
              ['Business', <Link to={to('C-Business', { id: d.business.id })}>{`${d.business.name} · ${d.business.code}`}</Link>],
              ['Role / salary', `${d.vacancy.roleTitle ?? d.vacancy.tradeSkill} · ${formatINR(d.salaryPaise)}`],
              ['Fee', `${formatINR(d.feePaise)} + GST ${formatINR(d.gstPaise)} = ${formatINR(d.feePaise + d.gstPaise)}${d.paidAt ? ` · paid ${formatDateIST(d.paidAt)}` : ' · not paid yet'}${d.invoiceCode ? ` · invoice ${d.invoiceCode}` : ''}`],
              ['Joined', d.joinedDate ? `${formatDateIST(d.joinedDate)}${d.joiningCallsAnswered ? ' (calls to both answered)' : ''}` : 'Not yet'],
              ['Referral payout', d.referral ? <>{`${d.referral.partner.code} · `}{payPill(d.referral.payment)}</> : 'No referral partner'],
              ['Joining reward', payPill(d.joiningReward)],
            ]}
          />
        </Card>
        <Card title="Guarantee">
          <Kv
            rows={[
              ['Day', g.day ? `Day ${Math.min(g.day, g.windowDays)} of ${g.windowDays}` : 'Starts on joining'],
              ['Left on', d.claim ? `${formatDateIST(d.claim.workerLeftOn)} · ${d.claim.reportedWithinDeadline ? 'reported within 7 days' : 'reported late'} · ${humanize(d.claim.reason)}` : '—'],
              ['Claim decision', d.claim ? (d.claim.decision ? `${humanize(d.claim.decision)}${d.claim.decidedBy ? ` by ${d.claim.decidedBy}` : ''}${d.claim.decisionReason ? ` · ${d.claim.decisionReason}` : ''}` : 'Waiting (48 h)') : '—'],
              ['Replacements offered', `${g.replacementsOffered}${g.replacementsRejected ? ` · ${g.replacementsRejected} rejected by the business` : ''} (up to ${g.maxReplacements} free)`],
              [
                'Clock',
                paused ? (
                  <StatusPill tone="crit">Paused · {g.maxRejections} rejections</StatusPill>
                ) : g.endedReason ? (
                  <StatusPill tone="muted">Ended · {humanize(g.endedReason)}</StatusPill>
                ) : g.searchDaysLeft !== null ? (
                  <StatusPill tone={g.searchDaysLeft <= 3 ? 'crit' : 'warn'}>{g.searchDaysLeft >= 0 ? `Search day ${g.searchDays - g.searchDaysLeft} of ${g.searchDays}` : 'Refund due'}</StatusPill>
                ) : (
                  <StatusPill tone="good">Running</StatusPill>
                ),
              ],
              ['Refund', d.refund ? <StatusPill tone={PAYMENT_STATUS[d.refund.status]?.tone ?? 'muted'}>{`${d.refund.code} · ${formatINR(d.refund.amountPaise)} · ${d.refund.withCeo ? 'waiting for you' : (PAYMENT_STATUS[d.refund.status]?.label ?? d.refund.status)}`}</StatusPill> : 'None'],
              ...(paused ? ([['Decision needed', `Is the business rejecting suitable candidates? If yes → no refund; if no → refund ${formatINR(refundAmount)}`]] as [string, string][]) : []),
            ]}
          />
          {d.chain.length > 1 && (
            <div className="ceo-note">
              Same guarantee:{' '}
              {d.chain.map((c) => (
                <Link key={c.id} to={to('C-Placement', { id: c.id })} style={{ marginRight: 10 }}>
                  {c.code} · {c.name}
                </Link>
              ))}
            </div>
          )}
        </Card>
      </div>
      <Card title="Timeline">
        <Timeline
          events={d.timeline.map((e) => ({
            at: e.at,
            text: `${EVENT[e.text] ?? humanize(e.text.replace(/^status_/, 'Status → ').replace(/^refund_/, 'Refund '))}${e.detail ? ` · ${humanize(e.detail)}` : ''}${e.by ? ` · ${e.by}` : ''}`,
          }))}
        />
      </Card>
    </div>
  );
}
