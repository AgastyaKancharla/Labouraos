import { useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Card } from '../../../components/Card';
import { DataTable, type Column } from '../../../components/DataTable';
import { StatusPill } from '../../../components/Badge';
import { StatGrid, StatTile } from '../../../components/StatTile';
import { TopBar } from '../../../components/TopBar';
import { useAuth } from '../../../auth/AuthProvider';
import { api } from '../../../lib/api/client';
import { useNow } from '../../../lib/useNow';
import { useScreenPath } from '../../../portals/PortalContext';
import { firstName, useOpenRequests, useTeam, waitedFor, type RequestView } from '../_kit/api';
import { RequestActions, requestNote, RequestTabs, RequestWants, RequestWho } from '../_kit/requests';

/** Requests — design T-Requests.dc.html: everything waiting for the Team Lead, and what is with the Manager. */
export default function TeamLeadRequests() {
  const to = useScreenPath();
  const now = useNow();
  const navigate = useNavigate();
  const { session } = useAuth();
  const [params] = useSearchParams();
  const team = useTeam();
  const open = useOpenRequests();
  const decided = useQuery({ queryKey: ['requests', 'decided'], queryFn: () => api.get<RequestView[]>('/requests/decided') });
  const manager = team.data?.manager;
  const mgr = manager ? `${firstName(manager.name)} (Manager)` : 'the Manager';

  // Bell links arrive as ?kind=leave&id=… — open that request.
  useEffect(() => {
    const kind = params.get('kind');
    const id = params.get('id');
    if (kind && id) navigate(to('T-Req-Sneha', { id: `${kind}.${id}` }), { replace: true });
  }, [params, navigate, to]);

  const rows = open.data ?? [];
  const mine = rows.filter((r) => r.canDecide);
  const withManager = rows.filter((r) => !r.canDecide && (r.withManager || r.withCeo) && !r.withTeamLead);
  const over24 = mine.filter((r) => r.withManager).length;
  const myDecisions = (decided.data ?? []).filter((r) => r.decided?.by?.id === session?.staff.id);
  const avgHours = myDecisions.length
    ? Math.round(myDecisions.reduce((sum, r) => sum + (new Date(r.decided!.at).getTime() - new Date(r.createdAt).getTime()), 0) / myDecisions.length / 3600000)
    : null;

  const columns: Column<RequestView>[] = [
    { key: 'who', header: 'Who', cell: (r) => <RequestWho request={r} />, sortValue: (r) => r.person?.name ?? '' },
    { key: 'wants', header: 'Wants', cell: (r) => <RequestWants request={r} />, filter: 'select', filterValue: (r) => r.title },
    {
      key: 'know',
      header: 'What you need to know',
      cell: (r) => (
        <div style={{ display: 'grid', gap: 8, minWidth: 260 }}>
          <span className="tl-sub">{requestNote(r, manager?.name, waitedFor(r.createdAt, now))}</span>
          <RequestActions request={r} managerName={manager?.name} />
        </div>
      ),
    },
    {
      key: 'alert',
      header: 'Alert',
      cell: (r) => (r.alert ? <span className="tl-alert">⚠ {r.alert}</span> : r.withManager && r.withTeamLead ? <span className="tl-alert">⚠ {firstName(manager?.name)} can also decide now</span> : '—'),
      hideOnPhone: true,
    },
  ];
  const managerColumns: Column<RequestView>[] = [
    { key: 'who', header: 'Who', cell: (r) => (r.person?.id === session?.staff.id ? <div><div className="tl-strong">{r.person?.name}</div><div className="tl-sub">You</div></div> : <RequestWho request={r} />) },
    { key: 'wants', header: 'Wants', cell: (r) => <RequestWants request={r} /> },
    { key: 'why', header: "Why it's with her", cell: (r) => <span className="tl-sub">{r.forwarded ? `You sent it · "${r.forwarded.note ?? ''}"` : r.routeReasonText}</span> },
    { key: 'status', header: 'Status', cell: (r) => <StatusPill tone="info">{r.withCeo ? 'With the CEO' : 'With Manager'} · {waitedFor(r.createdAt, now)}</StatusPill> },
  ];

  return (
    <div className="lb-page">
      <TopBar showSearch={false} back={{ to: to('T-Home'), label: 'My team' }} title="Requests" subtitle="Leave, day changes, corrections, hits, claims and devices from your team." />
      <RequestTabs waiting={mine.length} />
      <StatGrid>
        <StatTile label="Waiting for you" value={open.data ? mine.length : '—'} tone="red" loading={open.isPending} />
        <StatTile label={`Over 24 h · ${manager ? firstName(manager.name) : 'the Manager'} can see it too`} value={open.data ? over24 : '—'} tone="orange" loading={open.isPending} />
        <StatTile label={`With ${mgr}`} value={open.data ? withManager.length : '—'} tone="cyan" loading={open.isPending} />
        <StatTile label="Your average answer time" value={avgHours === null ? '—' : `${avgHours} h`} tone="royal" loading={decided.isPending} />
      </StatGrid>
      <Card flush>
        <DataTable
          columns={columns}
          rows={open.data ? mine : undefined}
          rowKey={(r) => r.ref}
          caption="Requests waiting for you"
          loading={open.isPending}
          error={open.error}
          onRetry={() => void open.refetch()}
          emptyTitle="Nothing is waiting for you."
        />
        <div className="tl-note" style={{ padding: '0 18px 14px' }}>
          You approve up to 3 planned leave days a month per person · more than 3 goes to {mgr} automatically · a 3rd correction or a 3rd hit in a month also goes to her · you can send anything to her
        </div>
      </Card>
      <Card title={`With ${mgr}`} flush>
        <DataTable columns={managerColumns} rows={open.data ? withManager : undefined} rowKey={(r) => r.ref} caption={`Requests with ${mgr}`} loading={open.isPending} error={open.error} emptyTitle="Nothing from your team is with the Manager." />
      </Card>
    </div>
  );
}
