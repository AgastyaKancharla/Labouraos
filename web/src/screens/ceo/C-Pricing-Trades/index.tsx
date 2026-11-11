import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Button } from '../../../components/Button';
import { Card } from '../../../components/Card';
import { DataTable, type Column } from '../../../components/DataTable';
import { Modal } from '../../../components/Modal';
import { StatusPill } from '../../../components/Badge';
import { MoneyField, SelectField, TextField } from '../../../components/fields';
import { TopBar } from '../../../components/TopBar';
import { useToast } from '../../../components/Toast';
import { api } from '../../../lib/api/client';
import { ApiError } from '../../../lib/api/errors';
import { formatINR } from '../../../lib/format/money';
import { useScreenPath } from '../../../portals/PortalContext';
import { ActionButton } from '../_kit/actions';
import { PricingTabs } from '../_kit/tabs';

/** Trades & salary ranges — design C-Pricing-Trades.dc.html. The one trade list every form uses. */
interface Trade {
  id: string;
  name: string;
  nameKey: string;
  salaryMinPaise: number;
  salaryMaxPaise: number;
  minimumWageLevel: string;
  active: boolean;
  sortOrder: number;
}
interface Suggestion {
  id: string;
  typedName: string;
  typedByStaffId: string | null;
  status: string;
  subjects: unknown[];
}
interface Counts {
  rows: { nameKey: string; candidates: number; openVacancies: number }[];
}
type Row = Trade & { candidates: number; openVacancies: number };

const LEVELS = [
  { value: 'unskilled', label: 'Unskilled' },
  { value: 'semi_skilled', label: 'Semi-skilled' },
  { value: 'skilled', label: 'Skilled' },
  { value: 'highly_skilled', label: 'Highly skilled' },
];

export default function Trades() {
  const to = useScreenPath();
  const trades = useQuery({ queryKey: ['trades', 'manage'], queryFn: () => api.get<Trade[]>('/trades/manage') });
  const suggestions = useQuery({ queryKey: ['trades', 'suggestions'], queryFn: () => api.get<Suggestion[]>('/trades/suggestions') });
  const counts = useQuery({ queryKey: ['ceo', 'pricing', 'trades'], queryFn: () => api.get<Counts>('/ceo/pricing/trades') });
  const team = useQuery({ queryKey: ['ceo', 'team'], queryFn: () => api.get<{ rows: { id: string; name: string }[] }>('/ceo/team') });
  const [editing, setEditing] = useState<Trade | 'new' | { suggestion: Suggestion } | null>(null);
  const rows: Row[] | undefined = trades.data?.map((t) => {
    const c = counts.data?.rows.find((x) => x.nameKey === t.nameKey);
    return { ...t, candidates: c?.candidates ?? 0, openVacancies: c?.openVacancies ?? 0 };
  });
  const active = (trades.data ?? []).filter((t) => t.active);
  const who = (id: string | null) => team.data?.rows.find((r) => r.id === id)?.name ?? 'an agent';
  const columns: Column<Row>[] = [
    { key: 'name', header: 'Trade', cell: (r) => <strong>{r.name}</strong>, filter: 'text', filterValue: (r) => r.name, sortValue: (r) => r.name, csv: (r) => r.name },
    { key: 'range', header: 'Typical salary / month', cell: (r) => `${formatINR(r.salaryMinPaise)} – ${formatINR(r.salaryMaxPaise)}`, sortValue: (r) => r.salaryMinPaise, csv: (r) => `${r.salaryMinPaise / 100}-${r.salaryMaxPaise / 100}` },
    { key: 'level', header: 'Minimum wage level', cell: (r) => LEVELS.find((l) => l.value === r.minimumWageLevel)?.label ?? r.minimumWageLevel, filter: 'select', filterValue: (r) => r.minimumWageLevel, csv: (r) => r.minimumWageLevel, hideOnPhone: true },
    { key: 'pool', header: 'Candidates in pool', cell: (r) => r.candidates, sortValue: (r) => r.candidates, csv: (r) => r.candidates, align: 'right' },
    { key: 'open', header: 'Open positions', cell: (r) => r.openVacancies, sortValue: (r) => r.openVacancies, csv: (r) => r.openVacancies, align: 'right' },
    { key: 'status', header: 'Status', cell: (r) => (r.active ? <StatusPill tone="good">On the forms</StatusPill> : <StatusPill tone="muted">Switched off</StatusPill>), filter: 'select', filterValue: (r) => (r.active ? 'On' : 'Off'), csv: (r) => (r.active ? 'on' : 'off') },
    {
      key: 'act',
      header: '',
      cell: (r) => (
        <div className="ceo-actions" onClick={(e) => e.stopPropagation()}>
          <Button onClick={() => setEditing(r)}>Edit</Button>
          {r.active ? (
            <ActionButton label="Switch off" variant="danger" title={`Take ${r.name} off the forms`} description="Existing job seekers and vacancies keep it; agents can no longer pick it." run={() => api.patch(`/trades/${r.id}/deactivate`)} success={`${r.name} switched off`} />
          ) : (
            <ActionButton label="Switch on" title={`Put ${r.name} back on the forms`} run={() => api.patch(`/trades/${r.id}`, { active: true })} success={`${r.name} is back on the forms`} />
          )}
        </div>
      ),
    },
  ];
  return (
    <div className="lb-page">
      <TopBar
        back={{ to: to('C-Pricing'), label: 'Pricing & policy' }}
        title="Trades & salary ranges"
        subtitle="The one trade list every form uses, with the usual Bengaluru pay for each."
        actions={<Button variant="primary" onClick={() => setEditing('new')}>+ Add trade</Button>}
      />
      <PricingTabs />
      {(suggestions.data?.length ?? 0) > 0 && (
        <Card title={`Typed by agents · waiting for you (${suggestions.data!.length})`}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {suggestions.data!.map((s) => (
              <div key={s.id} className="ceo-rule-row">
                <span>
                  “{s.typedName}” · {who(s.typedByStaffId)} · {s.subjects.length || 1} record{s.subjects.length === 1 ? '' : 's'}
                </span>
                <Button onClick={() => setEditing({ suggestion: s })}>Add</Button>
                <span className="ceo-actions">
                  <ActionButton label="Map to…" title={`Map “${s.typedName}” to a trade on the list`} description="Every record that typed it moves to the trade you pick." choice={{ label: 'Trade', options: active.map((t) => ({ value: t.id, label: t.name })) }} run={({ choice }) => api.post(`/trades/suggestions/${s.id}/map`, { tradeId: choice })} success="Mapped" />
                  <ActionButton label="Dismiss" variant="danger" title={`Dismiss “${s.typedName}”`} run={() => api.post(`/trades/suggestions/${s.id}/dismiss`)} success="Dismissed" />
                </span>
              </div>
            ))}
          </div>
        </Card>
      )}
      <div className="panel" style={{ padding: '6px 18px 14px' }}>
        <DataTable columns={columns} rows={rows} rowKey={(r) => r.id} caption="Trades" loading={trades.isPending} error={trades.error} onRetry={() => void trades.refetch()} download="trades" pageSize={50} emptyTitle="No trades yet." />
        <div className="ceo-note">The salary range shows as a hint on every form; a job seeker's guarantee floor is the lower of his minimum and the top of the range.</div>
      </div>
      {editing && <TradeForm editing={editing} onClose={() => setEditing(null)} />}
    </div>
  );
}

