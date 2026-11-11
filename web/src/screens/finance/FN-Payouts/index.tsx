import { useMemo, useState } from 'react';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useSearchParams } from 'react-router-dom';
import { Button } from '../../../components/Button';
import { Card } from '../../../components/Card';
import { DataTable, useTableDownload, type Column } from '../../../components/DataTable';
import { StatusPill } from '../../../components/Badge';
import { Modal } from '../../../components/Modal';
import { StatGrid, StatTile } from '../../../components/StatTile';
import { TextField } from '../../../components/fields';
import { useToast } from '../../../components/Toast';
import { TopBar } from '../../../components/TopBar';
import { api } from '../../../lib/api/client';
import { ApiError } from '../../../lib/api/errors';
import { formatDateTimeIST } from '../../../lib/format/date';
import { formatINR } from '../../../lib/format/money';
import { useScreenPath } from '../../../portals/PortalContext';
import { FilterPanel, SearchField, SelectFilter, useDebounced } from '../../ceo/_kit/kit';
import { FormAction, Note } from '../_kit/kit';
import '../_kit/fin.css';

/**
 * Payouts — design FN-Payouts.dc.html (decided 9 Nov night: paid daily, once
 * due and after any 48-hour wait). Referral payouts, joining rewards and the
 * refunds Finance may pay, with "Pay and record" (UTR + the name the UPI app
 * showed), "Pay all ready", failed → retry.
 */
export interface PayoutRow {
  id: string;
  code: string;
  type: 'referral_payout' | 'joining_reward' | 'refund' | 'duplicate_refund';
  to: { kind: string; code: string | null; name: string | null };
  owner: { ownerType: string; ownerId: string };
  placement: { id: string; code: string; workerName: string | null } | null;
  amountPaise: number;
  status: string;
  state: 'ready' | 'waiting_48h' | 'no_details' | 'flagged' | 'with_ceo' | 'failed' | 'processing';
  payableAt: string | null;
  ceoReason: string | null;
  account: { method: string; masked: string; status: string; verifiedName: string | null; nameMatches: boolean | null } | null;
  failureReason: string | null;
  tds: { paidThisYearPaise: number; afterPaise: number; limitPaise: number; alreadyOver: boolean } | null;
  createdAt: string;
}
interface Response {
  rows: PayoutRow[];
  summary: {
    referralDuePaise: number;
    referralDueCount: number;
    rewardDuePaise: number;
    rewardDueCount: number;
    refundsDuePaise: number;
    refundsDueCount: number;
    failedCount: number;
    tdsCount: number;
    readyCount: number;
    readyPaise: number;
    tdsLimitPaise: number;
    businessRefundLimitPaise: number;
    financialYear: string;
  };
}

const WHO_LABEL: Record<string, string> = { referral: 'Referral partner', job_seeker: 'Job seeker', business: 'Business' };

function forText(r: PayoutRow): string {
  if (r.type === 'referral_payout') return `Referral${r.placement?.workerName ? ` · ${r.placement.workerName} joined` : ' · joined'}`;
  if (r.type === 'joining_reward') return 'Joining reward · 30 days worked';
  if (r.type === 'duplicate_refund') return 'Paid twice · refund the extra';
  return r.to.kind === 'business' ? `Business refund${r.placement ? ` · ${r.placement.code}` : ''}` : '₹499 refund · 30-day guarantee';
}

function statusOf(r: PayoutRow): { tone: 'good' | 'warn' | 'crit' | 'info' | 'muted'; text: string } {
  if (r.tds && r.state === 'ready') return { tone: 'warn', text: 'TDS limit crossed with this one' };
  switch (r.state) {
    case 'ready':
      return { tone: 'good', text: 'Ready · pay today' };
    case 'waiting_48h':
      return { tone: 'warn', text: 'Details changed · waiting 48 h' };
    case 'no_details':
      return { tone: 'warn', text: 'No payout details yet' };
    case 'flagged':
      return { tone: 'crit', text: 'Details flagged' };
    case 'with_ceo':
      return { tone: 'info', text: 'With the CEO' };
    case 'failed':
      return { tone: 'crit', text: `Failed${r.failureReason ? ` · ${r.failureReason}` : ''}` };
    default:
      return { tone: 'muted', text: 'With the bank' };
  }
}

