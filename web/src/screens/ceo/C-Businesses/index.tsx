import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Card } from '../../../components/Card';
import type { Column } from '../../../components/DataTable';
import { StatGrid, StatTile } from '../../../components/StatTile';
import { StatusPill } from '../../../components/Badge';
import { TopBar } from '../../../components/TopBar';
import { formatINR } from '../../../lib/format/money';
import { useScreenPath } from '../../../portals/PortalContext';
import { DateFilter, FilterPanel, OpenLink, PagedTable, SearchField, SelectFilter, dateOrDash, humanize, rangeQuery, useCeoList, useDebounced, type ListPeriod } from '../_kit/kit';
import { BUSINESS_STATUS } from '../_kit/labels';
import { BusinessTabs } from '../_kit/tabs';

/** CEO Businesses list — design C-Businesses.dc.html. */
interface Row {
  id: string;
  code: string;
  name: string;
  type: string | null;
  area: string | null;
  status: string;
  noDocuments: boolean;
  accountAgent: string | null;
  openVacancies: number;
  openPositions: number;
  placements: number;
  feesPaidPaise: number;
  lastVisitAt: string | null;
  flags: string[];
}
interface Extra {
  byType: { name: string; count: number }[];
  byArea: { name: string; count: number }[];
  facets: { agents: { id: string; name: string }[]; areas: string[]; types: string[] };
}
interface Summary {
  active: number;
  signedThisMonth: number;
  noDocuments: number;
  hiredMoreThanOnce: number;
  flags: number;
  revisitsDueThisWeek: number;
  repeatPercent: number;
  withPlacements: number;
}