function TradeForm({ editing, onClose }: { editing: Trade | 'new' | { suggestion: Suggestion }; onClose: () => void }) {
  const trade = typeof editing === 'object' && 'id' in editing ? editing : null;
  const suggestion = typeof editing === 'object' && 'suggestion' in editing ? editing.suggestion : null;
  const [name, setName] = useState(trade?.name ?? suggestion?.typedName ?? '');
  const [min, setMin] = useState<number | null>(trade?.salaryMinPaise ?? null);
  const [max, setMax] = useState<number | null>(trade?.salaryMaxPaise ?? null);
  const [level, setLevel] = useState(trade?.minimumWageLevel ?? 'unskilled');
  const toast = useToast();
  const qc = useQueryClient();
  const save = useMutation({
    mutationFn: () => {
      const body = { salaryMinPaise: min, salaryMaxPaise: max, minimumWageLevel: level };
      if (suggestion) return api.post(`/trades/suggestions/${suggestion.id}/add`, body);
      if (trade) return api.patch(`/trades/${trade.id}`, { name: name.trim(), ...body });
      return api.post('/trades', { name: name.trim(), ...body });
    },
    onSuccess: () => {
      toast.success('Trade saved');
      void qc.invalidateQueries({ queryKey: ['trades'] });
      void qc.invalidateQueries({ queryKey: ['ceo'] });
      onClose();
    },
    onError: (e) => toast.error(e instanceof ApiError ? e.message : 'Could not save. Try again.'),
  });
  const bad = !name.trim() || min === null || max === null || min > max;
  return (
    <Modal
      open
      onClose={onClose}
      title={trade ? `Edit ${trade.name}` : suggestion ? `Add “${suggestion.typedName}”` : 'Add a trade'}
      dismissible={!save.isPending}
      footer={
        <>
          <Button onClick={onClose} disabled={save.isPending}>Cancel</Button>
          <Button variant="primary" onClick={() => save.mutate()} loading={save.isPending} disabled={bad}>Save</Button>
        </>
      }
    >
      <TextField label="Trade" value={name} onChange={setName} disabled={Boolean(suggestion)} required />
      <MoneyField label="Typical salary from (a month)" value={min} onChange={setMin} required />
      <MoneyField label="Typical salary to (a month)" value={max} onChange={setMax} required error={min !== null && max !== null && min > max ? 'The top of the range is below the bottom' : undefined} />
      <SelectField label="Legal minimum wage level" value={level} onChange={(v) => setLevel(v || 'unskilled')} options={LEVELS} placeholder={null} />
    </Modal>
  );
}