function details(r: PayoutRow): string {
  if (r.state === 'waiting_48h' && r.payableAt) return `Payable ${formatDateTimeIST(r.payableAt)}`;
  if (r.tds) return `${formatINR(r.tds.paidThisYearPaise)} this year → over ${formatINR(r.tds.limitPaise)}`;
  if (r.state === 'failed' || r.state === 'no_details') return 'Ask for new details';
  if (!r.account) return '—';
  return `${r.account.method === 'upi' ? 'UPI' : 'Bank'} ${r.account.masked}${r.account.status === 'verified' ? ' (verified)' : ''}`;
}

const payFields = (r: PayoutRow) => [
  { name: 'receiverNameShown', kind: 'text' as const, label: 'Name the UPI app showed', required: true, hint: 'Check it matches before sending', initial: r.account?.verifiedName ?? '' },
  { name: 'utr', kind: 'text' as const, label: 'UTR from the bank or UPI app', required: true, placeholder: '12-digit UTR', inputMode: 'numeric' as const },
];

function RowActions({ r }: { r: PayoutRow }) {
  const sendLink = (
    <FormAction
      label="Send details link"
      size="compact"
      title="Send the payout details link"
      description={`${r.to.name ?? 'They'} get an SMS link to give a UPI ID or bank account. New details wait 48 hours before money can go.`}
      run={() => api.post('/payout-accounts/links', { ownerType: r.owner.ownerType, ownerId: r.owner.ownerId })}
      success="Details link sent"
    />
  );
  if (r.state === 'ready') {
    return (
      <span className="fin-row-actions">
        <FormAction
          label={r.tds ? 'Pay and record (TDS limit)' : 'Pay and record'}
          variant="success"
          size="compact"
          title={`Pay ${formatINR(r.amountPaise)} to ${r.to.name ?? r.to.code ?? ''}`}
          description={
            <>
              Send {formatINR(r.amountPaise)} from the company UPI app to {r.account ? `${r.account.masked}` : 'their account'}, then record the UTR here.
              {r.tds && (
                <p className="fin-less" style={{ marginBottom: 0 }}>
                  This payout takes them past {formatINR(r.tds.limitPaise)} this year. TDS on referral payouts is still to be confirmed with the CA — check before paying.
                </p>
              )}
            </>
          }
          confirmLabel="Record payment"
          fields={payFields(r)}
          run={(v) => api.post(`/finance/payouts/${r.id}/pay`, { utr: v.utr, receiverNameShown: v.receiverNameShown })}
          success={`${r.code} paid and recorded`}
        />
        <FormAction
          label="It failed"
          size="compact"
          title="The bank refused this payout"
          fields={[{ name: 'reason', kind: 'text', label: 'What the bank said', required: true, placeholder: 'Account closed, name mismatch…' }]}
          run={(v) => api.post(`/finance/payouts/${r.id}/failed`, { reason: v.reason })}
          success="Recorded as failed"
          disabled={r.status !== 'approved'}
        />
      </span>
    );
  }
  if (r.state === 'failed') {
    return (
      <span className="fin-row-actions">
        {sendLink}
        <FormAction label="Retry" size="compact" title="Retry this payout" description="It goes back to ready. The payout details (and any 48-hour wait) are checked again when you pay." run={() => api.post(`/finance/payouts/${r.id}/retry`)} success="Back to ready" />
      </span>
    );
  }
  if (r.state === 'no_details') return <span className="fin-row-actions">{sendLink}</span>;
  return <span className="fin-sub">—</span>;
}

