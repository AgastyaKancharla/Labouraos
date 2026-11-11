import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Card } from '../../../components/Card';
import type { Column } from '../../../components/DataTable';
import { StatGrid, StatTile } from '../../../components/StatTile';
import { StatusPill, type StatusTone } from '../../../components/Badge';
import { TopBar } from '../../../components/TopBar';
import { formatINR } from '../../../lib/format/money';
import { useScreenPath } from '../../../portals/PortalContext';
import { DateFilter, FilterPanel, HBar, Kv, OpenLink, PagedTable, SearchField, SelectFilter, humanize, rangeQuery, useCeoList, useDebounced, type ListPeriod } from '../_kit/kit';

/** Referral partners — design C-Referrals.dc.html. */
interface Row {
  id: string;
  code: string;
  name: string;
  type: string;
  role: string | null;
  area: string | null;
  referred: number;
  registered: number;
  joined: number;
  earnedPaise: number;
  payout: { state: 'failed' | 'due' | 'paid' | 'none'; count: number };
  checks: string;
}
interface Extra {
  best: { id: string; name: string; joined: number }[];
  fraud: { matchesStaff: number; sharedAccount: number; nameMismatch: number };
}
interface Summary {
  partners: number;
  individual: number;
  business: number;
  referredInRange: number;
  joinedInRange: number;
  payoutsDuePaise: number;
  payoutsDueCount: number;
  payoutsFailed: number;
}

const CHECKS: Record<string, { label: string; tone: StatusTone }> = {
  upi_verified: { label: 'UPI verified', tone: 'good' },
  upi_pending: { label: 'UPI being checked', tone: 'warn' },
  no_upi: { label: 'No UPI yet', tone: 'muted' },
  id_pending: { label: 'ID pending', tone: 'warn' },
  name_mismatch: { label: 'Name mismatch', tone: 'warn' },
};

function payout(r: Row) {
  if (r.payout.state === 'failed') return <StatusPill tone="danger">Failed</StatusPill>;
  if (r.payout.state === 'due') return <StatusPill tone="warn">{`${r.payout.count} due`}</StatusPill>;
  if (r.payout.state === 'paid') return <StatusPill tone="good">Paid</StatusPill>;
  return '—';
}

