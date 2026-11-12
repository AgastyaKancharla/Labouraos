import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { Card } from '../../../components/Card';
import { DataTable, type Column } from '../../../components/DataTable';
import { StatusPill } from '../../../components/Badge';
import { TopBar } from '../../../components/TopBar';
import { api } from '../../../lib/api/client';
import { useNow } from '../../../lib/useNow';
import type { ApiNotification } from '../../../portals/notifications';
import { useScreenPath } from '../../../portals/PortalContext';
import { FilterPanel, SearchField, SelectFilter } from '../../ceo/_kit/kit';
import { Note } from '../_kit/kit';
import '../_kit/fin.css';

/**
 * Notifications — design FN-Notifications.dc.html, on GET /notifications
 * (the Finance bell). Money matters that need Finance, newest first; each one
 * clears by itself when the work is done, and shows who did it.
 */
interface ListResponse {
  openCount: number;
  unseenCount: number;
  total: number;
  items: ApiNotification[];
}

type Group = 'refunds' | 'money_in' | 'payouts' | 'invoices' | 'expenses' | 'salaries' | 'tax' | 'other';
const GROUP: Record<string, Group> = {
  refund_ready_to_pay: 'refunds',
  refund_needs_ceo: 'refunds',
  refund_priority: 'refunds',
  bank_credit_unmatched: 'money_in',
  review_flag: 'money_in',
  payout_failed: 'payouts',
  expense_to_pay: 'expenses',
  expense_needs_ceo: 'expenses',
  salaries_to_release: 'salaries',
  salaries_need_ceo: 'salaries',
  month_not_closed: 'salaries',
  payslip_ready: 'salaries',
};
const GROUP_LABEL: Record<Group, string> = {
  refunds: 'Refunds',
  money_in: 'Money in',
  payouts: 'Payouts',
  invoices: 'Invoices',
  expenses: 'Expenses',
  salaries: 'Salaries & month end',
  tax: 'Tax',
  other: 'Other',
};
const groupOf = (kind: string): Group => GROUP[kind] ?? 'other';

function since(iso: string, now: Date): string {
  const mins = Math.max(0, Math.floor((now.getTime() - new Date(iso).getTime()) / 60000));
  if (mins < 60) return mins < 2 ? 'now' : `${mins} min`;
  const h = Math.floor(mins / 60);
  if (h < 24) return `${h} h`;
  const d = Math.floor(h / 24);
  return d === 0 ? 'today' : `${d} day${d === 1 ? '' : 's'}`;
}

/** The bell's link is the full in-app path; inside the router it is used as is. */
function linkOf(n: ApiNotification): string | null {
  return n.link && n.link.startsWith('/') ? n.link : null;
}

export default function FinanceNotifications() {
  const to = useScreenPath();
  const now = useNow(60_000);
  const qc = useQueryClient();
  const [status, setStatus] = useState('all');
  const [group, setGroup] = useState('');
  const [search, setSearch] = useState('');
  const list = useQuery({
    queryKey: ['notifications', 'list', status],
    queryFn: () => api.get<ListResponse>('/notifications', { query: { status, limit: '200' } }),
    refetchInterval: 30_000,
  });
  const seen = useMutation({ mutationFn: () => api.post('/notifications/seen', {}), onSuccess: () => void qc.invalidateQueries({ queryKey: ['notifications'] }) });
  const unseen = list.data?.unseenCount ?? 0;
  useEffect(() => {
    if (unseen > 0 && !seen.isPending) seen.mutate();
    // Marks what is on the page as seen once it has loaded; seen is not done.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [unseen]);
  const rows = useMemo(() => {
    const q = search.trim().toLowerCase();
    return (list.data?.items ?? []).filter((n) => (!group || groupOf(n.kind) === group) && (!q || `${n.title} ${n.body ?? ''}`.toLowerCase().includes(q)));
  }, [list.data, group, search]);
  const columns: Column<ApiNotification>[] = [
    { key: 'status', header: 'Status', cell: (n) => (n.status === 'open' ? <StatusPill tone="crit">New</StatusPill> : <StatusPill tone="muted">Done</StatusPill>), csv: (n) => (n.status === 'open' ? 'New' : 'Done') },
    { key: 'type', header: 'Type', cell: (n) => GROUP_LABEL[groupOf(n.kind)], csv: (n) => GROUP_LABEL[groupOf(n.kind)], hideOnPhone: true },
    {
      key: 'what',
      header: 'What',
      cell: (n) => (
        <div style={n.status === 'cleared' ? { opacity: 0.75 } : undefined}>
          <span className="fin-strong" style={n.status === 'cleared' ? { textDecoration: 'line-through' } : undefined}>
            {n.title}
          </span>
          <span className="fin-sub">
            {n.status === 'cleared' ? `Cleared by itself${n.clearedBy ? ` · done by ${n.clearedBy.name}` : ''}` : (n.body ?? '')}
          </span>
        </div>
      ),
      csv: (n) => n.title,
    },
    { key: 'since', header: 'Since', cell: (n) => since(n.status === 'cleared' && n.clearedAt ? n.clearedAt : n.createdAt, now), csv: (n) => n.createdAt, sortValue: (n) => n.createdAt },
    { key: 'open', header: '', cell: (n) => (linkOf(n) ? <Link to={linkOf(n)!}>Open</Link> : null) },
  ];
  return (
    <div className="lb-page">
      <TopBar back={{ to: to('FN-Home'), label: 'Money today' }} title="Notifications" subtitle="Money matters that need you, newest first." showSearch={false} />
      <FilterPanel>
        <SelectFilter label="Status" value={status} onChange={setStatus} options={[{ value: 'all', label: 'All' }, { value: 'open', label: 'New' }, { value: 'cleared', label: 'Done' }]} />
        <SelectFilter label="Type" value={group} onChange={setGroup} options={[{ value: '', label: 'All types' }, ...(Object.keys(GROUP_LABEL) as Group[]).filter((g) => g !== 'other' && g !== 'invoices' && g !== 'tax').map((g) => ({ value: g, label: GROUP_LABEL[g] }))]} />
        <SearchField value={search} onChange={setSearch} placeholder="Search notifications" />
      </FilterPanel>
      <Card flush>
        <DataTable
          columns={columns}
          rows={list.data ? rows : undefined}
          rowKey={(n) => n.id}
          caption="Notifications"
          loading={list.isPending}
          error={list.error}
          onRetry={() => void list.refetch()}
          pageSize={50}
          emptyTitle="No rows match these filters. Change a filter to see more."
        />
      </Card>
      <Note>Each one clears by itself when the work is done</Note>
    </div>
  );
}
