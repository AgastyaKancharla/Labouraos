import { useQueries, useQuery } from '@tanstack/react-query';
import { DataTable, type Column } from '../../../components/DataTable';
import { StatGrid, StatTile } from '../../../components/StatTile';
import { StatusPill } from '../../../components/Badge';
import { TopBar } from '../../../components/TopBar';
import { api } from '../../../lib/api/client';
import { formatDateIST, formatDateTimeIST, formatTimeIST } from '../../../lib/format/date';
import { useScreenPath } from '../../../portals/PortalContext';
import { ActionButton } from '../_kit/actions';
import { roleLabel } from '../_kit/format';
import { AttendanceTabs } from '../_kit/tabs';

/** Leave & corrections — design C-Team-Leave.dc.html. */
export interface RequestRow {
  kind: 'leave' | 'correction';
  id: string;
  staff: { id: string; code: string; name: string; role: string } | null;
  status: 'pending' | 'approved' | 'rejected' | string;
  reason: string;
  where: string;
  createdAt: string;
  decided: { at: string; by: { name: string; role: string } | null; role: string | null; reason: string | null } | null;
  canDecide: boolean;
  leaveKind?: string;
  fromDate?: string;
  toDate?: string;
  days?: number;
  /** "first" / "second" for a half day of leave; null for full days. */
  half?: string | null;
  unpaidDays?: number;
  date?: string;
  startAt?: string;
  endAt?: string;
  overturned?: { at: string } | null;
}
interface Balance {
  staffId: string;
  casual: { left: number };
  emergency: { left: number };
}

export function requestText(r: RequestRow): string {
  if (r.kind === 'leave') {
    const kind = r.leaveKind ? r.leaveKind.charAt(0).toUpperCase() + r.leaveKind.slice(1) : 'Leave';
    const dates = r.fromDate === r.toDate ? formatDateIST(`${r.fromDate}T06:00:00Z`) : `${formatDateIST(`${r.fromDate}T06:00:00Z`)} – ${formatDateIST(`${r.toDate}T06:00:00Z`)}`;
    const span = r.half ? ` (half day, ${r.half} half)` : r.days && r.days > 1 ? ` (${r.days} days)` : '';
    return `${kind} · ${dates}${span}${r.unpaidDays ? ` · ${r.unpaidDays} unpaid` : ''}`;
  }
  return `Correction · ${r.date ? formatDateIST(`${r.date}T06:00:00Z`) : ''} ${r.startAt ? formatTimeIST(r.startAt) : ''}–${r.endAt ? formatTimeIST(r.endAt) : ''}`;
}

export function decisionText(r: RequestRow): string {
  if (r.overturned) return 'Overturned';
  if (r.status === 'pending') return `Waiting · ${r.where}`;
  const by = r.decided?.by ? ` by ${r.decided.by.name}` : '';
  return `${r.status === 'approved' ? 'Approved' : r.status === 'rejected' ? 'Refused' : r.status}${by}`;
}

