import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate } from 'react-router-dom';
import { DataTable, type Column } from '../../../components/DataTable';
import { StatusPill } from '../../../components/Badge';
import { TopBar } from '../../../components/TopBar';
import { api } from '../../../lib/api/client';
import { useNow } from '../../../lib/useNow';
import type { ApiNotification } from '../../../portals/notifications';
import { useScreenPath } from '../../../portals/PortalContext';
import { FilterPanel, SearchField, SelectFilter } from '../../ceo/_kit/kit';
import { since } from '../../ceo/C-Notifications';

interface ListResponse {
  openCount: number;
  unseenCount: number;
  total: number;
  items: ApiNotification[];
}

/** The design's types for a Manager: Leave · Refunds · Claims · Quality · People · Devices. */
const TYPE_OF: Record<string, string> = {
  leave_request: 'Leave',
  correction_request: 'Leave',
  request_decided: 'Leave',
  refund_priority: 'Refunds',
  first_interview_overdue: 'Refunds',
  review_flag: 'Quality',
  hit_reversed: 'Quality',
  hit_reversal_needs_manager: 'Quality',
  in_person_onboarding_review: 'Quality',
  shortage_task: 'Quality',
  break_overrun: 'People',
  agent_idle: 'People',
  system_problem: 'People',
  no_reporting_line: 'People',
};
export function typeOf(kind: string): string {
  if (kind.includes('claim')) return 'Claims';
  if (kind.includes('device')) return 'Devices';
  return TYPE_OF[kind] ?? 'People';
}
const TYPES = ['Leave', 'Refunds', 'Claims', 'Quality', 'People', 'Devices'];

/**
 * Notifications — design MG-Notifications.dc.html, on GET /notifications (the
 * Manager's own bell: only things about their teams, each clearing by itself
 * when the work is done). Opening the page marks them seen.
 */
export default function ManagerNotifications() {
  const to = useScreenPath();
  const now = useNow();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [status, setStatus] = useState('all');
  const [type, setType] = useState('');
  const [search, setSearch] = useState('');
  const list = useQuery({ queryKey: ['notifications', 'list', status], queryFn: () => api.get<ListResponse>('/notifications', { query: { status, limit: '200' } }), refetchInterval: 30_000 });
  const seen = useMutation({ mutationFn: () => api.post('/notifications/seen', {}), onSuccess: () => void qc.invalidateQueries({ queryKey: ['notifications'] }) });
  const unseen = list.data?.unseenCount ?? 0;
  useEffect(() => {
    if (unseen > 0 && !seen.isPending) seen.mutate();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [unseen]);
  const q = search.trim().toLowerCase();
  const items = (list.data?.items ?? []).filter((n) => (!type || typeOf(n.kind) === type) && (!q || `${n.title} ${n.body ?? ''}`.toLowerCase().includes(q)));

  const columns: Column<ApiNotification>[] = [
    {
      key: 'what',
      header: 'What',
      cell: (n) => (
        <div style={n.status === 'cleared' ? { textDecoration: 'line-through', opacity: 0.75 } : undefined}>
          <div style={{ fontWeight: 600 }}>
            {n.status === 'open' && <StatusPill tone="crit">New</StatusPill>} {n.title}
          </div>
          <div className="ceo-cell-sub">{n.status === 'cleared' ? `Cleared by itself${n.clearedBy ? ` when ${n.clearedBy.name} did it` : ''}` : (n.body ?? '')}</div>
        </div>
      ),
      csv: (n) => `${n.title}${n.body ? ` — ${n.body}` : ''}`,
    },
    { key: 'type', header: 'Type', cell: (n) => typeOf(n.kind), csv: (n) => typeOf(n.kind), hideOnPhone: true },
    { key: 'since', header: 'Since', cell: (n) => since(n.status === 'cleared' && n.clearedAt ? n.clearedAt : n.createdAt, now), sortValue: (n) => n.createdAt, csv: (n) => n.createdAt },
    { key: 'open', header: '', cell: (n) => (n.link ? <Link to={n.link} onClick={(e) => e.stopPropagation()}>Open</Link> : null) },
  ];
  return (
    <div className="lb-page">
      <TopBar back={{ to: to('MG-Home'), label: 'Command Center' }} title="Notifications" subtitle="Everything about your teams that needs you, newest first." />
      <FilterPanel>
        <SelectFilter label="Status" value={status} onChange={setStatus} options={[{ value: 'all', label: 'All' }, { value: 'open', label: 'New' }, { value: 'cleared', label: 'Done' }]} />
        <SelectFilter label="Type" value={type} onChange={setType} options={[{ value: '', label: 'All types' }, ...TYPES.map((t) => ({ value: t, label: t }))]} />
        <SearchField value={search} onChange={setSearch} placeholder="Search notifications" />
      </FilterPanel>
      <div className="panel" style={{ padding: '6px 18px 14px' }}>
        <DataTable columns={columns} rows={list.data ? items : undefined} rowKey={(n) => n.id} caption="Notifications" loading={list.isPending} error={list.error} onRetry={() => void list.refetch()} download="notifications" emptyTitle="No rows match these filters. Change a filter to see more." onRowClick={(n) => n.link && navigate(n.link)} />
        <div className="ceo-note">Only things about your teams · each one clears by itself when the work is done</div>
      </div>
    </div>
  );
}
