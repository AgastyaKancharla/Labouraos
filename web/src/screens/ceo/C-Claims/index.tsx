import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import type { Column } from '../../../components/DataTable';
import { StatGrid, StatTile } from '../../../components/StatTile';
import { StatusPill } from '../../../components/Badge';
import { TopBar } from '../../../components/TopBar';
import { formatINR } from '../../../lib/format/money';
import { useScreenPath } from '../../../portals/PortalContext';
import { DateFilter, FilterPanel, OpenLink, PagedTable, rangeQuery, useCeoList, humanize, type ListPeriod } from '../_kit/kit';
import { PlacementTabs } from '../_kit/tabs';

/** Replacement claims — design C-Claims.dc.html. */
interface Row {
  id: string;
  code: string;
  placement: { id: string; code: string };
  business: { id: string; name: string };
  reason: string;
  leftOnDay: number | null;
  reportedDaysAfterLeaving: number;
  reportedWithinDeadline: boolean;
  feePaidInFull: boolean;
  decision: string | null;
  decidedBy: { name: string; role: string } | null;
  overdue: boolean;
  rejectedReplacements: number;
  search: { state: string; day?: number; of?: number };
  feePaise: number;
}
interface Summary {
  thisMonth: number;
  waitingForDecision: number;
  searchesRunning: number;
  refundableFromSearchPaise: number;
  searchDays: number;
}

const ROLE: Record<string, string> = { team_lead: 'TL', manager: 'Manager', ceo: 'CEO' };

function decision(r: Row) {
  if (!r.decision) return <StatusPill tone={r.overdue ? 'crit' : 'warn'}>{r.overdue ? 'Overdue · over 48 h' : 'Waiting'}</StatusPill>;
  const by = r.decidedBy ? ` by ${r.decidedBy.name.split(' ')[0]} (${ROLE[r.decidedBy.role] ?? humanize(r.decidedBy.role)})` : '';
  return <StatusPill tone={r.decision === 'accepted' ? 'good' : 'muted'}>{`${humanize(r.decision)}${by}`}</StatusPill>;
}

function search(r: Row) {
  switch (r.search.state) {
    case 'running':
      return r.search.day ? `Day ${r.search.day} of ${r.search.of}` : 'Running';
    case 'replaced':
      return <StatusPill tone="good">Replaced</StatusPill>;
    case 'ended':
      return <StatusPill tone="crit">Paused · {r.rejectedReplacements} rejections</StatusPill>;
    default:
      return '—';
  }
}

export default function Claims() {
  const to = useScreenPath();
  const navigate = useNavigate();
  const [period, setPeriod] = useState<ListPeriod>(null);
  const list = useCeoList<Row, object, Summary>('/ceo/claims', { ...rangeQuery(period) });
  const s = list.query.data?.summary;
  const loading = list.query.isPending;
  const columns: Column<Row>[] = [
    { key: 'pl', header: 'Placement', cell: (r) => <span className="code">{r.placement.code}</span>, csv: (r) => r.placement.code },
    { key: 'biz', header: 'Business', cell: (r) => r.business.name, csv: (r) => r.business.name },
    { key: 'reason', header: 'Reason', cell: (r) => `${r.leftOnDay ? `Left on day ${r.leftOnDay} · ` : ''}${humanize(r.reason).toLowerCase()}`, csv: (r) => r.reason },
    {
      key: 'reported',
      header: 'Reported',
      cell: (r) => (
        <>
          Day {r.reportedDaysAfterLeaving} after leaving {!r.reportedWithinDeadline && <StatusPill tone="danger">late</StatusPill>} {!r.feePaidInFull && <StatusPill tone="danger">fee not paid</StatusPill>}
        </>
      ),
      csv: (r) => r.reportedDaysAfterLeaving,
      hideOnPhone: true,
    },
    { key: 'decision', header: 'Decision (48 h)', cell: decision, csv: (r) => r.decision ?? 'waiting' },
    { key: 'search', header: 'Search', cell: search, csv: (r) => r.search.state },
    { key: 'go', header: '', cell: (r) => <OpenLink to={to('C-Placement', { id: r.placement.id })} /> },
  ];
  return (
    <div className="lb-page">
      <TopBar back={{ to: to('C-Placements'), label: 'Placements' }} title="Replacement claims" subtitle="Workers who left within 60 days and what Laboura owes the business." />
      <PlacementTabs />
      <StatGrid>
        <StatTile label="Claims this month" value={s?.thisMonth ?? '—'} tone="royal" loading={loading} />
        <StatTile label="Waiting for a decision" value={s?.waitingForDecision ?? '—'} tone="gold" loading={loading} />
        <StatTile label="Replacement searches running" value={s?.searchesRunning ?? '—'} tone="orange" loading={loading} />
        <StatTile label={`Refundable from day ${s?.searchDays ?? 15}`} value={s ? formatINR(s.refundableFromSearchPaise) : '—'} tone="red" loading={loading} to={to('C-NearRefund')} />
      </StatGrid>
      <FilterPanel>
        <DateFilter label="Reported" value={period} onChange={setPeriod} />
      </FilterPanel>
      <PagedTable
        list={list}
        columns={columns}
        rowKey={(r) => r.id}
        caption="Replacement claims"
        download="replacement-claims"
        onOpen={(r) => navigate(to('C-Placement', { id: r.placement.id }))}
        emptyTitle="No replacement claims."
        note="A business must report within 7 days and have paid in full · a Team Lead or Manager decides within 48 hours · up to 2 free replacements within 60 days, 100% refund if none in 15 days."
      />
    </div>
  );
}
