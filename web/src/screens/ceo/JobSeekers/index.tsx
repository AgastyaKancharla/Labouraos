import { useState } from 'react';
import { AppSignupBadge, useAppLabels } from '../../shared/AppSignupBadge';
import { useNavigate } from 'react-router-dom';
import { ButtonLink } from '../../../components/Button';
import type { Column } from '../../../components/DataTable';
import { StatGrid, StatTile } from '../../../components/StatTile';
import { StatusPill, type StatusTone } from '../../../components/Badge';
import { TopBar } from '../../../components/TopBar';
import { formatINR } from '../../../lib/format/money';
import { formatMobile } from '../../../lib/format/phone';
import { SEEKER_STATUS, guaranteePill } from '../_kit/labels';
import { homeBack, useInitialParam, useInitialPeriod, useRecordsPortal } from '../_kit/records';
import { AssignButton, SectionSwitch, sectionQuery, useSection } from '../_kit/assign';
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

/**
 * CEO Job Seekers list — design JobSeekers.dc.html. Sorted by guarantee deadline.
 * Also the Manager's list (useRecordsPortal): their tree only, no money.
 */
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
  /** Rev 211: paid, waiting for the ID check (older servers leave it out). */
  paidWaitingForId?: number;
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
  const { api: base, ceo, sections, teamLead, link, to } = useRecordsPortal();
  const [section, setSection] = useSection();
  const navigate = useNavigate();
  const [search, setSearch] = useState('');
  // "All" first (owner, testing 16 Nov): a just-registered, unpaid job seeker must not be hidden.
  const [status, setStatus] = useState(useInitialParam('status'));
  const [trade, setTrade] = useState('');
  const [kyc, setKyc] = useState('');
  const [sort, setSort] = useState('soonest');
  const [period, setPeriod] = useState<ListPeriod>(useInitialPeriod());
  // T-Home's "Paid" number: the period is the payment day (dateField=paid), not the registration day.
  const dateField = useInitialParam('dateField') === 'paid' ? 'paid' : '';
  const q = useDebounced(search);
  const list = useCeoList<JobSeekerRow, { trades: string[] }, Summary>(`${base}/job-seekers`, { search: q, status, trade, kyc, sort, ...rangeQuery(period), ...(dateField ? { dateField } : {}), ...sectionQuery(sections, section) });
  const s = list.query.data?.summary;
  const loading = list.query.isPending;
  /** A tile sets the Status filter to its own rows (click it again to show all). */
  const tile = (value: string) => () => setStatus((current) => (current === value ? '' : value));
  const nearRefund = link('C-NearRefund');
  const register = ceo ? link('CA08-Register') : null;

  const appLabels = useAppLabels('job_seeker', (list.query.data?.rows ?? []).map((r) => r.id));
  const columns: Column<JobSeekerRow>[] = [
    // Not assigned: Assign comes first, so it is in reach on a phone without scrolling the table.
    ...(sections && section === 'unassigned'
      ? [{ key: 'assign', header: '', cell: (r: JobSeekerRow) => <AssignButton kind="job_seeker" id={r.id} name={r.name} /> } satisfies Column<JobSeekerRow>]
      : []),
    { key: 'code', header: 'Code', cell: (r) => <span className="code">{r.code}</span>, csv: (r) => r.code },
    {
      key: 'name',
      header: 'Name',
      cell: (r) => (
        <div>
          <div style={{ fontWeight: 600 }}>
            {r.name}
            <AppSignupBadge label={appLabels.data?.[r.id]} />
          </div>
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
        back={homeBack(link)}
        title="Job Seekers"
        subtitle={
          ceo
            ? 'Sorted by guarantee deadline — the candidates closest to a ₹499 refund come first.'
            : 'Sorted by guarantee deadline — the candidates closest to the end of their guarantee come first.'
        }
        actions={
          <>
            {nearRefund && <ButtonLink to={nearRefund}>Close to a refund →</ButtonLink>}
            {register && (
              <ButtonLink to={register} variant="primary">
                + Register job seeker
              </ButtonLink>
            )}
          </>
        }
      />
      {sections && <SectionSwitch value={section} onChange={setSection} noun="job seekers" />}
      <StatGrid>
        <StatTile label="Active in pool" value={s?.activeInPool ?? '—'} tone="cyan" loading={loading} onClick={tile('active')} active={status === 'active'} />
        <StatTile label="Registered, not paid" value={s?.registeredNotPaid ?? '—'} tone="royal" loading={loading} onClick={tile('not_paid')} active={status === 'not_paid'} />
        <StatTile label="Waiting on KYC" value={s?.waitingOnKyc ?? '—'} tone="gold" loading={loading} onClick={tile('waiting_kyc')} active={status === 'waiting_kyc'} />
        {/* Rev 211: paid, the ID check has not passed — not active, the 30 days have not started (view only). */}
        <StatTile label="Paid, waiting for ID" value={s?.paidWaitingForId ?? '—'} tone="orange" loading={loading} onClick={tile('paid_waiting_id')} active={status === 'paid_waiting_id'} />
        <StatTile label="Within 5 days of refund" value={s?.withinFiveDaysOfRefund ?? '—'} tone="orange" loading={loading} to={nearRefund ?? undefined} />
        <StatTile label="At 2 of 3 hits" value={s?.atTwoOfThreeHits ?? '—'} tone="gold" loading={loading} onClick={tile('two_hits')} active={status === 'two_hits'} />
        <StatTile
          label="Deactivated this month"
          value={s?.deactivatedThisMonth ?? '—'}
          tone="red"
          loading={loading}
          onClick={tile('deactivated_this_month')}
          active={status === 'deactivated_this_month'}
        />
      </StatGrid>
      <FilterPanel>
        <SearchField value={search} onChange={setSearch} placeholder="Name, phone or JS- code" />
        <SelectFilter
          label="Status"
          value={status}
          onChange={setStatus}
          options={[
            { value: '', label: 'All' },
            { value: 'active', label: 'Active' },
            { value: 'not_paid', label: 'Registered, not paid' },
            { value: 'paid_waiting_id', label: 'Paid, waiting for ID' },
            { value: 'waiting_kyc', label: 'Waiting on KYC' },
            { value: 'two_hits', label: 'At 2 of 3 hits' },
            { value: 'placed', label: 'Placed' },
            { value: 'paused', label: 'Paused' },
            { value: 'deactivated', label: 'Deactivated' },
            { value: 'deactivated_this_month', label: 'Deactivated this month' },
            { value: 'closed', label: 'Closed' },
            { value: 'refunded', label: 'Refunded' },
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
        <DateFilter label={dateField ? 'Paid' : 'Registered'} value={period} onChange={setPeriod} />
      </FilterPanel>
      <PagedTable
        list={list}
        columns={columns}
        rowKey={(r) => r.id}
        caption="Job seekers"
        download="job-seekers"
        onOpen={(r) => navigate(to('C-JobSeeker', { id: r.id }))}
        note={
          ceo
            ? 'Full phone numbers are shown only to the CEO; every view is logged.'
            : section === 'unassigned'
              ? 'Phone numbers show the last 4 digits. Job seekers nobody registered or was given yet.'
              : teamLead
                ? 'Phone numbers show the last 4 digits. Job seekers you or your agents registered or were given.'
                : 'Phone numbers show the last 4 digits. Job seekers your teams registered or were given.'
        }
      />
    </div>
  );
}
