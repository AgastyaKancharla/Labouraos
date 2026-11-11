import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ButtonLink } from '../../../components/Button';
import type { Column } from '../../../components/DataTable';
import { StatGrid, StatTile } from '../../../components/StatTile';
import { StatusPill, type StatusTone } from '../../../components/Badge';
import { TopBar } from '../../../components/TopBar';
import { formatINR } from '../../../lib/format/money';
import { formatMobile } from '../../../lib/format/phone';
import { useScreenPath } from '../../../portals/PortalContext';
import { SEEKER_STATUS, guaranteePill } from '../_kit/labels';
import {
  DateFilter,
  FilterPanel,
  Hits,
  OpenLink,
  PagedTable,
  SearchField,
  SelectFilter,
  facetOptions,
  rangeQuery,
  useCeoList,
  useDebounced,
  type ListPeriod,
} from '../_kit/kit';

/** CEO Job Seekers list — design JobSeekers.dc.html. Sorted by guarantee deadline. */
export interface JobSeekerRow {
  id: string;
  code: string;
  name: string;
  phone: string;
  trade: string | null;
  salaryMinPaise: number;
  salaryMaxPaise: number;
  salaryPeriod: string | null;
  status: string;
  hits: number;
  maxHits: number;
  kyc: 'verified' | 'pending' | 'failed' | 'none';
  paidAt: string | null;
  guaranteeDaysLeft: number | null;
  registeredAt: string;
  registeredBy: string | null;
}
interface Summary {
  activeInPool: number;
  registeredNotPaid: number;
  waitingOnKyc: number;
  withinFiveDaysOfRefund: number;
  atTwoOfThreeHits: number;
  deactivatedThisMonth: number;
}

const KYC: Record<JobSeekerRow['kyc'], { label: string; tone: StatusTone }> = {
  verified: { label: 'Verified', tone: 'good' },
  pending: { label: 'Pending', tone: 'warn' },
  failed: { label: 'Failed', tone: 'danger' },
  none: { label: 'Not started', tone: 'muted' },
};

function salary(r: { salaryMinPaise: number; salaryMaxPaise: number }) {
  return `${formatINR(r.salaryMinPaise)} – ${formatINR(r.salaryMaxPaise).replace('₹', '')}`;
}

export default function JobSeekersList() {
  const to = useScreenPath();
  const navigate = useNavigate();
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('active');
  const [trade, setTrade] = useState('');
  const [kyc, setKyc] = useState('');
  const [sort, setSort] = useState('soonest');
  const [period, setPeriod] = useState<ListPeriod>(null);
  const q = useDebounced(search);
  const list = useCeoList<JobSeekerRow, { trades: string[] }, Summary>('/ceo/job-seekers', { search: q, status, trade, kyc, sort, ...rangeQuery(period) });
  const s = list.query.data?.summary;
  const loading = list.query.isPending;

  const columns: Column<JobSeekerRow>[] = [
    { key: 'code', header: 'Code', cell: (r) => <span className="code">{r.code}</span>, csv: (r) => r.code },
    {
      key: 'name',
      header: 'Name',
      cell: (r) => (
        <div>
          <div style={{ fontWeight: 600 }}>{r.name}</div>
          <div className="ceo-cell-sub">{r.phone.includes('*') ? r.phone : formatMobile(r.phone.replace(/^\+91/, ''))}</div>
        </div>
      ),
      csv: (r) => `${r.name} · ${r.phone}`,
    },
    { key: 'trade', header: 'Trade', cell: (r) => r.trade ?? '—', csv: (r) => r.trade },
    { key: 'salary', header: 'Salary range / month', cell: (r) => salary(r), csv: (r) => salary(r), hideOnPhone: true },
    {
      key: 'status',
      header: 'Status',
      cell: (r) => <StatusPill tone={SEEKER_STATUS[r.status]?.tone ?? 'muted'}>{SEEKER_STATUS[r.status]?.label ?? r.status}</StatusPill>,
      csv: (r) => SEEKER_STATUS[r.status]?.label ?? r.status,
    },
    { key: 'hits', header: 'Hits', cell: (r) => <Hits count={r.hits} max={r.maxHits} />, csv: (r) => r.hits },
    { key: 'kyc', header: 'KYC', cell: (r) => <StatusPill tone={KYC[r.kyc].tone}>{KYC[r.kyc].label}</StatusPill>, csv: (r) => KYC[r.kyc].label, hideOnPhone: true },
    { key: 'guarantee', header: 'Refund guarantee', cell: (r) => guaranteePill(r.guaranteeDaysLeft), csv: (r) => r.guaranteeDaysLeft },
    { key: 'open', header: '', cell: (r) => <OpenLink to={to('C-JobSeeker', { id: r.id })} /> },
  ];

  return (
    <div className="lb-page">
      <TopBar
        back={{ to: to('Main'), label: 'Command Center' }}
        title="Job Seekers"
        subtitle="Sorted by guarantee deadline — the candidates closest to a ₹499 refund come first."
        actions={<ButtonLink to={to('C-NearRefund')}>Close to a refund →</ButtonLink>}
      />
      <StatGrid>
        <StatTile label="Active in pool" value={s?.activeInPool ?? '—'} tone="cyan" loading={loading} />
        <StatTile label="Registered, not paid" value={s?.registeredNotPaid ?? '—'} tone="royal" loading={loading} />
        <StatTile label="Waiting on KYC" value={s?.waitingOnKyc ?? '—'} tone="gold" loading={loading} />
        <StatTile label="Within 5 days of refund" value={s?.withinFiveDaysOfRefund ?? '—'} tone="orange" loading={loading} to={to('C-NearRefund')} />
        <StatTile label="At 2 of 3 hits" value={s?.atTwoOfThreeHits ?? '—'} tone="gold" loading={loading} />
        <StatTile label="Deactivated this month" value={s?.deactivatedThisMonth ?? '—'} tone="red" loading={loading} />
      </StatGrid>
      <FilterPanel>
        <SearchField value={search} onChange={setSearch} placeholder="Name, phone or JS- code" />
        <SelectFilter
          label="Status"
          value={status}
          onChange={setStatus}
          options={[
            { value: 'active', label: 'Active' },
            { value: '', label: 'All' },
            { value: 'not_paid', label: 'Registered, not paid' },
            { value: 'placed', label: 'Placed' },
            { value: 'paused', label: 'Paused' },
            { value: 'deactivated', label: 'Deactivated' },
            { value: 'closed', label: 'Closed' },
          ]}
        />
        <SelectFilter label="Trade" value={trade} onChange={setTrade} options={facetOptions('All trades', list.query.data?.trades)} />
        <SelectFilter
          label="KYC"
          value={kyc}
          onChange={setKyc}
          options={[
            { value: '', label: 'Any' },
            { value: 'verified', label: 'Verified' },
            { value: 'pending', label: 'Pending' },
          ]}
        />
        <SelectFilter
          label="Guarantee clock"
          value={sort}
          onChange={setSort}
          options={[
            { value: 'soonest', label: 'Soonest first' },
            { value: 'latest', label: 'Latest first' },
            { value: 'newest', label: 'Newest registrations' },
          ]}
        />
        <DateFilter label="Registered" value={period} onChange={setPeriod} />
      </FilterPanel>
      <PagedTable
        list={list}
        columns={columns}
        rowKey={(r) => r.id}
        caption="Job seekers"
        download="job-seekers"
        onOpen={(r) => navigate(to('C-JobSeeker', { id: r.id }))}
        note="Full phone numbers are shown only to the CEO; every view is logged."
      />
    </div>
  );
}
