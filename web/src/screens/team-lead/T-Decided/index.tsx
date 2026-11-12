import { useQuery } from '@tanstack/react-query';
import { Card } from '../../../components/Card';
import { DataTable, type Column } from '../../../components/DataTable';
import { StatusPill } from '../../../components/Badge';
import { TopBar } from '../../../components/TopBar';
import { useAuth } from '../../../auth/AuthProvider';
import { api } from '../../../lib/api/client';
import { formatDateIST, formatTimeIST, istDateKey } from '../../../lib/format/date';
import { useNow } from '../../../lib/useNow';
import { useScreenPath } from '../../../portals/PortalContext';
import { roleLabel } from '../../ceo/_kit/format';
import { firstName, useTeam, useWaiting, type RequestView } from '../_kit/api';
import { RequestTabs } from '../_kit/requests';

/** Decided this week — design T-Decided.dc.html. */
export default function TeamLeadDecided() {
  const to = useScreenPath();
  const now = useNow();
  const { session } = useAuth();
  const team = useTeam();
  const waiting = useWaiting();
  const decided = useQuery({ queryKey: ['requests', 'decided'], queryFn: () => api.get<RequestView[]>('/requests/decided') });
  const manager = team.data?.manager;
  const byText = (r: RequestView) => {
    const by = r.overturned?.by ?? r.decided?.by;
    if (!by) return '—';
    if (by.id === session?.staff.id) return 'You';
    return `${firstName(by.name)} (${roleLabel(by.role)})`;
  };
  const when = (r: RequestView) => {
    const at = r.overturned?.at ?? r.decided?.at ?? r.createdAt;
    return istDateKey(at) === istDateKey(now) ? `Today ${formatTimeIST(at)}` : formatDateIST(at);
  };
  const columns: Column<RequestView>[] = [
    { key: 'when', header: 'When', cell: when, sortValue: (r) => r.decided?.at ?? '', csv: when },
    { key: 'by', header: 'Decided by', cell: byText, filter: 'select', filterValue: byText, csv: byText },
    {
      key: 'about',
      header: 'About',
      cell: (r) =>
        r.about && r.about.type !== 'staff' ? (
          <div className="tl-strong">
            {r.about.code} · {r.about.name}
          </div>
        ) : (
          <div>
            <div className="tl-strong">{r.person?.name ?? '—'}</div>
            <div className="tl-sub">{roleLabel(r.person?.role)}</div>
          </div>
        ),
    },
    { key: 'request', header: 'Request', cell: (r) => `${r.title} · ${r.summary}`, filter: 'select', filterValue: (r) => r.title },
    {
      key: 'decision',
      header: 'Decision',
      cell: (r) => (
        <StatusPill tone={r.status === 'approved' ? 'good' : 'danger'}>
          {r.status === 'approved' ? 'Approved' : 'Rejected'}
          {r.overturned ? ' · overturned' : ''}
        </StatusPill>
      ),
    },
    { key: 'reason', header: 'Reason', cell: (r) => { const reason = r.overturned?.reason ?? r.decided?.reason; return reason && reason !== 'Approved' ? `"${reason}"` : '—'; } },
  ];
  return (
    <div className="lb-page">
      <TopBar showSearch={false} back={{ to: to('T-Requests'), label: 'Requests' }} title="Decided this week" subtitle="Every request from your team that was decided, and by whom." />
      <RequestTabs waiting={waiting.data?.length} />
      <Card flush>
        <DataTable columns={columns} rows={decided.data} rowKey={(r) => r.ref} caption="Decided this week" loading={decided.isPending} error={decided.error} onRetry={() => void decided.refetch()} emptyTitle="Nothing was decided this week." />
        <div className="tl-note" style={{ padding: '0 18px 14px' }}>
          {manager ? firstName(manager.name) : 'The Manager'} can overturn your decisions with a reason · you'll see it here
        </div>
      </Card>
    </div>
  );
}
