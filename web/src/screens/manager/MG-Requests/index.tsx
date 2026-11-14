import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Card } from '../../../components/Card';
import { DataTable, type Column } from '../../../components/DataTable';
import { SelectField, TextField } from '../../../components/fields';
import { StatGrid, StatTile } from '../../../components/StatTile';
import { TopBar } from '../../../components/TopBar';
import { ReportWorkerLeftFinder } from '../../../claims/WorkerLeft';
import { useNow } from '../../../lib/useNow';
import { useScreenPath } from '../../../portals/PortalContext';
import { teamShort } from '../_kit/kit';
import {
  RequestActions,
  RequestTabs,
  RequestWants,
  RequestWho,
  TYPE_OPTIONS,
  requestTeam,
  treeIndex,
  useOpenRequests,
  useTree,
  useWaiting,
  waitedFor,
  whyLine,
  type RequestView,
} from '../_kit/requests';

const OVER_24H = ['team_lead_24h', 'device_24h', 'claim_24h'];

/**
 * Requests — design MG-Requests.dc.html, on GET /requests/waiting: everything
 * waiting for the Manager, and why each one is with them. Approve and Reject
 * go to POST /requests/:ref/decide (a reason is needed to reject); whoever
 * decides first closes it for the Team Lead too.
 */
export default function ManagerRequests() {
  const to = useScreenPath();
  const now = useNow();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const waiting = useWaiting();
  const open = useOpenRequests();
  const staff = useTree();
  const tree = useMemo(() => treeIndex(staff.data), [staff.data]);
  const [type, setType] = useState('');
  const [team, setTeam] = useState('');
  const [search, setSearch] = useState('');

  // Bell links arrive as ?kind=leave&id=… — open that request.
  useEffect(() => {
    const kind = params.get('kind');
    const id = params.get('id');
    if (kind && id) navigate(to('MG-Req-Ravi', { id: `${kind}.${id}` }), { replace: true });
  }, [params, navigate, to]);

  const rows = waiting.data ?? [];
  const over24 = rows.filter((r) => r.whyWithYou && OVER_24H.includes(r.whyWithYou)).length;
  const withAlert = rows.filter((r) => r.alert).length;
  const goneToCeo = (open.data ?? []).filter((r) => r.withCeo && !r.canDecide).length;

  const needle = search.trim().toLowerCase();
  const kinds = TYPE_OPTIONS.find((o) => o.value === type)?.kinds;
  const shown = rows.filter((r) => {
    if (kinds && !kinds.includes(r.kind)) return false;
    if (team && requestTeam(r, tree) !== team) return false;
    if (needle) {
      const hay = [r.person?.name, r.person?.code, r.about?.name, r.about?.code, r.requestedBy?.name].filter(Boolean).join(' ').toLowerCase();
      if (!hay.includes(needle)) return false;
    }
    return true;
  });

  const columns: Column<RequestView>[] = [
    { key: 'who', header: 'Who', cell: (r) => <RequestWho request={r} tree={tree} />, sortValue: (r) => r.about?.code ?? r.person?.name ?? '' },
    { key: 'wants', header: 'Wants', cell: (r) => <RequestWants request={r} /> },
    {
      key: 'why',
      header: "Why it's with you",
      cell: (r) => (
        <div className="mg-why">
          <span>{whyLine(r, tree, now)}</span>
          <RequestActions request={r} tree={tree} />
        </div>
      ),
    },
    { key: 'alert', header: 'Alert', cell: (r) => (r.alert ? <span className="mg-alert">⚠ {r.alert}</span> : '—'), hideOnPhone: true },
    { key: 'waiting', header: 'Waiting', cell: (r) => waitedFor(r.createdAt, now), sortValue: (r) => r.createdAt },
  ];

  const filtered = Boolean(type || team || needle);

  return (
    <div className="lb-page">
      <TopBar back={{ to: to('MG-Home'), label: 'Command Center' }} title="Requests" subtitle="Everything waiting for a Manager, and why it is with you." actions={<ReportWorkerLeftFinder />} />
      <RequestTabs waiting={waiting.data?.length} />
      <StatGrid>
        <StatTile label="Waiting for you" value={waiting.data ? rows.length : '—'} tone="royal" loading={waiting.isPending} />
        <StatTile label="Not answered by the Team Lead in 24 h" value={waiting.data ? over24 : '—'} tone="gold" loading={waiting.isPending} />
        <StatTile label="With an alert" value={waiting.data ? withAlert : '—'} tone="orange" loading={waiting.isPending} />
        <StatTile label="Gone to the CEO (over 48 h)" value={open.data ? goneToCeo : '—'} tone="good" loading={open.isPending} />
      </StatGrid>
      <section className="panel mg-filters" aria-label="Filter requests">
        <SelectField label="Type" value={type} onChange={setType} placeholder="All" options={TYPE_OPTIONS.map((o) => ({ value: o.value, label: o.label }))} />
        <SelectField label="Team" value={team} onChange={setTeam} placeholder="All teams" options={tree.teams.map((t) => ({ value: t, label: teamShort(t) }))} />
        <div className="mg-grow">
          <TextField label="Search" value={search} onChange={setSearch} placeholder="Name or code" type="search" />
        </div>
      </section>
      <Card flush>
        <DataTable
          columns={columns}
          rows={waiting.data ? shown : undefined}
          rowKey={(r) => r.ref}
          caption="Requests waiting for you"
          loading={waiting.isPending}
          error={waiting.error}
          onRetry={() => void waiting.refetch()}
          emptyTitle={filtered ? 'No rows match these filters. Change a filter to see more.' : 'Nothing is waiting for you.'}
        />
        <div className="mg-note">
          When you decide, the Team Lead's list updates too and the person gets an SMS · a reason is needed to reject · anything you leave for 48 hours goes to the CEO
        </div>
      </Card>
    </div>
  );
}