function PayAll({ rows }: { rows: PayoutRow[] }) {
  const ready = rows.filter((r) => r.state === 'ready');
  const total = ready.reduce((s, r) => s + r.amountPaise, 0);
  const [open, setOpen] = useState(false);
  const [entries, setEntries] = useState<Record<string, { utr: string; name: string }>>({});
  const toast = useToast();
  const queryClient = useQueryClient();
  const mutation = useMutation({
    mutationFn: () =>
      api.post<{ paid: number; failed: number; results: { id: string; ok: boolean; message?: string }[] }>('/finance/payouts/pay-all', {
        items: ready.filter((r) => entries[r.id]?.utr.trim()).map((r) => ({ id: r.id, utr: entries[r.id].utr.trim(), receiverNameShown: entries[r.id].name.trim() })),
      }),
    onSuccess: (res) => {
      if (res.failed) toast.error(`${res.paid} paid · ${res.failed} not recorded: ${res.results.filter((x) => !x.ok).map((x) => x.message).join('; ')}`);
      else toast.success(`${res.paid} payout${res.paid === 1 ? '' : 's'} paid and recorded`);
      setOpen(false);
      setEntries({});
      void queryClient.invalidateQueries();
    },
    onError: (e) => toast.error(e instanceof ApiError ? e.message : 'Something went wrong. Try again.'),
  });
  const filled = ready.filter((r) => entries[r.id]?.utr.trim() && entries[r.id]?.name.trim()).length;
  const set = (id: string, key: 'utr' | 'name', v: string) => setEntries((old) => ({ ...old, [id]: { utr: old[id]?.utr ?? '', name: old[id]?.name ?? ready.find((r) => r.id === id)?.account?.verifiedName ?? '', [key]: v } }));
  return (
    <>
      <Button variant="primary" onClick={() => setOpen(true)} disabled={!ready.length}>
        Pay all ready ({formatINR(total)})
      </Button>
      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title={`Pay ${ready.length} ready payout${ready.length === 1 ? '' : 's'}`}
        width={640}
        dismissible={!mutation.isPending}
        footer={
          <>
            <Button onClick={() => setOpen(false)} disabled={mutation.isPending}>
              Cancel
            </Button>
            <Button variant="success" onClick={() => mutation.mutate()} loading={mutation.isPending} disabled={!filled}>
              Record {filled} payment{filled === 1 ? '' : 's'}
            </Button>
          </>
        }
      >
        <p style={{ marginTop: 0, fontSize: 13.5 }}>Send each one from the company UPI app, then type its UTR and the name the app showed. Rows left empty stay ready.</p>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          {ready.map((r) => (
            <div key={r.id} style={{ borderTop: '1px solid var(--line)', paddingTop: 10 }}>
              <div className="fin-strong">
                {r.to.name} · {r.to.code} · {formatINR(r.amountPaise)}
              </div>
              <div className="fin-form">
                <TextField label="Name the UPI app showed" value={entries[r.id]?.name ?? r.account?.verifiedName ?? ''} onChange={(v) => set(r.id, 'name', v)} />
                <TextField label="UTR" inputMode="numeric" value={entries[r.id]?.utr ?? ''} onChange={(v) => set(r.id, 'utr', v)} />
              </div>
            </div>
          ))}
        </div>
      </Modal>
    </>
  );
}

