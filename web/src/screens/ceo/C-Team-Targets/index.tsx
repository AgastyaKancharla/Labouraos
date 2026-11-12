import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Button } from '../../../components/Button';
import { DataTable, type Column } from '../../../components/DataTable';
import { Modal } from '../../../components/Modal';
import { StatusPill } from '../../../components/Badge';
import { TopBar } from '../../../components/TopBar';
import { useToast } from '../../../components/Toast';
import { api } from '../../../lib/api/client';
import { ApiError } from '../../../lib/api/errors';
import { istDateKey } from '../../../lib/format/date';
import { useNow } from '../../../lib/useNow';
import { useScreenPath } from '../../../portals/PortalContext';
import { ActionButton } from '../_kit/actions';
import { MonthPicker, monthName, shiftMonth } from '../_kit/month';
import { TargetTabs } from '../_kit/tabs';
import { PACE_LABEL, useTargetsBoard, type TargetRow } from '../_kit/targets';
import { CompanyPlan } from './CompanyPlan';

/** Targets — design C-Team-Targets.dc.html, with the CEO's monthly company plan on top (GET/PUT /plans/company). */
export default function Targets() {
  const to = useScreenPath();
  const thisMonth = istDateKey(useNow()).slice(0, 7);
  const [month, setMonth] = useState(thisMonth);
  const [editing, setEditing] = useState<string | null>(null);
  const board = useTargetsBoard(month);
  const next = shiftMonth(thisMonth, 1);
  const call = (r: TargetRow) => r.staff.role === 'call_agent';

  const columns: Column<TargetRow>[] = [
    { key: 'agent', header: 'Agent', cell: (r) => <div><div style={{ fontWeight: 600 }}>{r.staff.name}</div><div className="ceo-cell-sub">{r.team ?? r.staff.code}</div></div>, filter: 'text', filterValue: (r) => `${r.staff.name} ${r.staff.code}`, sortValue: (r) => r.staff.name, csv: (r) => r.staff.name },
    { key: 'role', header: 'Role', cell: (r) => (call(r) ? 'Call' : 'Field'), filter: 'select', filterValue: (r) => (call(r) ? 'Call' : 'Field'), csv: (r) => (call(r) ? 'Call' : 'Field') },
    { key: 'main', header: 'Main target', cell: (r) => `${r.main.achieved} / ${r.main.target ?? '—'} ${call(r) ? 'activated' : 'placements'}`, sortValue: (r) => r.main.achieved, csv: (r) => `${r.main.achieved}/${r.main.target ?? ''}` },
    {
      key: 'progress',
      header: 'Progress',
      cell: (r) =>
        r.progressPercent === null ? '—' : (
          <div className="hbar-row" style={{ gridTemplateColumns: '1fr 40px', minWidth: 120 }}>
            <div className="track">
              <div className={r.pace === 'behind' ? 'fill warm' : 'fill'} style={{ width: `${Math.min(100, r.progressPercent)}%` }} />
            </div>
            <b>{r.progressPercent}%</b>
          </div>
        ),
      sortValue: (r) => r.progressPercent ?? -1,
      csv: (r) => r.progressPercent,
    },
    { key: 'second', header: 'Second target', cell: (r) => `${r.second.achieved} / ${r.second.target ?? '—'} ${call(r) ? 'vacancies' : 'repeat'}`, csv: (r) => `${r.second.achieved}/${r.second.target ?? ''}`, hideOnPhone: true },
    { key: 'pace', header: 'Pace', cell: (r) => <StatusPill tone={PACE_LABEL[r.pace].tone}>{PACE_LABEL[r.pace].label}</StatusPill>, filter: 'select', filterValue: (r) => PACE_LABEL[r.pace].label, csv: (r) => PACE_LABEL[r.pace].label },
  ];

  return (
    <div className="lb-page">
      <TopBar back={{ to: to('Main'), label: 'Command Center' }} title="Targets" subtitle="Every agent's monthly targets and how far along they are." actions={<MonthPicker value={month} onChange={setMonth} />} />
      <TargetTabs />
      <CompanyPlan month={month} editable={month >= thisMonth} />
      <div className="panel" style={{ padding: '6px 18px 14px' }}>
        <DataTable columns={columns} rows={board.data?.rows} rowKey={(r) => r.staff.id} caption={`Targets ${month}`} loading={board.isPending} error={board.error} onRetry={() => void board.refetch()} download={`targets-${month}`} emptyTitle="No agents yet." />
        <div className="ceo-note">Targets are set per agent each month by the CEO or a Manager · after the 10th, anyone under 80% of pace is flagged to their Team Lead and Manager</div>
        <div className="ceo-actions" style={{ marginTop: 12 }}>
          {month >= thisMonth && (
            <Button variant="primary" onClick={() => setEditing(month)}>
              Set {monthName(month, false)} targets
            </Button>
          )}
          <Button variant="primary" onClick={() => setEditing(next)}>
            Set {monthName(next, false)} targets
          </Button>
          <ActionButton
            label={`Copy from ${monthName(thisMonth, false)}`}
            title={`Copy ${monthName(thisMonth, false)}'s targets to ${monthName(next, false)}`}
            description="Every agent with no target yet for next month gets the same numbers. Targets already set are left alone."
            run={() => {
              const [fy, fm] = thisMonth.split('-').map(Number);
              const [ty, tm] = next.split('-').map(Number);
              return api.post<{ copied: number }>('/ceo/targets/copy', { fromYear: fy, fromMonth: fm, toYear: ty, toMonth: tm });
            }}
            success={(res) => `${(res as { copied: number }).copied} targets copied`}
          />
        </div>
      </div>
      {editing && <SetTargets monthKey={editing} onClose={() => setEditing(null)} />}
    </div>
  );
}

