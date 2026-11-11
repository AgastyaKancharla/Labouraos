import type { ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ButtonLink } from '../../../components/Button';
import { Card } from '../../../components/Card';
import { EmptyState, ErrorState } from '../../../components/ErrorState';
import { SkeletonCard } from '../../../components/Skeleton';
import { StatGrid, StatTile } from '../../../components/StatTile';
import { StatusPill } from '../../../components/Badge';
import { TopBar } from '../../../components/TopBar';
import { api } from '../../../lib/api/client';
import { formatDateIST } from '../../../lib/format/date';
import { formatINR } from '../../../lib/format/money';
import { useScreenPath } from '../../../portals/PortalContext';
import { ActionButton } from '../_kit/actions';
import { humanize } from '../_kit/kit';

/**
 * Refund approvals — design C-Refunds.dc.html. Only refunds above Finance's
 * limit, outside the rules, or sent by Finance (guide: Finance approval
 * limits), each with the evidence and the software's check.
 * Approve → POST /payments/:id/approve; Reject → POST /payments/:id/reject-refund.
 */
interface Base {
  id: string;
  code: string;
  amountPaise: number;
  reason: string | null;
  outsideRules: boolean;
  note: string | null;
  sentAt: string;
  waitingDays: number;
  sentBy: { name: string; role: string } | null;
  recordId: string | null;
  check: { eligible: boolean; reason: string | null };
}
type Item =
  | (Base & {
      kind: 'business';
      subject: { code: string; name: string; businessId: string };
      evidence: { reportedWithinDeadline: boolean | null; feePaidInFull: boolean; replacementsOffered: number; replacementsRejected: number; searchDaysReached: boolean; searchDays: number; guaranteeEndedReason: string | null };
    })
  | (Base & {
      kind: 'job_seeker';
      subject: { code: string; name: string } | null;
      evidence: { offersMade: number; offersDeclined: number; hits: number; maxHits: number; forfeitingHitAt: string | null; forfeitingHitReason: string | null; guaranteeOver: boolean };
    });
interface Response {
  items: Item[];
  summary: { waitingCount: number; waitingPaise: number; businessCount: number; businessPaise: number; jobSeekerCount: number; jobSeekerPaise: number; financeWithinLimitsPaise: number; financeLimitPaise: number; oldestWaitingDays: number | null };
}

const WHY: Record<string, string> = {
  above_finance_limit: 'above Finance’s limit',
  goodwill: 'outside the rules (goodwill)',
  sent_by_finance: 'sent to you by Finance',
};

function yes(v: boolean | null, label?: string) {
  if (v === null) return <StatusPill tone="muted">Not recorded</StatusPill>;
  return <StatusPill tone={v ? 'good' : 'crit'}>{label ?? (v ? 'Yes' : 'No')}</StatusPill>;
}

function Evidence({ item, limit }: { item: Item; limit: number }) {
  const rows: [string, ReactNode][] =
    item.kind === 'business'
      ? [
          ['Reported within 7 days', yes(item.evidence.reportedWithinDeadline)],
          ['Fee fully paid', yes(item.evidence.feePaidInFull)],
          [
            'Suitable replacements offered',
            <StatusPill tone={item.evidence.replacementsOffered ? 'warn' : 'good'}>
              {item.evidence.replacementsOffered}
              {item.evidence.replacementsRejected ? ` · ${item.evidence.replacementsRejected} rejected` : ''}
            </StatusPill>,
          ],
          [`Day ${item.evidence.searchDays} reached`, yes(item.evidence.searchDaysReached)],
        ]
      : [
          ['Suitable offers made', <StatusPill tone={item.evidence.offersDeclined ? 'crit' : 'good'}>{`${item.evidence.offersMade}${item.evidence.offersDeclined ? ` · ${item.evidence.offersDeclined} declined` : ''}`}</StatusPill>],
          ['Hits', <StatusPill tone={item.evidence.hits ? 'warn' : 'good'}>{`${item.evidence.hits} of ${item.evidence.maxHits}`}</StatusPill>],
          ['30-day guarantee over', yes(item.evidence.guaranteeOver)],
        ];
  let check: string;
  let tone: string;
  if (item.check.eligible) {
    const offered = item.kind === 'business' && item.evidence.replacementsOffered > 0;
    check = offered
      ? 'eligible, but a replacement was offered — check the reason the owner gave.'
      : item.reason === 'above_finance_limit'
        ? `eligible for a full refund. It is here only because it is above ${formatINR(limit)}.`
        : item.outsideRules
          ? 'outside the rules — your call.'
          : 'eligible under the rules.';
    tone = offered ? 'var(--gold-raw)' : 'var(--good)';
  } else if (item.kind === 'business' && item.evidence.guaranteeEndedReason === 'two_rejections') {
    check = 'your decision: is the business rejecting suitable candidates?';
    tone = 'var(--orange-raw)';
  } else {
    const hit = item.kind === 'job_seeker' && item.evidence.forfeitingHitAt ? ` (hit recorded ${formatDateIST(item.evidence.forfeitingHitAt)})` : '';
    check = `not eligible — ${humanize(item.check.reason ?? 'rules not met').toLowerCase()}${hit}.`;
    tone = 'var(--red-raw)';
  }
  return (
    <>
      {rows.map(([k, v]) => (
        <div className="row" key={k} style={{ justifyContent: 'space-between' }}>
          <span>{k}</span>
          {v}
        </div>
      ))}
      <div className="rule" style={{ borderLeftColor: tone, marginTop: 12, fontSize: 12.5 }}>
        <strong>Software check:</strong> {check}
      </div>
    </>
  );
}