export default function Payouts() {
  const to = useScreenPath();
  const [params] = useSearchParams();
  const [status, setStatus] = useState(params.get('status') ?? '');
  const [who, setWho] = useState(params.get('who') ?? '');
  const [search, setSearch] = useState('');
  const q = useDebounced(search);
  const query = useQuery({
    queryKey: ['finance', 'payouts', status, who, q],
    queryFn: () => api.get<Response>('/finance/payouts', { query: { status, who, search: q } }),
    placeholderData: keepPreviousData,
  });
  const s = query.data?.summary;
  const rows = query.data?.rows ?? [];
  const loading = query.isPending;
  const columns = useMemo<Column<PayoutRow>[]>(
    () => [
      {
        key: 'to',
        header: 'To',
        cell: (r) => (
          <>
            <span className="fin-strong">
              {r.to.name ?? '—'} · {r.type === 'joining_reward' && r.placement ? r.placement.code : r.to.code}
            </span>
            <span className="fin-sub">{WHO_LABEL[r.to.kind] ?? r.to.kind}</span>
          </>
        ),
        csv: (r) => `${r.to.name ?? ''} ${r.to.code ?? ''}`,
        sortValue: (r) => r.to.name ?? '',
      },
      { key: 'for', header: 'For', cell: forText, csv: forText, hideOnPhone: true },
      { key: 'amount', header: 'Amount', cell: (r) => formatINR(r.amountPaise), csv: (r) => r.amountPaise / 100, sortValue: (r) => r.amountPaise },
      {
        key: 'status',
        header: 'Status',
        cell: (r) => {
          const st = statusOf(r);
          return <StatusPill tone={st.tone}>{st.text}</StatusPill>;
        },
        csv: (r) => statusOf(r).text,
      },
      {
        key: 'details',
        header: 'Details',
        cell: (r) => (
          <>
            <span className="fin-sub" style={{ color: 'var(--text-soft)' }}>
              {details(r)}
            </span>
            <RowActions r={r} />
          </>
        ),
        csv: details,
      },
    ],
    [],
  );
  const dl = useTableDownload(columns, 'payouts');
  return (
    <div className="lb-page">
      <TopBar back={{ to: to('FN-Home'), label: 'Money today' }} title="Payouts" subtitle="Referral payouts and joining rewards, with the bank result for each." showSearch={false} />
      <StatGrid>
        <StatTile label={`Referral payouts due · ${s?.referralDueCount ?? 0}`} value={s ? formatINR(s.referralDuePaise) : '—'} tone="gold" loading={loading} />
        <StatTile label={`Joining rewards due · ${s?.rewardDueCount ?? 0}`} value={s ? formatINR(s.rewardDuePaise) : '—'} tone="cyan" loading={loading} />
        <StatTile label="Failed at the bank" value={s?.failedCount ?? '—'} tone="red" loading={loading} />
        <StatTile label="Crosses the TDS limit" value={s?.tdsCount ?? '—'} tone="orange" loading={loading} />
      </StatGrid>
      {s && s.refundsDueCount > 0 && (
        <div className="rule" style={{ borderLeftColor: 'var(--royal)', fontSize: 12.5 }}>
          Also here: {s.refundsDueCount} refund{s.refundsDueCount === 1 ? '' : 's'} you can pay ({formatINR(s.refundsDuePaise)}) — ₹499 job seeker refunds, business refunds up to {formatINR(s.businessRefundLimitPaise)}, and refunds the CEO approved.
        </div>
      )}
      <FilterPanel>
        <SelectFilter
          label="Status"
          value={status}
          onChange={setStatus}
          options={[
            { value: '', label: 'All' },
            { value: 'ready', label: 'Ready' },
            { value: 'failed', label: 'Failed' },
            { value: 'waiting_48h', label: 'Waiting 48 h' },
            { value: 'waiting', label: 'Waiting (details, CEO)' },
            { value: 'tds', label: 'TDS' },
          ]}
        />
        <SelectFilter
          label="Who"
          value={who}
          onChange={setWho}
          options={[
            { value: '', label: 'Everyone' },
            { value: 'referral', label: 'Referral partners' },
            { value: 'job_seeker', label: 'Job seekers' },
            { value: 'business', label: 'Businesses' },
            { value: 'refunds', label: 'Refunds only' },
          ]}
        />
        <SearchField value={search} onChange={setSearch} placeholder="Name or code" />
      </FilterPanel>
      <Card flush>
        <DataTable
          columns={columns}
          rows={rows}
          rowKey={(r) => r.id}
          caption="Payouts"
          loading={loading}
          error={query.error}
          onRetry={() => void query.refetch()}
          pageSize={50}
          emptyTitle="No rows match these filters. Change a filter to see more."
        />
      </Card>
      <Note>
        Payouts are paid every day as soon as they are due, with the UTR recorded · referral payouts are commission: each partner's yearly total is tracked and you are warned once it crosses {s ? formatINR(s.tdsLimitPaise) : 'the TDS limit'} (2% TDS — to confirm with a CA) · changed payout details wait 48 hours before money can go
      </Note>
      <div className="fin-foot">
        <PayAll rows={rows} />
        {dl.allowed && (
          <Button onClick={() => dl.download(rows)} disabled={!rows.length}>
            Download (Excel)
          </Button>
        )}
      </div>
    </div>
  );
}
