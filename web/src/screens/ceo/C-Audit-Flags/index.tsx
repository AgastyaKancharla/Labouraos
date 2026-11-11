import { useState } from 'react';
import type { Column } from '../../../components/DataTable';
import { StatGrid, StatTile } from '../../../components/StatTile';
import { StatusPill } from '../../../components/Badge';
import { TopBar } from '../../../components/TopBar';
import { api } from '../../../lib/api/client';
import { formatDateTimeIST } from '../../../lib/format/date';
import { useScreenPath } from '../../../portals/PortalContext';
import { ActionButton } from '../_kit/actions';
import { FilterPanel, PagedTable, SearchField, SelectFilter, facetOptions, humanize, useCeoList, useDebounced } from '../_kit/kit';
import { AuditTabs } from '../_kit/tabs';

/** Flags — design C-Audit-Flags.dc.html. Possible fraud, bypass and quality problems, most serious first. */
interface Row {
  id: string;
  code: string;
  kind: string;
  subjectType: string;
  subjectId: string;
  subject: { code: string | null; name: string | null };
  raisedFor: { id: string; name: string; role: string } | null;
  details: unknown;
  severity: 'high' | 'medium' | 'low';
  owner: string;
  status: 'open' | 'resolved' | 'dismissed';
  raisedAt: string;
  resolvedBy: string | null;
  resolution: string | null;
}
interface Summary {
  open: number;
  high: number;
  medium: number;
  low: number;
  closedThisMonth: number;
}
const SEV = { high: { label: 'High', tone: 'danger' }, medium: { label: 'Medium', tone: 'warn' }, low: { label: 'Low', tone: 'muted' } } as const;

/** A short line from the flag's details: the first readable text or number fields. */
function evidence(details: unknown): string {
  if (!details || typeof details !== 'object') return '—';
  const parts = Object.entries(details as Record<string, unknown>)
    .filter(([, v]) => typeof v === 'string' || typeof v === 'number')
    .slice(0, 3)
    .map(([k, v]) => `${humanize(k).toLowerCase()}: ${String(v)}`);
  return parts.length ? parts.join(' · ') : '—';
}

export default function Flags() {
  const to = useScreenPath();
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('open');
  const [severity, setSeverity] = useState('');
  const [kind, setKind] = useState('');
  const q = useDebounced(search);
  const list = useCeoList<Row, { kinds: string[] }, Summary>('/ceo/flags', { search: q, status, severity, kind });
  const s = list.query.data?.summary;
  const columns: Column<Row>[] = [
    { key: 'flag', header: 'Flag', cell: (r) => <div><div style={{ fontWeight: 600 }}>{humanize(r.kind)}</div><div className="ceo-cell-sub">{r.code} · {formatDateTimeIST(r.raisedAt)}</div></div>, csv: (r) => `${r.code} ${r.kind}` },
    { key: 'who', header: 'Who / what', cell: (r) => [r.subject.name ?? r.subject.code ?? humanize(r.subjectType), r.raisedFor?.name].filter(Boolean).join(' · '), csv: (r) => `${r.subject.code ?? ''} ${r.subject.name ?? ''} ${r.raisedFor?.name ?? ''}` },
    { key: 'evidence', header: 'Evidence', cell: (r) => evidence(r.details), csv: (r) => evidence(r.details), hideOnPhone: true },
    { key: 'sev', header: 'Severity', cell: (r) => <StatusPill tone={SEV[r.severity].tone}>{SEV[r.severity].label}</StatusPill>, csv: (r) => r.severity },
    { key: 'owner', header: 'Owner', cell: (r) => r.owner, csv: (r) => r.owner },
    { key: 'status', header: 'Status', cell: (r) => (r.status === 'open' ? <StatusPill tone="warn">Open</StatusPill> : <span className="ceo-sub">{humanize(r.status)}{r.resolvedBy ? ` by ${r.resolvedBy}` : ''}</span>), csv: (r) => r.status },
    {
      key: 'act',
      header: '',
      cell: (r) =>
        r.status === 'open' ? (
          <div className="ceo-actions" onClick={(e) => e.stopPropagation()}>
            <ActionButton label="Resolve" variant="success" title={`Resolve ${r.code}`} description="Say what was found and what was done." reason={{ label: 'What you found and did', required: true }} choice={{ label: 'Outcome', options: [{ value: 'resolved', label: 'Real problem — dealt with' }, { value: 'dismissed', label: 'Not a problem — dismiss' }] }} run={({ reason, choice }) => api.post(`/review-flags/${r.id}/resolve`, { status: choice, resolution: reason })} success="Flag closed" />
          </div>
        ) : null,
    },
  ];
  return (
    <div className="lb-page">
      <TopBar back={{ to: to('C-Audit'), label: 'Audit log' }} title="Flags" subtitle="Possible fraud, bypass and quality problems, most serious first." />
      <AuditTabs />
      <StatGrid>
        <StatTile label="Open flags" value={s?.open ?? '—'} tone="orange" loading={list.query.isPending} />
        <StatTile label="High" value={s?.high ?? '—'} tone="red" loading={list.query.isPending} />
        <StatTile label="Medium" value={s?.medium ?? '—'} tone="gold" loading={list.query.isPending} />
        <StatTile label="Closed this month" value={s?.closedThisMonth ?? '—'} tone="good" loading={list.query.isPending} />
      </StatGrid>
      <FilterPanel>
        <SearchField value={search} onChange={setSearch} placeholder="Flag code, business, person or owner" />
        <SelectFilter label="Status" value={status} onChange={setStatus} options={[{ value: 'open', label: 'Open' }, { value: 'resolved', label: 'Resolved' }, { value: 'dismissed', label: 'Dismissed' }, { value: '', label: 'All' }]} />
        <SelectFilter label="Severity" value={severity} onChange={setSeverity} options={[{ value: '', label: 'All' }, { value: 'high', label: 'High' }, { value: 'medium', label: 'Medium' }, { value: 'low', label: 'Low' }]} />
        <SelectFilter label="Kind" value={kind} onChange={setKind} options={facetOptions('All kinds', list.query.data?.kinds)} />
      </FilterPanel>
      <PagedTable list={list} columns={columns} rowKey={(r) => r.id} caption="Flags" download="flags" note="Raised automatically: bypass, fake visits (GPS, short visits, reused photos), payment problems, odd logins, payout fraud, many visits with no onboarding" />
    </div>
  );
}
