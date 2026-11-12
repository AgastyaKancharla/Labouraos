import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Button } from '../../../components/Button';
import { Card } from '../../../components/Card';
import { ErrorState } from '../../../components/ErrorState';
import { StatusPill } from '../../../components/Badge';
import { Tabs } from '../../../components/Tabs';
import { useToast } from '../../../components/Toast';
import { TopBar } from '../../../components/TopBar';
import { api } from '../../../lib/api/client';
import { ApiError } from '../../../lib/api/errors';
import { istDateKey } from '../../../lib/format/date';
import { useNow } from '../../../lib/useNow';
import { useScreenPath } from '../../../portals/PortalContext';
import { monthLong, roleTeam } from '../_kit/kit';

type Key = 'candidatesActivated' | 'vacanciesCaptured' | 'placementsClosed' | 'repeatBusinesses';
const COLUMNS: { key: Key; label: string; roles: string[] }[] = [
  { key: 'candidatesActivated', label: 'Paid registrations', roles: ['call_agent', 'field_agent'] },
  { key: 'vacanciesCaptured', label: 'Vacancies', roles: ['call_agent'] },
  { key: 'placementsClosed', label: 'Placements', roles: ['field_agent'] },
  { key: 'repeatBusinesses', label: 'Repeat businesses', roles: ['field_agent'] },
];

type Sums = Record<Key, number | null>;
interface AgentRow {
  staff: { id: string; code: string; name: string; role: string; isIntern: boolean };
  team: string | null;
  teamLeadId: string | null;
  targetId: string | null;
  target: Sums;
  main: { metric: string; done: number; target: number | null; percent: number | null };
  pace: string;
}
interface Board {
  year: number;
  month: number;
  editable: boolean;
  previous: { year: number; month: number; targets: number };
  whole: Sums;
  teams: (Sums & { teamLeadId: string; team: string })[];
  agents: AgentRow[];
  leaderboard: { position: number; staff: AgentRow['staff']; team: string | null; main: AgentRow['main'] }[];
}

type Draft = Record<string, Partial<Record<Key, string>>>;

function months(now: Date): { key: string; year: number; month: number }[] {
  const [y, m] = istDateKey(now).split('-').map(Number);
  const next = m === 12 ? { year: y + 1, month: 1 } : { year: y, month: m + 1 };
  return [
    { key: 'this', year: y, month: m },
    { key: 'next', ...next },
  ];
}

/**
 * Targets — design MG-Targets.dc.html, on GET /manager/targets: agent targets
 * for the Manager's teams (this month and next), each team's total, "Copy
 * from last month" (POST /manager/targets/copy, own agents only), Save
 * (PUT /manager/targets) and the leaderboard. Ranked on placements and paid
 * registrations, never on calls dialled.
 */
