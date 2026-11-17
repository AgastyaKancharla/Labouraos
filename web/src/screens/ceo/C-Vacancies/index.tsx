import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Card } from '../../../components/Card';
import type { Column } from '../../../components/DataTable';
import { StatGrid, StatTile } from '../../../components/StatTile';
import { StatusPill } from '../../../components/Badge';
import { TopBar } from '../../../components/TopBar';
import { formatINR } from '../../../lib/format/money';
import { homeBack, useInitialParam, useInitialPeriod, useRecordsPortal } from '../_kit/records';
import { SectionSwitch, sectionQuery, useSection } from '../_kit/assign';
import { DateFilter, FilterPanel, HBar, Kv, OpenLink, PagedTable, SearchField, SelectFilter, facetOptions, humanize, rangeQuery, useCeoList, useDebounced, type ListPeriod } from '../_kit/kit';
import { VACANCY_STATUS } from '../_kit/labels';

/** CEO Vacancies list — design C-Vacancies.dc.html. */
interface Row {
  id: string;
  code: string;
  trade: string;
  role: string;
  headcount: number;
  business: { id: string; name: string; locality: string | null };
  area: string | null;
  salaryMinPaise: number | null;
  salaryMaxPaise: number | null;
  belowLegalMinimum: boolean;
  replacement: boolean;
  openDays: number;
  matches: number;
  shown: number;
  interviews: number;
  status: string;
}
interface Extra {
  whyOpen: { shortTrades: string[]; slowOwners: string[]; slowOwnerCount: number };
  timeToFillByTrade: { trade: string; days: number }[];
  facets: { trades: string[]; areas: string[] };
}
interface Summary {
  open: number;
  openPositions: number;
  openOver15Days: number;
  replacements: number;
  averageDaysToFill: number | null;
  fillRatePercent: number;
  belowLegalMinimum: number;
}

function salaryRange(min: number | null, max: number | null): string {
  if (min === null && max === null) return '—';
  if (min !== null && max !== null) return `${formatINR(min)}–${formatINR(max).replace('₹', '')}`;
  return formatINR((min ?? max) as number);
}

function statusPill(r: Row) {
  if (r.status === 'open' && r.openDays > 15) return <StatusPill tone="crit">Over 15 days open</StatusPill>;
  if (r.status === 'open' && r.replacement) return <StatusPill tone="warn">Replacement</StatusPill>;
  const s = VACANCY_STATUS[r.status];
  return <StatusPill tone={s?.tone ?? 'muted'}>{s?.label ?? humanize(r.status)}</StatusPill>;
}

