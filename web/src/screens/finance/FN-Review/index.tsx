import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link, useSearchParams } from 'react-router-dom';
import { useAuth } from '../../../auth/AuthProvider';
import { Card } from '../../../components/Card';
import { DataTable, type Column } from '../../../components/DataTable';
import { ErrorState } from '../../../components/ErrorState';
import { StatusPill } from '../../../components/Badge';
import { StatGrid, StatTile } from '../../../components/StatTile';
import { Tabs } from '../../../components/Tabs';
import { TopBar } from '../../../components/TopBar';
import { api } from '../../../lib/api/client';
import { formatDateIST } from '../../../lib/format/date';
import { formatINR } from '../../../lib/format/money';
import { useNow } from '../../../lib/useNow';
import { usePortal, useScreenPath } from '../../../portals/PortalContext';
import { FilterPanel, SearchField, SelectFilter } from '../../ceo/_kit/kit';
import { FormAction, Note } from '../_kit/kit';
import { ServerDownload } from '../_kit/download';
import { addMonths, istMonthKey, monthName } from '../_kit/payroll';
import '../_kit/fin.css';

/**
 * Month-end review — design FN-Review.dc.html, also the CEO's "Month-end
 * review". Everything Finance did in the month for the CEO to check: the
 * checklist (bank days closed, credits matched, payouts done, salaries
 * released, expenses with bills), every money action with who did it and the
 * proof, and the CEO's "Looks right" / "Flag". Only the CEO closes the month
 * (after which its money records can't be changed) and reopens it, with a
 * reason; both are recorded.
 */

interface ChecklistItem {
  key: string;
  label: string;
  ok: boolean;
  detail: string;
  count: number;
  link: string;
}
interface Action {
  id: string;
  subjectType: string;
  subjectId: string;
  at: string;
  doneBy: { id: string | null; name: string | null; role: string | null };
  approvedByCeo: boolean;
  type: string;
  what: string;
  record: string;
  amountPaise: number;
  proof: string | null;
  mark: { mark: string; note: string | null; by: string | null } | null;
}
interface Review {
  month: string;
  label: string;
  status: 'open' | 'running' | 'closed' | 'reopened';
  canClose: boolean;
  allChecked: boolean;
  close: { closedBy: string | null; closedAt: string; note: string | null; reopenedBy: string | null; reopenedAt: string | null; reopenReason: string | null } | null;
  checklist: ChecklistItem[];
  summary: { actions: number; byFinanceWithinLimits: number; approvedByCeo: number; flagged: number; moneyOutPaise: number };
  actions: Action[];
  nextMonth: string;
}

const TYPE_LABEL: Record<string, string> = { refund: 'Refund', payout: 'Payout', expense: 'Expense', salary: 'Salary', return: 'Money returned' };
/** Where each checklist item is fixed, in the Finance portal. */
const FINANCE_LINK: Record<string, string> = { bank_days_closed: 'FN-Bank', credits_matched: 'FN-MoneyIn', payouts_done: 'FN-Payouts', salaries_released: 'FN-Salaries', expenses_with_bills: 'FN-Expenses' };
/** And in the CEO portal. */
const CEO_LINK: Record<string, string> = { payouts_done: 'C-Payments-Out', salaries_released: 'C-Team-Salaries', expenses_with_bills: 'C-Expenses', credits_matched: 'C-Payments' };

function doneByText(a: Action): string {
  if (!a.doneBy.name) return '—';
  return a.doneBy.role === 'ceo' ? `${a.doneBy.name} (CEO)` : a.doneBy.name;
}

function MarkButtons({ review, a }: { review: Review; a: Action }) {
  const base = { subjectType: a.subjectType, subjectId: a.subjectId };
  return (
    <span className="fin-row-actions">
      <FormAction
        label="Looks right"
        size="compact"
        variant="success"
        title="Looks right"
        description={`${a.what} · ${a.record} · ${formatINR(a.amountPaise)}`}
        run={() => api.post(`/finance/month-end/${review.month}/marks`, { ...base, mark: 'ok' })}
        success="Marked as looks right"
      />
      <FormAction
        label="Flag"
        size="compact"
        variant="danger"
        title="Flag this for Finance"
        description={`${a.what} · ${a.record} · ${formatINR(a.amountPaise)}`}
        fields={[{ name: 'note', kind: 'text', label: 'What looks wrong', required: true }]}
        run={(v) => api.post(`/finance/month-end/${review.month}/marks`, { ...base, mark: 'flagged', note: v.note })}
        success="Flagged"
      />
    </span>
  );
}