export default function Referrals() {
  const to = useScreenPath();
  const navigate = useNavigate();
  const [search, setSearch] = useState('');
  const [type, setType] = useState('');
  const [payoutF, setPayout] = useState('');
  const [checks, setChecks] = useState('');
  const [period, setPeriod] = useState<ListPeriod>(null);
  const q = useDebounced(search);
  const list = useCeoList<Row, Extra, Summary>('/ceo/referrals', { search: q, type, payout: payoutF, checks, ...rangeQuery(period) });
  const d = list.query.data;
  const s = d?.summary;
  const loading = list.query.isPending;
  const maxJoined = Math.max(1, ...(d?.best ?? []).map((b) => b.joined));

  const columns: Column<Row>[] = [
    { key: 'code', header: 'Code', cell: (r) => <span className="code">{r.code}</span>, csv: (r) => r.code },
    {
      key: 'partner',
      header: 'Partner',
      cell: (r) => (
        <div>
          <div style={{ fontWeight: 600 }}>{r.name}</div>
          <div className="ceo-cell-sub">{[humanize(r.role), r.area].filter((x) => x && x !== '—').join(' · ')}</div>
        </div>
      ),
      csv: (r) => r.name,
    },
    { key: 'type', header: 'Type', cell: (r) => humanize(r.type), csv: (r) => r.type, hideOnPhone: true },
    { key: 'referred', header: 'Referred', cell: (r) => r.referred, csv: (r) => r.referred },
    { key: 'registered', header: 'Registered', cell: (r) => r.registered, csv: (r) => r.registered, hideOnPhone: true },
    { key: 'joined', header: 'Joined', cell: (r) => r.joined, csv: (r) => r.joined },
    { key: 'earned', header: 'Earned', cell: (r) => formatINR(r.earnedPaise), csv: (r) => r.earnedPaise / 100, align: 'right' },
    { key: 'payout', header: 'Payout', cell: payout, csv: (r) => r.payout.state },
    { key: 'checks', header: 'Checks', cell: (r) => <StatusPill tone={CHECKS[r.checks]?.tone ?? 'muted'}>{CHECKS[r.checks]?.label ?? r.checks}</StatusPill>, csv: (r) => CHECKS[r.checks]?.label, hideOnPhone: true },
    { key: 'go', header: '', cell: (r) => <OpenLink to={to('C-Partner', { id: r.id })} /> },
  ];

  const fraud = d?.fraud;
  const fraudPill = (n: number | undefined) => <StatusPill tone={n ? 'warn' : 'good'}>{n ?? 0}</StatusPill>;
  return (
    <div className="lb-page">
      <TopBar back={{ to: to('Main'), label: 'Command Center' }} title="Referral partners" subtitle="Who sends Laboura job seekers, how many join, and what we owe them." />
      <StatGrid>
        <StatTile label="Partners" value={s?.partners ?? '—'} tone="orange" loading={loading} />
        <StatTile label="Individual / business" value={s ? `${s.individual} / ${s.business}` : '—'} tone="royal" loading={loading} />
        <StatTile label={period ? 'People referred in the period' : 'People referred'} value={s?.referredInRange ?? '—'} tone="cyan" loading={loading} />
        <StatTile label="Referred people joined" value={s?.joinedInRange ?? '—'} tone="good" loading={loading} />
        <StatTile label={`Payouts due · ${s?.payoutsDueCount ?? 0}`} value={s ? formatINR(s.payoutsDuePaise) : '—'} tone="gold" loading={loading} to={to('C-Payments-Out')} />
        <StatTile label="Payouts failed" value={s?.payoutsFailed ?? '—'} tone="red" loading={loading} />
      </StatGrid>
      <FilterPanel>
        <SearchField value={search} onChange={setSearch} placeholder="Name, phone or RF- code" />
        <SelectFilter
          label="Type"
          value={type}
          onChange={setType}
          options={[
            { value: '', label: 'All' },
            { value: 'individual', label: 'Individual' },
            { value: 'business', label: 'Business' },
          ]}
        />
        <SelectFilter
          label="Payout"
          value={payoutF}
          onChange={setPayout}
          options={[
            { value: '', label: 'Any' },
            { value: 'due', label: 'Due' },
            { value: 'failed', label: 'Failed' },
            { value: 'paid', label: 'Paid' },
          ]}
        />
        <SelectFilter
          label="Checks"
          value={checks}
          onChange={setChecks}
          options={[
            { value: '', label: 'Any' },
            { value: 'id_pending', label: 'ID pending' },
            { value: 'name_mismatch', label: 'Name mismatch' },
          ]}
        />
        <DateFilter label="Referred" value={period} onChange={setPeriod} />
      </FilterPanel>
      <PagedTable
        list={list}
        columns={columns}
        rowKey={(r) => r.id}
        caption="Referral partners"
        download="referral-partners"
        onOpen={(r) => navigate(to('C-Partner', { id: r.id }))}
        note="₹200 is paid only when a referred person joins a job · business referrals are not paid yet."
      />
      <div className="two-col">
        <Card title="Best partners">
          {(d?.best ?? []).map((b, i) => (
            <HBar key={b.id} label={b.name} value={b.joined} max={maxJoined} right={i === 0 ? `${b.joined} joined` : String(b.joined)} />
          ))}
          {d && d.best.length === 0 && <p className="ceo-sub">No referred person has joined yet.</p>}
        </Card>
        <Card title="Fraud checks">
          <Kv
            rows={[
              ['UPI matches a staff member', fraudPill(fraud?.matchesStaff)],
              ['Several partners, one account', fraudPill(fraud?.sharedAccount)],
              ['Payout name ≠ ID name', fraudPill(fraud?.nameMismatch)],
            ]}
          />
        </Card>
      </div>
    </div>
  );
}