export default function TeamLeave() {
  const to = useScreenPath();
  const requests = useQuery({ queryKey: ['attendance', 'requests', 'team'], queryFn: () => api.get<RequestRow[]>('/attendance/requests/team') });
  const staffIds = [...new Set((requests.data ?? []).map((r) => r.staff?.id).filter((x): x is string => Boolean(x)))];
  const balances = useQueries({
    queries: staffIds.map((id) => ({ queryKey: ['attendance', 'balance', id], queryFn: () => api.get<Balance>('/attendance/leave/balance', { query: { staffId: id } }) })),
  });
  const balanceOf = (id: string | undefined) => {
    const b = balances.find((q) => q.data?.staffId === id)?.data;
    return b ? b.casual.left + b.emergency.left : null;
  };
  const rows = requests.data;

  const columns: Column<RequestRow>[] = [
    { key: 'staff', header: 'Staff', cell: (r) => <div><div style={{ fontWeight: 600 }}>{r.staff?.name ?? '—'}</div><div className="ceo-cell-sub">{roleLabel(r.staff?.role)}</div></div>, filter: 'text', filterValue: (r) => r.staff?.name ?? '', sortValue: (r) => r.staff?.name ?? '', csv: (r) => r.staff?.name },
    { key: 'request', header: 'Request', cell: requestText, filter: 'select', filterValue: (r) => (r.kind === 'leave' ? `${r.leaveKind ?? 'leave'} leave` : 'correction'), sortValue: (r) => r.createdAt, csv: requestText },
    { key: 'reason', header: 'Reason', cell: (r) => r.reason, csv: (r) => r.reason, hideOnPhone: true },
    { key: 'balance', header: 'Balance', cell: (r) => (r.kind === 'leave' ? (balanceOf(r.staff?.id) === null ? '…' : `${balanceOf(r.staff?.id)} days`) : '—'), csv: (r) => (r.kind === 'leave' ? balanceOf(r.staff?.id) : null) },
    {
      key: 'decision',
      header: 'Decision',
      cell: (r) => <StatusPill tone={r.status === 'pending' ? 'warn' : r.status === 'approved' && !r.overturned ? 'good' : 'muted'}>{decisionText(r)}</StatusPill>,
      filter: 'select',
      filterValue: (r) => (r.status === 'pending' ? 'Waiting' : r.status === 'approved' ? 'Approved' : 'Refused'),
      csv: decisionText,
    },
    { key: 'asked', header: 'Asked', cell: (r) => formatDateTimeIST(r.createdAt), sortValue: (r) => r.createdAt, csv: (r) => r.createdAt, hideOnPhone: true },
    {
      key: 'act',
      header: '',
      cell: (r) => (
        <div className="ceo-actions" onClick={(e) => e.stopPropagation()}>
          {r.canDecide && (
            <>
              <ActionButton label="Approve" variant="success" title={`Approve ${r.staff?.name ?? ''}'s request`} description={requestText(r)} reason={{ label: 'Note (optional)', required: false }} run={({ reason }) => api.post(`/attendance/requests/${r.kind}/${r.id}/approve`, { reason: reason || undefined })} success="Approved" />
              <ActionButton label="Refuse" variant="danger" title={`Refuse ${r.staff?.name ?? ''}'s request`} description={requestText(r)} reason run={({ reason }) => api.post(`/attendance/requests/${r.kind}/${r.id}/reject`, { reason })} success="Refused" />
            </>
          )}
          {!r.canDecide && r.status === 'approved' && r.kind === 'leave' && !r.overturned && (
            <ActionButton label="Overturn" title="Overturn this approved leave" description="The days count as absent again. Say why — the person and their Team Lead see it." reason run={({ reason }) => api.post(`/attendance/requests/${r.kind}/${r.id}/overturn`, { reason })} success="Leave overturned" />
          )}
        </div>
      ),
    },
  ];

  const pending = rows?.filter((r) => r.status === 'pending') ?? [];
  return (
    <div className="lb-page">
      <TopBar back={{ to: to('C-Team-Attendance'), label: 'Attendance' }} title="Leave & corrections" subtitle="Requests, decisions and balances across the company." />
      <AttendanceTabs />
      <StatGrid>
        <StatTile label="Waiting for a decision" value={rows ? pending.length : '—'} tone="gold" loading={requests.isPending} />
        <StatTile label="Waiting with you" value={rows ? pending.filter((r) => r.canDecide).length : '—'} tone="orange" loading={requests.isPending} />
        <StatTile label="Approved (30 days)" value={rows ? rows.filter((r) => r.status === 'approved').length : '—'} tone="good" loading={requests.isPending} />
        <StatTile label="Refused (30 days)" value={rows ? rows.filter((r) => r.status === 'rejected').length : '—'} tone="red" loading={requests.isPending} />
      </StatGrid>
      <div className="panel" style={{ padding: '6px 18px 14px' }}>
        <DataTable columns={columns} rows={rows} rowKey={(r) => `${r.kind}-${r.id}`} caption="Leave and corrections" loading={requests.isPending} error={requests.error} onRetry={() => void requests.refetch()} download="leave-and-corrections" emptyTitle="No leave or correction requests in the last 30 days." />
        <div className="ceo-note">Team Leads approve; Managers and Finance see every request; leave keeps adding up month to month with no limit · holidays and the weekly day off are set on Pricing &amp; policy</div>
      </div>
    </div>
  );
}