export default function MonthEndReview() {
  const portal = usePortal();
  const to = useScreenPath();
  const { session } = useAuth();
  const isCeo = session?.staff.role === 'ceo';
  const now = useNow(60_000);
  const [params] = useSearchParams();
  const last = addMonths(istMonthKey(now), -1);
  const [month, setMonth] = useState<string>(() => {
    const m = params.get('month');
    return m && /^\d{4}-\d{2}$/.test(m) ? m : last;
  });
  const [doneBy, setDoneBy] = useState('');
  const [type, setType] = useState('');
  const [search, setSearch] = useState('');
  const query = useQuery({ queryKey: ['finance', 'month-end', month], queryFn: () => api.get<Review>('/finance/month-end', { query: { month } }) });
  const before = addMonths(last, -1);
  const beforeQuery = useQuery({ queryKey: ['finance', 'month-end', before], queryFn: () => api.get<Review>('/finance/month-end', { query: { month: before } }) });
  const r = query.data;
  const tabs = [...new Set([last, before, month])].sort().reverse();
  const tabLabel = (m: string) => {
    const status = m === month ? r?.status : m === before ? beforeQuery.data?.status : undefined;
    return status === 'closed' ? `${monthName(m)} · closed` : status === 'reopened' ? `${monthName(m)} · reopened` : monthName(m);
  };
  const people = useMemo(() => {
    const seen = new Map<string, string>();
    for (const a of r?.actions ?? []) if (a.doneBy.id) seen.set(a.doneBy.id, doneByText(a));
    return [...seen.entries()].map(([value, label]) => ({ value, label }));
  }, [r]);
  const rows = useMemo(() => {
    const q = search.trim().toLowerCase();
    return (r?.actions ?? []).filter((a) => (!doneBy || a.doneBy.id === doneBy) && (!type || a.type === type) && (!q || `${a.record} ${a.what} ${a.proof ?? ''} ${a.doneBy.name ?? ''}`.toLowerCase().includes(q)));
  }, [r, doneBy, type, search]);
  const locked = r?.status === 'closed';
  const columns = useMemo<Column<Action>[]>(
    () => [
      { key: 'date', header: 'Date', cell: (a) => formatDateIST(a.at).replace(/ \d{4}$/, ''), csv: (a) => a.at.slice(0, 10), sortValue: (a) => a.at },
      { key: 'by', header: 'Done by', cell: doneByText, csv: doneByText },
      { key: 'what', header: 'What', cell: (a) => <>{a.what}{a.approvedByCeo && a.doneBy.role !== 'ceo' && <span className="fin-sub">Approved by the CEO</span>}</>, csv: (a) => a.what },
      { key: 'record', header: 'Record', cell: (a) => `${a.record} · ${formatINR(a.amountPaise)}`, csv: (a) => `${a.record} · ${a.amountPaise / 100}` },
      {
        key: 'proof',
        header: 'Proof',
        cell: (a) => (
          <>
            <span>{a.proof ?? '—'}</span>
            {a.mark && (
              <span style={{ display: 'block', marginTop: 4 }}>
                <StatusPill tone={a.mark.mark === 'ok' ? 'good' : 'crit'}>{a.mark.mark === 'ok' ? 'Looks right' : `Flagged: ${a.mark.note ?? ''}`}</StatusPill>
              </span>
            )}
            {isCeo && r && !locked && <MarkButtons review={r} a={a} />}
          </>
        ),
        csv: (a) => a.proof,
      },
    ],
    [isCeo, r, locked],
  );
  const linkFor = (item: ChecklistItem) => {
    const id = (portal.key === 'finance' ? FINANCE_LINK : CEO_LINK)[item.key];
    if (!id || !portal.screens.some((s) => s.id === id)) return null;
    return `${to(id)}${item.key === 'salaries_released' ? `?month=${r?.month ?? month}` : ''}`;
  };
  return (
    <div className="lb-page">
      <TopBar
        back={portal.key === 'finance' ? { to: to('FN-Home'), label: 'Money today' } : { to: to('Main'), label: 'Command Center' }}
        title={`Month-end review · ${monthName(month)}`}
        subtitle="Everything Finance did this month, for the CEO to check and close."
        showSearch={false}
      />
      <Tabs label="Month" value={month} onChange={setMonth} items={tabs.map((m) => ({ key: m, label: tabLabel(m) }))} />
      {query.error && <ErrorState error={query.error} onRetry={() => void query.refetch()} />}
      <StatGrid>
        <StatTile label={`Money actions in ${monthName(month)}`} value={r?.summary.actions ?? '—'} tone="royal" loading={query.isPending} />
        <StatTile label="Done by Finance within limits" value={r?.summary.byFinanceWithinLimits ?? '—'} tone="good" loading={query.isPending} />
        <StatTile label="Approved by the CEO" value={r?.summary.approvedByCeo ?? '—'} tone="cyan" loading={query.isPending} />
        <StatTile label="Flagged" value={r?.summary.flagged ?? '—'} tone="red" loading={query.isPending} />
      </StatGrid>
      {r?.close && r.status === 'closed' && (
        <div className="rule fin-banner" style={{ borderLeftColor: 'var(--good)' }}>
          Closed by {r.close.closedBy ?? 'the CEO'} on {formatDateIST(r.close.closedAt)}{r.close.note ? ` · “${r.close.note}”` : ''} · {r.label}'s money records can't be changed; corrections go into {monthName(r.nextMonth)} with a note.
        </div>
      )}
      {r?.close && r.status === 'reopened' && (
        <div className="rule fin-banner" style={{ borderLeftColor: 'var(--critical)' }}>
          Reopened by {r.close.reopenedBy ?? 'the CEO'} on {r.close.reopenedAt ? formatDateIST(r.close.reopenedAt) : ''}: “{r.close.reopenReason}”. Close it again when the correction is in.
        </div>
      )}
      {r?.status === 'running' && <div className="rule fin-banner">{r.label} is still running. It can be closed from the 1st of {monthName(r.nextMonth)}.</div>}
      <Card title="Before closing" aside={r ? <StatusPill tone={r.allChecked ? 'good' : 'warn'}>{r.allChecked ? 'All done' : `${r.checklist.filter((c) => !c.ok).length} to finish`}</StatusPill> : null}>
        {r ? (
          <div className="fin-tl" role="list" aria-label="Month-end checklist">
            {r.checklist.map((c) => {
              const link = linkFor(c);
              return (
                <div key={c.key} role="listitem">
                  <span className="t">{c.ok ? 'Done' : 'To do'}</span>
                  <span className="dot" style={{ background: c.ok ? 'var(--good)' : 'var(--critical)' }} aria-hidden="true" />
                  <span>
                    <span className="fin-strong">{c.label}</span>
                    <span className="fin-sub">{c.detail}</span>
                  </span>
                  <span>{!c.ok && link && <Link to={link}>Open</Link>}</span>
                </div>
              );
            })}
          </div>
        ) : (
          <span className="fin-sub">Loading…</span>
        )}
      </Card>
      <FilterPanel>
        <SelectFilter label="Done by" value={doneBy} onChange={setDoneBy} options={[{ value: '', label: 'Everyone' }, ...people]} />
        <SelectFilter
          label="Type"
          value={type}
          onChange={setType}
          options={[{ value: '', label: 'All' }, ...Object.entries(TYPE_LABEL).map(([value, label]) => ({ value, label }))]}
        />
        <SearchField value={search} onChange={setSearch} placeholder="Code, name or UTR" />
      </FilterPanel>
      <Card flush>
        <DataTable
          columns={columns}
          rows={r ? rows : undefined}
          rowKey={(a) => a.id}
          caption={`Money actions · ${monthName(month, true)}`}
          loading={query.isPending}
          error={query.error}
          onRetry={() => void query.refetch()}
          pageSize={50}
          emptyTitle="No rows match these filters. Change a filter to see more."
        />
      </Card>
      <Note>
        The CEO looks through the month and closes it · after closing, {monthName(month)}'s money records can't be changed — corrections go into {monthName(addMonths(month, 1))} with a note · only the CEO reopens a closed month, with a reason
      </Note>
      <div className="fin-foot" style={{ justifyContent: 'flex-start' }}>
        {r && (r.status === 'open' || r.status === 'reopened') && (
          <FormAction
            label={`Close ${monthName(month)}`}
            variant="primary"
            title={`Close ${r.label}`}
            disabled={!isCeo}
            description={
              r.allChecked
                ? `Everything is done. After closing, ${r.label}'s money records can't be changed.`
                : `Not everything is done: ${r.checklist.filter((c) => !c.ok).map((c) => c.label.toLowerCase()).join(', ')}. Write why the month closes anyway.`
            }
            fields={r.allChecked ? [{ name: 'note', kind: 'text', label: 'Note (optional)' }] : [{ name: 'note', kind: 'text', label: 'Why it closes anyway', required: true }]}
            run={(v) => api.post(`/finance/month-end/${r.month}/close`, { note: v.note || undefined })}
            success={`${r.label} closed`}
          />
        )}
        {r?.status === 'closed' && isCeo && (
          <FormAction
            label={`Reopen ${monthName(month)}`}
            variant="danger"
            title={`Reopen ${r.label}`}
            description="Reopening lets Finance change this month's money records again. The reason is recorded."
            fields={[{ name: 'reason', kind: 'text', label: 'Why it is reopened', required: true }]}
            run={(v) => api.post(`/finance/month-end/${r.month}/reopen`, { reason: v.reason })}
            success={`${r.label} reopened`}
          />
        )}
        <ServerDownload label="Download (Excel)" path="/finance/month-end/review.csv" query={{ month }} filename={`month-end-review-${month}.csv`} />
        {!isCeo && r && r.status !== 'closed' && <span className="fin-sub">Only the CEO closes the month.</span>}
      </div>
    </div>
  );
}