export default function VacanciesList() {
  const { api: base, sections, link, to } = useRecordsPortal();
  const [section, setSection] = useSection();
  const navigate = useNavigate();
  const [search, setSearch] = useState('');
  // "All" by default (owner, testing 16 Nov): nothing is hidden until a filter or tile is chosen.
  const [status, setStatus] = useState(useInitialParam('status'));
  const [trade, setTrade] = useState('');
  const [area, setArea] = useState('');
  const [age, setAge] = useState('');
  const [period, setPeriod] = useState<ListPeriod>(useInitialPeriod());
  const q = useDebounced(search);
  const list = useCeoList<Row, Extra, Summary>(`${base}/vacancies`, { search: q, status: status || 'all', trade, area, age, ...rangeQuery(period), ...sectionQuery(sections, section) });
  const d = list.query.data;
  const s = d?.summary;
  const loading = list.query.isPending;
  /** A tile sets the filters to its own rows (click it again to show all). */
  const tileKey = `${status}|${age}`;
  const tile = (nextStatus: string, nextAge = '') => () => {
    const same = tileKey === `${nextStatus}|${nextAge}`;
    setStatus(same ? '' : nextStatus);
    setAge(same ? '' : nextAge);
  };
  const maxDays = Math.max(1, ...(d?.timeToFillByTrade ?? []).map((t) => t.days));

  const columns: Column<Row>[] = [
    { key: 'code', header: 'Code', cell: (r) => <span className="code">{r.code}</span>, csv: (r) => r.code },
    {
      key: 'vacancy',
      header: 'Vacancy',
      cell: (r) => (
        <div>
          <div style={{ fontWeight: 600 }}>
            {r.role}
            {r.headcount > 1 ? ` × ${r.headcount}` : ''}
          </div>
          <div className="ceo-cell-sub">
            {r.business.name}
            {r.area ? ` · ${r.area}` : ''}
          </div>
        </div>
      ),
      csv: (r) => `${r.role} x${r.headcount} · ${r.business.name}`,
    },
    { key: 'salary', header: 'Salary / month', cell: (r) => salaryRange(r.salaryMinPaise, r.salaryMaxPaise), csv: (r) => salaryRange(r.salaryMinPaise, r.salaryMaxPaise), hideOnPhone: true },
    { key: 'wage', header: 'Wage check', cell: (r) => (r.belowLegalMinimum ? <StatusPill tone="warn">Below legal min</StatusPill> : '—'), csv: (r) => (r.belowLegalMinimum ? 'Below legal minimum' : ''), hideOnPhone: true },
    { key: 'open', header: 'Open for', cell: (r) => (r.openDays === 1 ? '1 day' : `${r.openDays} days`), csv: (r) => r.openDays },
    { key: 'matches', header: 'Matches', cell: (r) => r.matches, csv: (r) => r.matches, hideOnPhone: true },
    { key: 'shown', header: 'Shown', cell: (r) => r.shown, csv: (r) => r.shown, hideOnPhone: true },
    { key: 'interviews', header: 'Interviews', cell: (r) => r.interviews, csv: (r) => r.interviews, hideOnPhone: true },
    { key: 'status', header: 'Status', cell: statusPill, csv: (r) => VACANCY_STATUS[r.status]?.label ?? r.status },
    { key: 'go', header: '', cell: (r) => <OpenLink to={to('C-Vacancy', { id: r.id })} /> },
  ];

  return (
    <div className="lb-page">
      <TopBar back={homeBack(link)} title="Vacancies" subtitle="Every job, how long it has been open and how close it is to being filled." />
      {sections && <SectionSwitch value={section} onChange={setSection} noun="vacancies" />}
      <StatGrid>
        <StatTile label={`Open · ${s?.openPositions ?? 0} positions`} value={s?.open ?? '—'} tone="gold" loading={loading} onClick={tile('open')} active={tileKey === 'open|'} />
        <StatTile label="Open more than 15 days" value={s?.openOver15Days ?? '—'} tone="orange" loading={loading} onClick={tile('open', 'over_15')} active={tileKey === 'open|over_15'} />
        <StatTile label="Replacements" value={s?.replacements ?? '—'} tone="royal" loading={loading} onClick={tile('replacement')} active={tileKey === 'replacement|'} />
        <StatTile label="Average time to fill" value={s?.averageDaysToFill !== null && s?.averageDaysToFill !== undefined ? `${s.averageDaysToFill} days` : '—'} tone="cyan" loading={loading} />
        <StatTile label="Fill rate (this month)" value={s ? `${s.fillRatePercent}%` : '—'} tone="good" loading={loading} />
        <StatTile label="Below legal minimum wage" value={s?.belowLegalMinimum ?? '—'} tone="red" loading={loading} onClick={tile('below_minimum')} active={tileKey === 'below_minimum|'} />
      </StatGrid>
      <FilterPanel>
        <SearchField value={search} onChange={setSearch} placeholder="Business, trade or VC- code" />
        <SelectFilter
          label="Status"
          value={status}
          onChange={setStatus}
          options={[
            { value: '', label: 'All' },
            { value: 'open', label: 'Open' },
            { value: 'replacement', label: 'Open replacements' },
            { value: 'below_minimum', label: 'Open, below legal minimum wage' },
            { value: 'filled', label: 'Filled' },
            { value: 'closed', label: 'Closed' },
            { value: 'draft', label: 'Draft / waiting for owner OTP' },
          ]}
        />
        <SelectFilter label="Trade" value={trade} onChange={setTrade} options={facetOptions('All trades', d?.facets.trades)} />
        <SelectFilter label="Area" value={area} onChange={setArea} options={facetOptions('All areas', d?.facets.areas)} />
        <SelectFilter
          label="Age"
          value={age}
          onChange={setAge}
          options={[
            { value: '', label: 'Any' },
            { value: 'over_15', label: 'Over 15 days' },
          ]}
        />
        <DateFilter label="Added" value={period} onChange={setPeriod} />
      </FilterPanel>
      <PagedTable
        list={list}
        columns={columns}
        rowKey={(r) => r.id}
        caption="Vacancies"
        download="vacancies"
        onOpen={(r) => navigate(to('C-Vacancy', { id: r.id }))}
        note="Matches = active job seekers in the same trade; the matching page narrows them by distance, salary and shift."
      />
      <div className="two-col">
        <Card title="Why vacancies stay open">
          <Kv
            rows={[
              ['Not enough candidates in the trade', d?.whyOpen.shortTrades.length ? d.whyOpen.shortTrades.join(', ') : 'None'],
              ['Below legal minimum wage', s ? `${s.belowLegalMinimum} vacancies` : '—'],
              ['Owner slow to record results', d?.whyOpen.slowOwnerCount ? `${d.whyOpen.slowOwnerCount} business${d.whyOpen.slowOwnerCount > 1 ? 'es' : ''} · ${d.whyOpen.slowOwners.join(', ')}` : 'None'],
            ]}
          />
        </Card>
        <Card title="Time to fill by trade" aside="this month">
          {(d?.timeToFillByTrade ?? []).map((t) => (
            <HBar key={t.trade} label={t.trade} value={t.days} max={maxDays} right={`${t.days} days`} warm={t.days > 10} />
          ))}
          {d && d.timeToFillByTrade.length === 0 && <p className="ceo-sub">No vacancies filled this month yet.</p>}
        </Card>
      </div>
    </div>
  );
}