export default function BusinessesList() {
  const to = useScreenPath();
  const navigate = useNavigate();
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('');
  const [agent, setAgent] = useState('');
  const [area, setArea] = useState('');
  const [type, setType] = useState('');
  const [period, setPeriod] = useState<ListPeriod>(null);
  const q = useDebounced(search);
  const list = useCeoList<Row, Extra, Summary>('/ceo/businesses', { search: q, status, agent, area, type, ...rangeQuery(period) });
  const d = list.query.data;
  const s = d?.summary;
  const loading = list.query.isPending;

  const columns: Column<Row>[] = [
    { key: 'code', header: 'Code', cell: (r) => <span className="code">{r.code}</span>, csv: (r) => r.code },
    {
      key: 'name',
      header: 'Business',
      cell: (r) => (
        <div>
          <div style={{ fontWeight: 600 }}>{r.name}</div>
          <div className="ceo-cell-sub">{[humanize(r.type), r.area].filter((x) => x && x !== '—').join(' · ')}</div>
        </div>
      ),
      csv: (r) => r.name,
    },
    { key: 'agent', header: 'Account agent', cell: (r) => r.accountAgent ?? '—', csv: (r) => r.accountAgent, hideOnPhone: true },
    {
      key: 'status',
      header: 'Status',
      cell: (r) => (
        <span className="ceo-actions">
          <StatusPill tone={BUSINESS_STATUS[r.status]?.tone ?? 'muted'}>{BUSINESS_STATUS[r.status]?.label ?? humanize(r.status)}</StatusPill>
          {r.noDocuments && <StatusPill tone="warn">No documents</StatusPill>}
        </span>
      ),
      csv: (r) => BUSINESS_STATUS[r.status]?.label ?? r.status,
    },
    { key: 'vac', header: 'Open vacancies', cell: (r) => (r.openVacancies ? `${r.openVacancies}${r.openPositions > r.openVacancies ? ` · ${r.openPositions} positions` : ''}` : '0'), csv: (r) => r.openVacancies },
    { key: 'pl', header: 'Placements', cell: (r) => r.placements, csv: (r) => r.placements, hideOnPhone: true },
    { key: 'fees', header: 'Fees paid', cell: (r) => formatINR(r.feesPaidPaise), csv: (r) => r.feesPaidPaise / 100, align: 'right' },
    { key: 'visit', header: 'Last visit', cell: (r) => dateOrDash(r.lastVisitAt), csv: (r) => r.lastVisitAt, hideOnPhone: true },
    {
      key: 'flags',
      header: 'Flags',
      cell: (r) => (r.flags.length ? <StatusPill tone="warn">{r.flags.map(humanize).join(', ')}</StatusPill> : '—'),
      csv: (r) => r.flags.join(' '),
    },
    { key: 'open', header: '', cell: (r) => <OpenLink to={to('C-Business', { id: r.id })} /> },
  ];

  return (
    <div className="lb-page">
      <TopBar back={{ to: to('Main'), label: 'Command Center' }} title="Businesses" subtitle="Every business, its account agent, what it has paid and anything that needs a look." />
      <BusinessTabs />
      <StatGrid>
        <StatTile label="Active businesses" value={s?.active ?? '—'} tone="royal" loading={loading} />
        <StatTile label="Signed this month" value={s?.signedThisMonth ?? '—'} tone="good" loading={loading} />
        <StatTile label="No documents" value={s?.noDocuments ?? '—'} tone="gold" loading={loading} />
        <StatTile label="Hired more than once" value={s?.hiredMoreThanOnce ?? '—'} tone="cyan" loading={loading} />
        <StatTile label="Bypass or pattern flags" value={s?.flags ?? '—'} tone="red" loading={loading} />
        <StatTile label="Revisits due this week" value={s?.revisitsDueThisWeek ?? '—'} tone="orange" loading={loading} />
      </StatGrid>
      <FilterPanel>
        <SearchField value={search} onChange={setSearch} placeholder="Name, phone, GST or BZ- code" />
        <SelectFilter
          label="Status"
          value={status}
          onChange={setStatus}
          options={[
            { value: '', label: 'All' },
            { value: 'verified', label: 'Verified' },
            { value: 'tl_review', label: 'TL review' },
            { value: 'lead', label: 'Lead · visit needed' },
            { value: 'no_documents', label: 'No documents' },
            { value: 'paused', label: 'Paused' },
            { value: 'rejected', label: 'Rejected' },
          ]}
        />
        <SelectFilter label="Account agent" value={agent} onChange={setAgent} options={[{ value: '', label: 'Everyone' }, ...(d?.facets.agents ?? []).map((a) => ({ value: a.id, label: a.name }))]} />
        <SelectFilter label="Area" value={area} onChange={setArea} options={[{ value: '', label: 'All areas' }, ...(d?.facets.areas ?? []).map((a) => ({ value: a, label: a }))]} />
        <SelectFilter label="Type" value={type} onChange={setType} options={[{ value: '', label: 'All types' }, ...(d?.facets.types ?? []).map((a) => ({ value: a, label: humanize(a) }))]} />
        <DateFilter label="Registered" value={period} onChange={setPeriod} />
      </FilterPanel>
      <PagedTable list={list} columns={columns} rowKey={(r) => r.id} caption="Businesses" download="businesses" onOpen={(r) => navigate(to('C-Business', { id: r.id }))} />
      <div className="three-col">
        <Card title="By type">
          {(d?.byType ?? []).map((t) => (
            <div className="row" key={t.name} style={{ justifyContent: 'space-between' }}>
              <span>{humanize(t.name)}</span>
              <b>{t.count}</b>
            </div>
          ))}
        </Card>
        <Card title="By area">
          {(d?.byArea ?? []).map((t) => (
            <div className="row" key={t.name} style={{ justifyContent: 'space-between' }}>
              <span>{t.name}</span>
              <b>{t.count}</b>
            </div>
          ))}
        </Card>
        <Card title="Repeat customers">
          <div className="num-l">{s ? `${s.repeatPercent}%` : '—'}</div>
          <p className="ceo-sub">
            {s ? `${s.hiredMoreThanOnce} of ${s.withPlacements} businesses that hired through Laboura hired more than once.` : ''} Repeat hiring is the cheapest growth.
          </p>
        </Card>
      </div>
    </div>
  );
}