export default function RefundApprovals() {
  const to = useScreenPath();
  const query = useQuery({ queryKey: ['refunds-due', 'with-ceo'], queryFn: () => api.get<Response>('/ceo/refunds') });
  const s = query.data?.summary;
  const items = query.data?.items ?? [];
  const loading = query.isPending;
  return (
    <div className="lb-page">
      <TopBar
        back={{ to: to('Main'), label: 'Command Center' }}
        title="Refund approvals"
        subtitle="Refunds above Finance's limit or outside the rules, with the evidence and the software's check. Approve, reject with a reason, or open the record."
      />
      <StatGrid>
        <StatTile label={`Waiting for you · ${s ? formatINR(s.waitingPaise) : ''}`} value={s?.waitingCount ?? '—'} tone="orange" loading={loading} />
        <StatTile label={`Business · ${s ? formatINR(s.businessPaise) : ''}`} value={s?.businessCount ?? '—'} tone="royal" loading={loading} />
        <StatTile label={`Job seeker · ${s ? formatINR(s.jobSeekerPaise) : ''}`} value={s?.jobSeekerCount ?? '—'} tone="cyan" loading={loading} />
        <StatTile label="Finance paying within its limits" value={s ? formatINR(s.financeWithinLimitsPaise) : '—'} tone="good" loading={loading} to={to('C-Payments-Out')} />
      </StatGrid>
      {loading ? (
        <div className="two-col">
          <SkeletonCard height={240} />
          <SkeletonCard height={240} />
        </div>
      ) : query.isError ? (
        <ErrorState error={query.error} onRetry={() => void query.refetch()} />
      ) : items.length === 0 ? (
        <Card>
          <EmptyState title="Nothing is waiting for you.">Finance approves and pays refunds within its limits; anything above them or outside the rules lands here.</EmptyState>
        </Card>
      ) : (
        <div className="two-col">
          {items.map((item) => {
            const title =
              item.kind === 'business' ? `Business · ${item.subject.code} ${item.subject.name}` : `${item.subject?.name ?? 'Job seeker'} · ${item.subject?.code ?? ''}`;
            const sub = `${item.kind === 'business' ? 'Business' : 'Job seeker'} · ${WHY[item.reason ?? ''] ?? humanize(item.reason)}${item.sentBy ? ` · by ${item.sentBy.name}` : ''} · waiting ${item.waitingDays} day${item.waitingDays === 1 ? '' : 's'}${item.note ? ` · “${item.note}”` : ''}`;
            const open = item.kind === 'business' ? (item.recordId ? to('C-Placement', { id: item.recordId }) : null) : item.recordId ? to('C-JobSeeker', { id: item.recordId }) : null;
            return (
              <Card
                key={item.id}
                title={
                  <>
                    {title} · <span style={{ color: 'var(--critical)' }}>{formatINR(item.amountPaise)}</span>
                  </>
                }
              >
                <span className="ceo-sub">{sub}</span>
                <Evidence item={item} limit={s?.financeLimitPaise ?? 1500000} />
                <div className="ceo-actions" style={{ marginTop: 12 }}>
                  <ActionButton label="Approve" variant="success" title={`Approve ${formatINR(item.amountPaise)}`} description="Finance pays it within 7 days and records the UTR." run={() => api.post(`/payments/${item.id}/approve`)} success={`Refund ${item.code} approved`} />
                  <ActionButton label="Reject with reason" variant="danger" title="Reject the refund" reason run={({ reason }) => api.post(`/payments/${item.id}/reject-refund`, { reason })} success={`Refund ${item.code} rejected`} />
                  {open && <ButtonLink to={open}>Open record</ButtonLink>}
                </div>
              </Card>
            );
          })}
        </div>
      )}
      <div className="rule" style={{ borderLeftColor: 'var(--royal)', fontSize: 12.5 }}>
        Only these come to you: refunds above {formatINR(s?.financeLimitPaise ?? 1500000)}, refunds outside the rules, and cases Finance sends you. Finance approves and pays everything else within its limits, and you
        check it all in the month-end review. Finance always pays and records the UTR; refunds are paid within 7 days of approval.
      </div>
    </div>
  );
}