export default function ManagerTargets() {
  const to = useScreenPath();
  const now = useNow();
  const toast = useToast();
  const qc = useQueryClient();
  const options = months(now);
  const [tab, setTab] = useState('this');
  const sel = options.find((o) => o.key === tab) ?? options[0];
  const q = useQuery({ queryKey: ['manager', 'targets', sel.year, sel.month], queryFn: () => api.get<Board>('/manager/targets', { query: { year: String(sel.year), month: String(sel.month) } }) });
  const d = q.data;
  const [draft, setDraft] = useState<Draft>({});
  useEffect(() => setDraft({}), [sel.year, sel.month]);

  const value = (r: AgentRow, key: Key): string => draft[r.staff.id]?.[key] ?? (r.target[key] === null ? '' : String(r.target[key]));
  const dirty = Object.keys(draft).length > 0;

  const teamTotals = useMemo(() => {
    if (!d) return [];
    return d.teams.map((t) => {
      const mine = d.agents.filter((a) => a.teamLeadId === t.teamLeadId);
      const sum = (key: Key) => {
        const vals = mine.map((a) => value(a, key)).filter((v) => v !== '').map(Number);
        return vals.length ? vals.reduce((x, y) => x + y, 0) : null;
      };
      return { ...t, candidatesActivated: sum('candidatesActivated'), vacanciesCaptured: sum('vacanciesCaptured'), placementsClosed: sum('placementsClosed'), repeatBusinesses: sum('repeatBusinesses') };
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [d, draft]);
  const whole = (key: Key) => {
    const vals = teamTotals.map((t) => t[key]).filter((v): v is number => v !== null);
    return vals.length ? vals.reduce((x, y) => x + y, 0) : null;
  };

  const save = useMutation({
    mutationFn: () => {
      const rows = Object.entries(draft).map(([staffId, vals]) => {
        const out: Record<string, unknown> = { staffId };
        for (const [k, v] of Object.entries(vals)) out[k] = v === '' ? null : Number(v);
        return out;
      });
      return api.put<{ created: number; updated: number; skipped: number }>('/manager/targets', { year: sel.year, month: sel.month, rows });
    },
    onSuccess: (res) => {
      toast.success(`Targets saved · ${res.created} new, ${res.updated} changed`);
      setDraft({});
      void qc.invalidateQueries({ queryKey: ['manager'] });
    },
    onError: (e) => toast.error(e instanceof ApiError ? e.message : 'Could not save the targets. Try again.'),
  });

  const copy = useMutation({
    mutationFn: () => api.post<{ copied: number; skipped: unknown[] }>('/manager/targets/copy', { fromYear: d?.previous.year, fromMonth: d?.previous.month, toYear: sel.year, toMonth: sel.month }),
    onSuccess: (res) => {
      toast.success(res.copied ? `Copied ${res.copied} agent target${res.copied === 1 ? '' : 's'}` : 'Nothing to copy — everyone already has a target');
      void qc.invalidateQueries({ queryKey: ['manager'] });
    },
    onError: (e) => toast.error(e instanceof ApiError ? e.message : 'Could not copy. Try again.'),
  });

  const badChars = Object.values(draft).some((vals) => Object.values(vals).some((v) => v !== '' && v !== undefined && !/^\d{1,6}$/.test(v)));

  return (
    <div className="lb-page">
      <TopBar back={{ to: to('MG-Home'), label: 'Command Center' }} title="Targets" subtitle="Split the month into team and agent targets, and see who is delivering." />
      <Tabs label="Month" value={tab} onChange={setTab} items={options.map((o) => ({ key: o.key, label: monthLong(o.month) }))} />
      {q.error ? (
        <ErrorState error={q.error} onRetry={() => void q.refetch()} />
      ) : (
        <>
          <Card title="Team targets">
            <div className="scrollx">
              <table>
                <thead>
                  <tr>
                    <th />
                    {COLUMNS.map((c) => (
                      <th key={c.key}>{c.label}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {teamTotals.map((t) => (
                    <tr key={t.teamLeadId}>
                      <td>{t.team}</td>
                      {COLUMNS.map((c) => (
                        <td key={c.key}>{t[c.key] ?? '—'}</td>
                      ))}
                    </tr>
                  ))}
                  <tr>
                    <td>
                      <b>All your teams</b>
                    </td>
                    {COLUMNS.map((c) => (
                      <td key={c.key}>
                        <b>{whole(c.key) ?? '—'}</b>
                      </td>
                    ))}
                  </tr>
                </tbody>
              </table>
            </div>
            <div className="mg-note">A team's target is the sum of its agents' targets below · you can't lower the CEO's plan, only the CEO can</div>
          </Card>

          <Card
            title="Agent targets"
            aside={
              d?.editable ? (
                <Button onClick={() => copy.mutate()} loading={copy.isPending} disabled={!d || !d.previous.targets}>
                  {`Copy from ${d ? monthLong(d.previous.month) : 'last month'}`}
                </Button>
              ) : undefined
            }
          >
            <div className="scrollx">
              <table>
                <thead>
                  <tr>
                    <th>Agent</th>
                    <th className="hide-phone">Team</th>
                    {COLUMNS.map((c) => (
                      <th key={c.key}>{c.label}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {d?.agents.map((r) => (
                    <tr key={r.staff.id}>
                      <td>
                        <b>{r.staff.name}</b>
                      </td>
                      <td className="hide-phone">{roleTeam(r.staff.role, r.team, r.staff.isIntern)}</td>
                      {COLUMNS.map((c) => (
                        <td key={c.key}>
                          {c.roles.includes(r.staff.role) ? (
                            <input
                              className="mg-target-input"
                              inputMode="numeric"
                              aria-label={`${c.label} for ${r.staff.name}`}
                              value={value(r, c.key)}
                              disabled={!d.editable}
                              onChange={(e) => {
                                const v = e.target.value.replace(/[^\d]/g, '').slice(0, 6);
                                setDraft((prev) => ({ ...prev, [r.staff.id]: { ...prev[r.staff.id], [c.key]: v } }));
                              }}
                            />
                          ) : (
                            '—'
                          )}
                        </td>
                      ))}
                    </tr>
                  ))}
                  {d && !d.agents.length && (
                    <tr>
                      <td colSpan={COLUMNS.length + 2}>No agents in your teams yet.</td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
            <div className="mg-note">Interns carry the same numbers as paid agents · Team Leads can ask for a change, you approve it · past months can't be changed</div>
          </Card>
          {d?.editable && (
            <div className="ceo-actions">
              <Button variant="primary" onClick={() => save.mutate()} loading={save.isPending} disabled={!dirty || badChars}>
                Save targets
              </Button>
              <Button onClick={() => setDraft({})} disabled={!dirty || save.isPending}>
                Cancel
              </Button>
            </div>
          )}

          <Card title={`Leaderboard · ${d ? monthLong(d.month) : ''}`}>
            <div className="scrollx">
              <table>
                <thead>
                  <tr>
                    <th>#</th>
                    <th>Agent</th>
                    <th className="hide-phone">Team</th>
                    <th>Main result</th>
                    <th>Of target</th>
                  </tr>
                </thead>
                <tbody>
                  {d?.leaderboard.map((l) => (
                    <tr key={l.staff.id}>
                      <td>{l.position}</td>
                      <td>{l.staff.name}</td>
                      <td className="hide-phone">{roleTeam(l.staff.role, l.team, l.staff.isIntern)}</td>
                      <td>{`${l.main.done} ${l.main.metric === 'placed' ? (l.main.done === 1 ? 'placement' : 'placements') : 'paid'}`}</td>
                      <td>{l.main.percent === null ? '—' : <StatusPill tone={l.main.percent >= 60 ? 'good' : l.main.percent >= 40 ? 'warn' : 'danger'}>{`${l.main.percent}%`}</StatusPill>}</td>
                    </tr>
                  ))}
                  {d && !d.leaderboard.length && (
                    <tr>
                      <td colSpan={5}>No results yet this month.</td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
            <div className="mg-note">Ranked on placements and paid registrations, never on calls dialled</div>
          </Card>
        </>
      )}
    </div>
  );
}
