import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate } from 'react-router-dom';
import { Card } from '../../../components/Card';
import { DataTable, type Column } from '../../../components/DataTable';
import { StatusPill } from '../../../components/Badge';
import { TopBar } from '../../../components/TopBar';
import { api } from '../../../lib/api/client';
import { useNow } from '../../../lib/useNow';
import type { ApiNotification } from '../../../portals/notifications';
import { useScreenPath } from '../../../portals/PortalContext';
import { FilterPanel, SearchField, SelectFilter } from '../../ceo/_kit/kit';
import { useTeam, waitedFor } from '../_kit/api';

/** Notifications — design T-Notifications.dc.html: the Team Lead's own bell, on GET /notifications. */
interface ListResponse {
  openCount: number;
  unseenCount: number;
  items: ApiNotification[];
}

const TYPE: Record<string, string> = {
  leave_request: 'Leave',
  correction_request: 'Leave',
  request_decided: 'Leave',
  staff_request: 'Requests',
  refund_priority: 'Refunds',
  first_interview_overdue: 'Refunds',
  shortage_task: 'Stuck',
  review_flag: 'Visits',
  in_person_onboarding_review: 'Visits',
  break_overrun: 'Attendance',
  agent_idle: 'Attendance',
  system_problem: 'Attendance',
};
export const typeOf = (kind: string) => TYPE[kind] ?? 'Other';

export default function TeamLeadNotifications() {
  const to = useScreenPath();
  const now = useNow();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const team = useTeam();
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
  const items = (list.data?.items ?? []).filter((n) => (!type || typeOf(n.kind) === type) && (!search.trim() || `${n.title} ${n.body ?? ''}`.toLowerCase().includes(search.trim().toLowerCase())));
  const columns: Column<ApiNotification>[] = [
    { key: 'status', header: 'Status', cell: (n) => (n.status === 'open' ? <StatusPill tone="crit">New</StatusPill> : <StatusPill tone="muted">Done</StatusPill>) },
    { key: 'type', header: 'Type', cell: (n) => typeOf(n.kind) },
    {
      key: 'what',
      header: 'What',
      cell: (n) => (
        <div style={n.status === 'cleared' ? { textDecoration: 'line-through', opacity: 0.75 } : undefined}>
          <div className="tl-strong">{n.title}</div>
          <div className="tl-sub">{n.status === 'cleared' ? `Cleared by itself${n.clearedBy ? ` when ${n.clearedBy.name} did the work` : ''}` : (n.body ?? '')}</div>
        </div>
      ),
    },
    { key: 'since', header: 'Since', cell: (n) => waitedFor(n.status === 'cleared' && n.clearedAt ? n.clearedAt : n.createdAt, now), sortValue: (n) => n.createdAt },
    { key: 'open', header: '', cell: (n) => (n.link ? <Link to={n.link} onClick={(e) => e.stopPropagation()}>Open</Link> : null) },
  ];
  return (
    <div className="lb-page">
      <TopBar showSearch={false} back={{ to: to('T-Home'), label: 'My team' }} title="Notifications" subtitle="Everything about your team that needs you, newest first." />
      <FilterPanel>
        <SelectFilter label="Status" value={status} onChange={setStatus} options={[{ value: 'all', label: 'All' }, { value: 'open', label: 'New' }, { value: 'cleared', label: 'Done' }]} />
        <SelectFilter label="Type" value={type} onChange={setType} options={[{ value: '', label: 'All types' }, ...['Leave', 'Requests', 'Refunds', 'Stuck', 'Owners', 'Quality', 'Visits', 'Attendance'].map((v) => ({ value: v, label: v }))]} />
        <SearchField value={search} onChange={setSearch} placeholder="Search notifications" />
      </FilterPanel>
      <Card flush>
        <DataTable columns={columns} rows={list.data ? items : undefined} rowKey={(n) => n.id} caption="Notifications" loading={list.isPending} error={list.error} onRetry={() => void list.refetch()} emptyTitle="No rows match these filters. Change a filter to see more." onRowClick={(n) => n.link && navigate(n.link)} />
        <div className="tl-note" style={{ padding: '0 18px 14px' }}>
          Only things about {team.data?.teamName ?? 'your team'} · each one clears by itself when the work is done
        </div>
      </Card>
    </div>
  );
}