const FIELDS = {
  call_agent: [
    ['candidatesActivated', 'Activated'],
    ['vacanciesCaptured', 'Vacancies'],
  ],
  field_agent: [
    ['placementsClosed', 'Placements'],
    ['repeatBusinesses', 'Repeat businesses'],
    ['replacementsInside15Days', 'Replacements in 15 days'],
  ],
} as const;

function SetTargets({ monthKey, onClose }: { monthKey: string; onClose: () => void }) {
  const board = useTargetsBoard(monthKey);
  const [values, setValues] = useState<Record<string, Record<string, string>>>({});
  const toast = useToast();
  const qc = useQueryClient();
  const rows = board.data?.rows ?? [];
  const valueOf = (r: TargetRow, field: string) => values[r.staff.id]?.[field] ?? String((r.target as Record<string, number | null> | null)?.[field] ?? '');
  const save = useMutation({
    mutationFn: async () => {
      const [year, month] = monthKey.split('-').map(Number);
      let saved = 0;
      for (const r of rows) {
        const changed = values[r.staff.id];
        if (!changed) continue;
        const body: Record<string, number | null> = {};
        for (const [k, v] of Object.entries(changed)) body[k] = v.trim() === '' ? null : Number(v);
        if (r.targetId) await api.patch(`/targets/${r.targetId}`, body);
        else await api.post('/targets', { staffId: r.staff.id, year, month, ...body });
        saved += 1;
      }
      return saved;
    },
    onSuccess: (saved) => {
      toast.success(`${saved} target${saved === 1 ? '' : 's'} saved`);
      void qc.invalidateQueries({ queryKey: ['ceo'] });
      onClose();
    },
    onError: (e) => toast.error(e instanceof ApiError ? e.message : 'Could not save. Try again.'),
  });
  return (
    <Modal
      open
      onClose={onClose}
      title={`${monthName(monthKey)} targets`}
      width={760}
      dismissible={!save.isPending}
      footer={
        <>
          <Button onClick={onClose} disabled={save.isPending}>
            Cancel
          </Button>
          <Button variant="primary" onClick={() => save.mutate()} loading={save.isPending} disabled={!Object.keys(values).length}>
            Save targets
          </Button>
        </>
      }
    >
      {board.isPending ? (
        <p className="ceo-sub">Loading…</p>
      ) : (
        <div className="scrollx">
          <table>
            <thead>
              <tr>
                <th>Agent</th>
                <th>Targets for the month</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.staff.id}>
                  <td>
                    {r.staff.name}
                    <div className="ceo-cell-sub">{r.staff.role === 'call_agent' ? 'Call' : 'Field'}</div>
                  </td>
                  <td>
                    <div className="ceo-inline-form">
                      {FIELDS[r.staff.role as keyof typeof FIELDS]?.map(([field, label]) => (
                        <label key={field} className="field" style={{ maxWidth: 140 }}>
                          {label}
                          <input
                            type="number"
                            min={0}
                            inputMode="numeric"
                            aria-label={`${r.staff.name} ${label}`}
                            value={valueOf(r, field)}
                            onChange={(e) => setValues((v) => ({ ...v, [r.staff.id]: { ...v[r.staff.id], [field]: e.target.value.replace(/\D/g, '') } }))}
                          />
                        </label>
                      ))}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Modal>
  );
}
