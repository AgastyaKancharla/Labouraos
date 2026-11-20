import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Button } from '../../../components/Button';
import { Card } from '../../../components/Card';
import { DataTable, type Column } from '../../../components/DataTable';
import { ErrorState } from '../../../components/ErrorState';
import { SkeletonCard } from '../../../components/Skeleton';
import { Tabs } from '../../../components/Tabs';
import { ResetLink, SplitTag, TransferDialog, type TransferPerson } from '../../../components/TargetSplit';
import { useToast } from '../../../components/Toast';
import { TopBar } from '../../../components/TopBar';
import { api } from '../../../lib/api/client';
import { ApiError } from '../../../lib/api/errors';
import { istDateKey } from '../../../lib/format/date';
import { useNow } from '../../../lib/useNow';
import { useScreenPath } from '../../../portals/PortalContext';
import { Link } from 'react-router-dom';
import { firstName, useTargets, useTeam, type PaceRow, type TeamTargets } from '../_kit/api';
import { TeamTargetsTable, Verdict, monthName } from '../_kit/targets';

/** Targets — design T-Targets.dc.html, with the automatic split (17 Nov). */
type AgentRow = TeamTargets['agents'][number];
type FieldKey = 'candidatesActivated' | 'vacanciesCaptured' | 'placementsClosed' | 'repeatBusinesses';
const FIELDS: { key: FieldKey; label: string; type: 'call' | 'field' }[] = [
  { key: 'candidatesActivated', label: 'Paid registrations', type: 'call' },
  { key: 'vacanciesCaptured', label: 'Vacancies', type: 'call' },
  { key: 'placementsClosed', label: 'Placements', type: 'field' },
  { key: 'repeatBusinesses', label: 'Repeat businesses', type: 'field' },
];

interface PlanAgent {
  staff: { id: string; code: string; name: string; role: string };
  workType: 'call' | 'field';
  fields: { field: FieldKey; label: string; target: number | null; done: number; handSet: boolean }[];
}
export interface TeamPlanBoard {
  year: number;
  month: number;
  dayOfMonth: number;
  daysInMonth: number;
  editable: boolean;
  automatic: boolean;
  team: Array<PaceRow & { key: string; label: string; hint: string; handSet: boolean; limit: boolean }>;
  flags: string[];
  agents: PlanAgent[];
  left: { staff: { id: string; code: string; name: string; role: string }; target: Record<FieldKey, number | null> }[];
}

type Draft = Record<string, Partial<Record<FieldKey, string>>>;

function months(now: Date) {
  const [y, m] = istDateKey(now).split('-').map(Number);
  const next = m === 12 ? { year: y + 1, month: 1 } : { year: y, month: m + 1 };
  return [
    { key: 'this', year: y, month: m },
    { key: 'next', ...next },
  ];
}

