import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Card } from '../../../components/Card';
import type { Column } from '../../../components/DataTable';
import { StatGrid, StatTile } from '../../../components/StatTile';
import { StatusPill } from '../../../components/Badge';
import { TopBar } from '../../../components/TopBar';
import { formatINR } from '../../../lib/format/money';
import { useScreenPath } from '../../../portals/PortalContext';
import { DateFilter, FilterPanel, Kv, OpenLink, PagedTable, SearchField, SelectFilter, dateOrDash, facetOptions, humanize, rangeQuery, useCeoList, useDebounced, type ListPeriod } from '../_kit/kit';
import { PLACEMENT_STAGE } from '../_kit/labels';
import { PlacementTabs } from '../_kit/tabs';

/** CEO Placements list — design C-Placements.dc.html. */
interface Row {
  id: string;
  code: string;
  jobSeeker: { id: string; code: string; name: string };
  business: { id: string; code: string; name: string };
  trade: string;
  salaryPaise: number;
  feePaise: number;
  gstPaise: number;
  joinedDate: string | null;
  guaranteeDay: number | null;
  guaranteeDays: number;
  replacementNumber: number;
  stage: string;
}
interface Extra {
  whyLeft: { name: string; count: number }[];
  replacements: { freeThisMonth: number; refundsAfterSearchThisMonth: number; refundableFromSearchPaise: number; reachDeadlineIn3Days: number; searchDays: number };
  facets: { trades: string[] };
}
interface Summary {
  working: number;
  joinedThisMonth: number;
  inReplacementSearch: number;
  clockPaused: number;
  cleared: number;
  stillWorkingAtDay60Percent: number;
  feePercent: number;
  gstPercent: number;
}

export default function PlacementsList() {
  const to = useScreenPath();
  const navigate = useNavigate();
  const [search, setSearch] = useState('');
  const [stage, setStage] = useState('');
  const [trade, setTrade] = useState('');
  const [period, setPeriod] = useState<ListPeriod>(null);
  const q = useDebounced(search);
  const list = useCeoList<Row, Extra, Summary>('/ceo/placements', { search: q, stage, trade, ...rangeQuery(period) });
  const d = list.query.data;
  const s = d?.summary;
  const loading = list.query.isPending;

  const columns: Column<Row>[] = [
    { key: 'code', header: 'Code', cell: (r) => <span className="code">{r.code}</span>, csv: (r) => r.code },
    {
      key: 'candidate',
      header: 'Candidate',
      cell: (r) => (
        <div>
          <div style={{ fontWeight: 600 }}>{r.jobSeeker.name}</div>
          <div className="ceo-cell-sub">{r.trade}</div>
        </div>
      ),
      csv: (r) => `${r.jobSeeker.code} ${r.jobSeeker.name}`,
    },
    { key: 'business', header: 'Business', cell: (r) => r.business.name, csv: (r) => r.business.name },
    { key: 'salary', header: 'Salary', cell: (r) => formatINR(r.salaryPaise), csv: (r) => r.salaryPaise / 100, align: 'right', hideOnPhone: true },
    { key: 'fee', header: 'Fee + GST', cell: (r) => formatINR(r.feePaise + r.gstPaise), csv: (r) => (r.feePaise + r.gstPaise) / 100, align: 'right' },
    { key: 'joined', header: 'Joined', cell: (r) => dateOrDash(r.joinedDate), csv: (r) => r.joinedDate, hideOnPhone: true },
    {
      key: 'guarantee',
      header: 'Guarantee',
      cell: (r) => (r.guaranteeDay ? `Day ${r.guaranteeDay} of ${r.guaranteeDays}${r.replacementNumber ? ` · replacement ${r.replacementNumber}` : ''}` : '—'),
      csv: (r) => r.guaranteeDay,
      hideOnPhone: true,
    },
    { key: 'status', header: 'Status', cell: (r) => <StatusPill tone={PLACEMENT_STAGE[r.stage]?.tone ?? 'muted'}>{PLACEMENT_STAGE[r.stage]?.label ?? humanize(r.stage)}</StatusPill>, csv: (r) => PLACEMENT_STAGE[r.stage]?.label },
    { key: 'go', header: '', cell: (r) => <OpenLink to={to('C-Placement', { id: r.id })} /> },
  ];
  const rep = d?.replacements;

  return (
    <div className="lb-page">
      <TopBar back={{ to: to('Main'), label: 'Command Center' }} title="Placements" subtitle="Everyone placed through Laboura, where their 60-day guarantee stands, and what the business paid." />
      <PlacementTabs />
      <StatGrid>
        <StatTile label="Working now" value={s?.working ?? '—'} tone="navy" loading={loading} />
        <StatTile label="Joined this month" value={s?.joinedThisMonth ?? '—'} tone="good" loading={loading} />
        <StatTile label="In replacement search" value={s?.inReplacementSearch ?? '—'} tone="orange" loading={loading} to={to('C-Claims')} />
        <StatTile label="Clock paused" value={s?.clockPaused ?? '—'} tone="red" loading={loading} />
        <StatTile label="Cleared the 60-day guarantee" value={s?.cleared ?? '—'} tone="cyan" loading={loading} />
        <StatTile label="Still working at day 60" value={s ? `${s.stillWorkingAtDay60Percent}%` : '—'} tone="good" loading={loading} />
      </StatGrid>
      <FilterPanel>
        <SearchField value={search} onChange={setSearch} placeholder="Candidate, business or PL- code" />
        <SelectFilter
          label="Stage"
          value={stage}
          onChange={setStage}
          options={[
            { value: '', label: 'All' },
            { value: 'awaiting_payment', label: 'Waiting for fee' },
            { value: 'paid_not_joined', label: 'Paid, not joined' },
            { value: 'working', label: 'Working' },
            { value: 'replacement', label: 'Replacement' },
            { value: 'cleared', label: 'Cleared' },
            { value: 'refunded', label: 'Refunded' },
            { value: 'ended', label: 'Ended / replaced / cancelled' },
          ]}
        />
        <SelectFilter label="Trade" value={trade} onChange={setTrade} options={facetOptions('All trades', d?.facets.trades)} />
        <DateFilter label="Joined" value={period} onChange={setPeriod} />
      </FilterPanel>
      <PagedTable
        list={list}
        columns={columns}
        rowKey={(r) => r.id}
        caption="Placements"
        download="placements"
        onOpen={(r) => navigate(to('C-Placement', { id: r.id }))}
        note={`Fee is ${s?.feePercent ?? 50}% of the first month's salary + ${s?.gstPercent ?? 18}% GST.`}
      />
      <div className="two-col">
        <Card title="Why people left (this month)">
          {d && d.whyLeft.length === 0 ? <p className="ceo-sub">No one left this month.</p> : <Kv rows={(d?.whyLeft ?? []).map((w) => [humanize(w.name), String(w.count)] as [string, string])} />}
        </Card>
        <Card title="Replacements">
          <Kv
            rows={[
              ['Free replacements given', rep ? `${rep.freeThisMonth} this month` : '—'],
              [`Refunds after ${rep?.searchDays ?? 15} days without a replacement`, rep ? String(rep.refundsAfterSearchThisMonth) : '—'],
              [`₹ that becomes refundable from day ${rep?.searchDays ?? 15}`, rep ? `${formatINR(rep.refundableFromSearchPaise)}${rep.reachDeadlineIn3Days ? ` (${rep.reachDeadlineIn3Days} reach day ${rep.searchDays} in 3 days)` : ''}` : '—'],
            ]}
          />
        </Card>
      </div>
    </div>
  );
}
