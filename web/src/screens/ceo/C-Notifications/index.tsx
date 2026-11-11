import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate } from 'react-router-dom';
import { Card } from '../../../components/Card';
import { DataTable, type Column } from '../../../components/DataTable';
import { StatGrid, StatTile } from '../../../components/StatTile';
import { StatusPill } from '../../../components/Badge';
import { TopBar } from '../../../components/TopBar';
import { api } from '../../../lib/api/client';
import { useNow } from '../../../lib/useNow';
import { istDateKey } from '../../../lib/format/date';
import type { ApiNotification } from '../../../portals/notifications';
import { useScreenPath } from '../../../portals/PortalContext';
import { FilterPanel, SearchField, SelectFilter } from '../_kit/kit';

/** Notifications — design C-Notifications.dc.html, on GET /notifications (Phase 21 Task 6). */
interface ListResponse {
  openCount: number;
  unseenCount: number;
  total: number;
  items: ApiNotification[];
  asOf: string;
}

const GROUP: Record<string, 'money' | 'job_seekers' | 'businesses' | 'placements' | 'team'> = {
  refund_needs_ceo: 'money',
  refund_ready_to_pay: 'money',
  bank_credit_unmatched: 'money',
  payout_failed: 'money',
  refund_priority: 'job_seekers',
  first_interview_overdue: 'job_seekers',
  hit_reversed: 'job_seekers',
  hit_reversal_needs_manager: 'job_seekers',
  shortage_task: 'businesses',
  in_person_onboarding_review: 'businesses',
};
export const GROUP_LABEL = { money: 'Money', job_seekers: 'Job seekers', businesses: 'Businesses', placements: 'Placements', team: 'Team' } as const;
export function groupOf(kind: string) {
  return GROUP[kind] ?? 'team';
}

/** "2 days", "5 h", "14 min" since an instant. */
export function since(iso: string, now: Date): string {
  const mins = Math.max(0, Math.floor((now.getTime() - new Date(iso).getTime()) / 60000));
  if (mins < 60) return `${mins} min`;
  const h = Math.floor(mins / 60);
  if (h < 24) return `${h} h`;
  const d = Math.floor(h / 24);
  return `${d} day${d === 1 ? '' : 's'}`;
}

export default function Notifications() {
  const to = useScreenPath();
  const now = useNow();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [status, setStatus] = useState('all');
  const [group, setGroup] = useState('');
  const [search, setSearch] = useState('');
  const list = useQuery({ queryKey: ['notifications', 'list', status], queryFn: () => api.get<ListResponse>('/notifications', { query: { status, limit: '200' } }), refetchInterval: 30_000 });
  const seen = useMutation({ mutationFn: () => api.post('/notifications/seen', {}), onSuccess: () => void qc.invalidateQueries({ queryKey: ['notifications'] }) });
  const unseen = list.data?.unseenCount ?? 0;
  useEffect(() => {
    if (unseen > 0 && !seen.isPending) seen.mutate();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [unseen]);

  const items = (list.data?.items ?? []).filter((n) => (!group || groupOf(n.kind) === group) && (!search.trim() || `${n.title} ${n.body ?? ''}`.toLowerCase().includes(search.trim().toLowerCase())));
  const all = list.data?.items ?? [];
  const today = istDateKey(now);
  const columns: Column<ApiNotification>[] = [
    { key: 'status', header: 'Status', cell: (n) => (n.status === 'open' ? <StatusPill tone="crit">New</StatusPill> : <StatusPill tone="muted">Done</StatusPill>), csv: (n) => (n.status === 'open' ? 'New' : 'Done') },
    { key: 'type', header: 'Type', cell: (n) => GROUP_LABEL[groupOf(n.kind)], csv: (n) => GROUP_LABEL[groupOf(n.kind)] },
    {
      key: 'what',
      header: 'What',
      cell: (n) => (
        <div style={n.status === 'cleared' ? { textDecoration: 'line-through', opacity: 0.75 } : undefined}>
          <div style={{ fontWeight: 600 }}>{n.title}</div>
          <div className="ceo-cell-sub">{n.status === 'cleared' ? `Cleared by itself${n.clearedBy ? ` when ${n.clearedBy.name} ${n.clearedReason ? n.clearedReason.replace(/_/g, ' ') : 'did it'}` : ''}` : (n.body ?? '')}</div>
        </div>
      ),
      csv: (n) => `${n.title}${n.body ? ` — ${n.body}` : ''}`,
    },
    { key: 'since', header: 'Since', cell: (n) => since(n.status === 'cleared' && n.clearedAt ? n.clearedAt : n.createdAt, now), sortValue: (n) => n.createdAt, csv: (n) => n.createdAt },
    { key: 'open', header: '', cell: (n) => (n.link ? <Link to={n.link} onClick={(e) => e.stopPropagation()}>Open</Link> : null) },
  ];
  return (
    <div className="lb-page">
      <TopBar back={{ to: to('Main'), label: 'Command Center' }} title="Notifications" subtitle="Everything that needs someone's attention, newest first. Each one opens the place where the work is done." />
      <StatGrid>
        <StatTile label="New" value={list.data?.openCount ?? '—'} tone="red" loading={list.isPending} />
        <StatTile label="Done today · cleared by themselves" value={list.data ? all.filter((n) => n.clearedAt && istDateKey(n.clearedAt) === today).length : '—'} tone="good" loading={list.isPending} />
        <StatTile label="Money" value={list.data ? all.filter((n) => n.status === 'open' && groupOf(n.kind) === 'money').length : '—'} tone="gold" loading={list.isPending} />
        <StatTile label="Job seekers" value={list.data ? all.filter((n) => n.status === 'open' && groupOf(n.kind) === 'job_seekers').length : '—'} tone="royal" loading={list.isPending} />
      </StatGrid>
      <FilterPanel>
        <SelectFilter label="Status" value={status} onChange={setStatus} options={[{ value: 'all', label: 'All' }, { value: 'open', label: 'New' }, { value: 'cleared', label: 'Done' }]} />
        <SelectFilter label="Type" value={group} onChange={setGroup} options={[{ value: '', label: 'All types' }, ...Object.entries(GROUP_LABEL).map(([value, label]) => ({ value, label }))]} />
        <SearchField value={search} onChange={setSearch} placeholder="Search notifications" />
      </FilterPanel>
      <div className="panel" style={{ padding: '6px 18px 14px' }}>
        <DataTable columns={columns} rows={list.data ? items : undefined} rowKey={(n) => n.id} caption="Notifications" loading={list.isPending} error={list.error} onRetry={() => void list.refetch()} download="notifications" emptyTitle="No rows match these filters. Change a filter to see more." onRowClick={(n) => n.link && navigate(n.link)} />
        <div className="ceo-note">A notification clears by itself when the work behind it is done — you never have to tick it off · you see the ones your role is allowed to act on</div>
      </div>
      <Card title="What you get notified about">
        <div className="kv">
          <span>Money</span>
          <span>Refunds waiting for you, refunds ready to pay, failed payouts, unmatched bank credits</span>
          <span>Job seekers</span>
          <span>Close to a refund, no interview 10+ days after paying, hits reversed</span>
          <span>Businesses</span>
          <span>Trade and area shortages, in-person onboarding to review</span>
          <span>Team</span>
          <span>Leave and corrections, staff without a reporting line, flags</span>
        </div>
      </Card>
    </div>
  );
}
