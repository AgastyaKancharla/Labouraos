import { useState } from 'react';
import type { Column } from '../../../components/DataTable';
import { StatusPill } from '../../../components/Badge';
import { TopBar } from '../../../components/TopBar';
import { formatDateTimeIST } from '../../../lib/format/date';
import { useScreenPath } from '../../../portals/PortalContext';
import { roleLabel } from '../_kit/format';
import { DateFilter, FilterPanel, PagedTable, SearchField, SelectFilter, humanize, rangeQuery, useCeoList, useDebounced, type ListPeriod } from '../_kit/kit';
import { AuditTabs } from '../_kit/tabs';

/** Audit log — design C-Audit.dc.html. Every change is recorded and can never be edited or deleted. */
interface Row {
  id: string;
  code: string;
  at: string;
  actor: { id: string; code: string | null; name: string; role: string | null };
  type: 'money' | 'corrections' | 'policy' | 'logins' | 'records';
  action: string;
  entityType: string;
  entityCode: string;
  reason: string | null;
  change: string | null;
}
const TYPE: Record<Row['type'], { label: string; tone: 'good' | 'warn' | 'info' | 'muted' | 'crit' }> = {
  money: { label: 'Money', tone: 'good' },
  corrections: { label: 'Correction', tone: 'warn' },
  policy: { label: 'Policy', tone: 'crit' },
  logins: { label: 'Login', tone: 'info' },
  records: { label: 'Record', tone: 'muted' },
};

export default function AuditLog() {
  const to = useScreenPath();
  const [search, setSearch] = useState('');
  const [who, setWho] = useState('');
  const [type, setType] = useState('');
  const [period, setPeriod] = useState<ListPeriod>(null);
  const q = useDebounced(search);
  const list = useCeoList<Row>('/ceo/audit', { search: q, who, type, ...rangeQuery(period) }, 50);
  const columns: Column<Row>[] = [
    { key: 'when', header: 'When', cell: (r) => formatDateTimeIST(r.at), csv: (r) => r.at },
    { key: 'who', header: 'Who', cell: (r) => <div><div style={{ fontWeight: 600 }}>{r.actor.name}</div><div className="ceo-cell-sub">{roleLabel(r.actor.role)}</div></div>, csv: (r) => `${r.actor.name} (${roleLabel(r.actor.role)})` },
    { key: 'type', header: 'Type', cell: (r) => <StatusPill tone={TYPE[r.type].tone}>{TYPE[r.type].label}</StatusPill>, csv: (r) => TYPE[r.type].label },
    { key: 'what', header: 'What', cell: (r) => `${humanize(r.action.replace(/[._]/g, ' '))}${r.reason ? ` (reason: ${r.reason})` : ''}`, csv: (r) => `${r.action}${r.reason ? ` (${r.reason})` : ''}` },
    { key: 'record', header: 'Record', cell: (r) => <span className="code">{r.entityCode}</span>, csv: (r) => `${r.entityType} ${r.entityCode}`, hideOnPhone: true },
    { key: 'change', header: 'Change', cell: (r) => r.change ?? '—', csv: (r) => r.change, hideOnPhone: true },
  ];
  return (
    <div className="lb-page">
      <TopBar back={{ to: to('Main'), label: 'Command Center' }} title="Audit log" subtitle="Who did what, when." />
      <AuditTabs />
      <FilterPanel>
        <SearchField value={search} onChange={setSearch} placeholder="Person, record or action" />
        <SelectFilter label="Who" value={who} onChange={setWho} options={[{ value: '', label: 'Everyone' }, { value: 'ceo', label: 'CEO-level' }, { value: 'managers', label: 'Managers' }, { value: 'team_leads', label: 'Team Leads' }, { value: 'agents', label: 'Agents' }, { value: 'finance', label: 'Finance' }]} />
        <SelectFilter label="Action" value={type} onChange={setType} options={[{ value: '', label: 'All' }, { value: 'money', label: 'Money' }, { value: 'corrections', label: 'Corrections' }, { value: 'policy', label: 'Policy' }, { value: 'logins', label: 'Logins' }, { value: 'records', label: 'Other records' }]} />
        <DateFilter value={period} onChange={setPeriod} />
      </FilterPanel>
      <PagedTable list={list} columns={columns} rowKey={(r) => r.id} caption="Audit log" download="audit-log" note="Every change is recorded and can never be edited or deleted" />
    </div>
  );
}