export default function TeamLeadTargets() {
  const to = useScreenPath();
  const now = useNow();
  const toast = useToast();
  const qc = useQueryClient();
  const team = useTeam();
  const targets = useTargets();
  const options = months(now);
  const [tab, setTab] = useState('this');
  const sel = options.find((o) => o.key === tab) ?? options[0];
  const planQ = useQuery({
    queryKey: ['team-lead', 'targets', 'plan', sel.year, sel.month],
    queryFn: () => api.get<TeamPlanBoard>('/team-lead/targets/plan', { query: { year: String(sel.year), month: String(sel.month) } }),
  });
  const p = planQ.data;
  const t = targets.data;
  const [draft, setDraft] = useState<Draft>({});
  useEffect(() => setDraft({}), [sel.year, sel.month]);
  const [transferFrom, setTransferFrom] = useState<(TransferPerson & { role: string }) | null>(null);
  const refresh = () => void qc.invalidateQueries({ queryKey: ['team-lead'] });

  const value = (a: PlanAgent, key: FieldKey) => {
    const f = a.fields.find((x) => x.field === key);
    return draft[a.staff.id]?.[key] ?? (f?.target === null || f?.target === undefined ? '' : String(f.target));
  };
  const dirty = Object.keys(draft).length > 0;
  const badChars = Object.values(draft).some((vals) => Object.values(vals).some((v) => v !== '' && v !== undefined && !/^\d{1,6}$/.test(v)));

  const save = useMutation({
    mutationFn: () => {
      const rows = Object.entries(draft).map(([staffId, vals]) => {
        const out: Record<string, unknown> = { staffId };
        for (const [k, v] of Object.entries(vals)) out[k] = v === '' ? null : Number(v);
        return out;
      });
      return api.put<TeamPlanBoard>('/team-lead/targets', { year: sel.year, month: sel.month, rows });
    },
    onSuccess: () => {
      toast.success('Targets saved');
      setDraft({});
      refresh();
    },
    onError: (e) => toast.error(e instanceof ApiError ? e.message : 'Could not save the targets. Try again.'),
  });
  const reset = useMutation({
    mutationFn: (v: { staffId: string; field: FieldKey }) => api.post('/team-lead/targets/reset', { year: sel.year, month: sel.month, staffId: v.staffId, field: v.field }),
    onSuccess: () => {
      toast.success('Back to automatic');
      refresh();
    },
    onError: (e) => toast.error(e instanceof ApiError ? e.message : 'Could not reset. Try again.'),
  });
  const transfer = useMutation({
    mutationFn: (toStaffId: string) => api.post<{ moved: Record<string, number> }>('/team-lead/targets/transfer', { year: sel.year, month: sel.month, fromStaffId: transferFrom?.id, toStaffId }),
    onSuccess: (res) => {
      toast.success(`Target transferred · ${Object.values(res.moved).reduce((a, b) => a + b, 0)} moved`);
      setTransferFrom(null);
      refresh();
    },
    onError: (e) => toast.error(e instanceof ApiError ? e.message : 'Could not transfer the target. Try again.'),
  });
  const candidates = (role: string, except: string): TransferPerson[] => (p?.agents ?? []).filter((a) => a.staff.role === role && a.staff.id !== except).map((a) => ({ id: a.staff.id, name: a.staff.name }));

  const columns: Column<AgentRow>[] = [
    { key: 'agent', header: 'Agent', cell: (r) => <Link to={to('T-Agent', { id: r.staff.id })}>{r.staff.name}</Link>, sortValue: (r) => r.staff.name },
    { key: 'role', header: 'Role', cell: (r) => (r.staff.role === 'field_agent' ? 'Field' : 'Call'), filter: 'select', filterValue: (r) => (r.staff.role === 'field_agent' ? 'Field' : 'Call') },
    { key: 'main', header: 'Main target', cell: (r) => r.mainLabel },
    { key: 'target', header: 'Target', cell: (r) => r.target ?? '—' },
    { key: 'done', header: 'Done', cell: (r) => <b>{r.done}</b>, sortValue: (r) => r.done },
    { key: 'still', header: 'Still to do', cell: (r) => r.stillToDo ?? '—' },
    { key: 'speed', header: 'At this speed', cell: (r) => (r.target === null ? r.projection : `${r.projection} of ${r.target}`) },
    { key: 'make', header: 'Will they make it?', cell: (r) => <Verdict row={r} /> },
  ];
  const manager = team.data?.manager ? `${firstName(team.data.manager.name)} (Manager)` : 'the Manager';
  const teamRows = (p?.team ?? []).map((row) => ({ ...row, hint: row.handSet ? `${row.hint} · set by hand by ${manager}` : row.hint }));

  return (
    <div className="lb-page">
      <TopBar icon="targets" iconTone="gold" showSearch={false} back={{ to: to('T-Home'), label: 'My team' }} title="Targets" subtitle="The team's month targets, each agent's share, and where each agent will end at today's speed." />
      <Tabs label="Month" value={tab} onChange={setTab} items={options.map((o) => ({ key: o.key, label: monthName(o.month) }))} />
      <Card icon="teamAndAccess" tone="royal" title={`${team.data?.teamName ?? 'Your team'} · ${monthName(sel.month)}`}>
        {planQ.error ? (
          <ErrorState error={planQ.error} onRetry={() => void planQ.refetch()} />
        ) : p ? (
          <>
            <div className="lb-split-wide">
              <TeamTargetsTable rows={teamRows} month={p.month} daysInMonth={p.daysInMonth} />
            </div>
            {/* Phones: one block per number, no sideways scroll. */}
            <ul className="lb-split-stack" aria-label="Team targets">
              {teamRows.map((row) => (
                <li key={row.key}>
                  <div className="lb-split-stack__head">
                    <b>{row.label}</b>
                    <Verdict row={row} />
                  </div>
                  <div className="tl-sub">{row.hint}</div>
                  <dl>
                    <div>
                      <dt>Target</dt>
                      <dd>{row.target ?? '—'}</dd>
                    </div>
                    <div>
                      <dt>Done</dt>
                      <dd>{row.done}</dd>
                    </div>
                    <div>
                      <dt>Still to do</dt>
                      <dd>{row.stillToDo ?? '—'}</dd>
                    </div>
                    <div>
                      <dt>At this speed</dt>
                      <dd>{row.projection}</dd>
                    </div>
                  </dl>
                </li>
              ))}
            </ul>
            {p.flags.length > 0 && (
              <ul className="lb-split-flags" aria-label="Split warnings">
                {p.flags.map((f) => (
                  <li key={f}>{f}</li>
                ))}
              </ul>
            )}
            <div className="tl-note" style={{ padding: '10px 0 0' }}>
              {p.automatic ? `The CEO's plan is split automatically to each team by its agents · ${manager} can change the team's numbers` : `The CEO has not set this month's plan yet · team numbers come from ${manager}`}
            </div>
          </>
        ) : (
          <SkeletonCard />
        )}
      </Card>

      <Card icon="targets" tone="gold" title="Each agent's targets">
        {p && (
          <div className="scrollx">
            <table>
              <caption className="sr-only">Each agent's targets</caption>
              <thead>
                <tr>
                  <th>Agent</th>
                  {FIELDS.map((f) => (
                    <th key={f.key}>{f.label}</th>
                  ))}
                  {p.editable && <th>Move</th>}
                </tr>
              </thead>
              <tbody>
                {p.agents.map((a) => (
                  <tr key={a.staff.id}>
                    <td>
                      <b>{a.staff.name}</b>
                      <div className="tl-sub">{a.workType === 'field' ? 'Field' : 'Call'}</div>
                    </td>
                    {FIELDS.map((f) => {
                      const cell = a.fields.find((x) => x.field === f.key);
                      if (!cell) return <td key={f.key}>—</td>;
                      return (
                        <td key={f.key}>
                          <div className="lb-split-cell">
                            <input
                              className="mg-target-input"
                              style={{ width: 84, padding: '7px 10px', border: '1px solid var(--line-strong, #c3ceea)', borderRadius: 8, font: 'inherit', fontSize: 13, background: 'var(--panel)', color: 'var(--text)' }}
                              inputMode="numeric"
                              aria-label={`${f.label} for ${a.staff.name}`}
                              value={value(a, f.key)}
                              disabled={!p.editable}
                              onChange={(e) => {
                                const v = e.target.value.replace(/[^\d]/g, '').slice(0, 6);
                                setDraft((prev) => ({ ...prev, [a.staff.id]: { ...prev[a.staff.id], [f.key]: v } }));
                              }}
                            />
                            <span className="tl-sub">done {cell.done}</span>
                            {p.automatic && cell.target !== null && (
                              <span className="lb-split-cell__meta">
                                <SplitTag hand={cell.handSet} />
                                {cell.handSet && p.editable && <ResetLink label={`Reset ${f.label} for ${a.staff.name} to automatic`} disabled={reset.isPending} onClick={() => reset.mutate({ staffId: a.staff.id, field: f.key })} />}
                              </span>
                            )}
                          </div>
                        </td>
                      );
                    })}
                    {p.editable && (
                      <td>
                        <Button onClick={() => setTransferFrom({ id: a.staff.id, name: a.staff.name, role: a.staff.role })}>Transfer target</Button>
                      </td>
                    )}
                  </tr>
                ))}
                {p.left.map((l) => (
                  <tr key={l.staff.id}>
                    <td>
                      <b>{l.staff.name}</b>
                      <div className="tl-sub">Left this month</div>
                    </td>
                    {FIELDS.map((f) => (
                      <td key={f.key}>{(l.staff.role === 'field_agent') === (f.type === 'field') ? (l.target[f.key] ?? '—') : '—'}</td>
                    ))}
                    {p.editable && (
                      <td>
                        <Button onClick={() => setTransferFrom({ id: l.staff.id, name: l.staff.name, role: l.staff.role })}>Transfer target</Button>
                      </td>
                    )}
                  </tr>
                ))}
                {!p.agents.length && (
                  <tr>
                    <td colSpan={FIELDS.length + 2}>Nobody in your team yet.</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        )}
        <div className="tl-note" style={{ padding: '10px 0 0' }}>
          Paid and vacancies go to call agents, placements and repeat businesses to field agents · a number you change is kept (Set by hand) and the rest of the team's number goes to your other agents · past months can't be changed
        </div>
        {p?.editable && (
          <div className="ceo-actions" style={{ marginTop: 12 }}>
            <Button variant="primary" onClick={() => save.mutate()} loading={save.isPending} disabled={!dirty || badChars}>
              Save targets
            </Button>
            <Button onClick={() => setDraft({})} disabled={!dirty || save.isPending}>
              Cancel
            </Button>
          </div>
        )}
      </Card>
      <TransferDialog
        open={Boolean(transferFrom)}
        from={transferFrom}
        candidates={transferFrom ? candidates(transferFrom.role, transferFrom.id) : []}
        onClose={() => setTransferFrom(null)}
        onConfirm={(toId) => transfer.mutate(toId)}
        saving={transfer.isPending}
      />

      {tab === 'this' && (
        <Card icon="targets" tone="cyan" title="Each agent · main target" flush>
          <DataTable columns={columns} rows={t?.agents} rowKey={(r) => r.staff.id} caption="Each agent's main target" loading={targets.isPending} error={targets.error} emptyTitle="Nobody in your team yet." />
          <div className="tl-note" style={{ padding: '0 18px 14px' }}>
            Targets come from {manager}'s plan, split automatically · ask them to change a team number from the agent's page
          </div>
        </Card>
      )}
    </div>
  );
}
