import { useEffect, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Button } from '../../../components/Button';
import { Card } from '../../../components/Card';
import { StatusPill } from '../../../components/Badge';
import { useToast } from '../../../components/Toast';
import { api } from '../../../lib/api/client';
import { ApiError } from '../../../lib/api/errors';
import { teamShort } from '../_kit/kit';
import { ResetLink, SplitTag } from '../../../components/TargetSplit';

/** The plan metrics, in the order the designs show them (never money). */
export const PLAN_KEYS = ['registered', 'paid', 'businessesSignedUp', 'vacancies', 'interviewsDone', 'placed', 'repeatBusinesses', 'leftWithin30'] as const;
export type PlanKey = (typeof PLAN_KEYS)[number];
export type PlanValues = Record<PlanKey, number | null>;

export const PLAN_LABEL: Record<PlanKey, string> = {
  registered: 'Registrations',
  paid: 'Paid',
  businessesSignedUp: 'Businesses',
  vacancies: 'Vacancies',
  interviewsDone: 'Interviews',
  placed: 'Placements',
  repeatBusinesses: 'Repeat businesses',
  leftWithin30: 'Left in 30 days (limit)',
};

/** Always shown (the design's four plus the agents' other two targets); the rest when the CEO sets them. */
const ALWAYS: PlanKey[] = ['registered', 'paid', 'businessesSignedUp', 'vacancies', 'placed', 'repeatBusinesses'];

export interface PlanSplit {
  company: PlanValues | null;
  /** The CEO set a plan: the numbers come from the automatic split. */
  automatic?: boolean;
  /** The Manager's share of the CEO's plan (what the split gave their teams). */
  share?: PlanValues;
  teams: { teamLeadId: string; team: string; teamLead: string; split: PlanValues; agents: PlanValues; handSet?: PlanKey[]; flags?: string[] }[];
  otherTeams: PlanValues | null;
  total: PlanValues;
  difference: Record<PlanKey, number | null>;
}

type Draft = Record<string, Partial<Record<PlanKey, string>>>;

function sum(values: (number | null | undefined)[]): number | null {
  const set = values.filter((v): v is number => typeof v === 'number');
  return set.length ? set.reduce((a, b) => a + b, 0) : null;
}

/**
 * MG-Targets "Split the CEO's plan into teams": the CEO's plan, an input per
 * team and metric (PUT /manager/targets/split), the sum of each team's agent
 * targets under its split, the teams of other Managers as one line, and
 * whether the total split adds up to the CEO's plan.
 */
export function PlanSplitCard({ plan, year, month, editable, agentSums }: { plan: PlanSplit | undefined; year: number; month: number; editable: boolean; agentSums: Record<string, Partial<PlanValues>> }) {
  const toast = useToast();
  const qc = useQueryClient();
  const [draft, setDraft] = useState<Draft>({});
  useEffect(() => setDraft({}), [year, month]);

  const keys = PLAN_KEYS.filter((k) => ALWAYS.includes(k) || typeof plan?.company?.[k] === 'number' || plan?.teams.some((t) => typeof t.split[k] === 'number'));
  const value = (teamLeadId: string, key: PlanKey, stored: number | null) => draft[teamLeadId]?.[key] ?? (stored === null ? '' : String(stored));
  const current = (teamLeadId: string, key: PlanKey, stored: number | null): number | null => {
    const v = value(teamLeadId, key, stored);
    return v === '' ? null : Number(v);
  };
  const total = (key: PlanKey) => sum([...(plan?.teams ?? []).map((t) => current(t.teamLeadId, key, t.split[key])), plan?.otherTeams?.[key] ?? null]);
  const dirty = Object.keys(draft).length > 0;
  const automatic = Boolean(plan?.automatic);
  const flags = (plan?.teams ?? []).flatMap((t) => t.flags ?? []);

  const reset = useMutation({
    mutationFn: (v: { teamLeadId: string; key: PlanKey }) => api.post('/manager/targets/reset', { year, month, kind: 'team', id: v.teamLeadId, key: v.key }),
    onSuccess: () => {
      toast.success('Back to automatic');
      void qc.invalidateQueries({ queryKey: ['manager'] });
    },
    onError: (e) => toast.error(e instanceof ApiError ? e.message : 'Could not reset. Try again.'),
  });

  const save = useMutation({
    mutationFn: () => {
      const rows = Object.entries(draft).map(([teamLeadId, vals]) => {
        const out: Record<string, unknown> = { teamLeadId };
        for (const [k, v] of Object.entries(vals)) out[k] = v === '' ? null : Number(v);
        return out;
      });
      return api.put<{ created: number; updated: number }>('/manager/targets/split', { year, month, rows });
    },
    onSuccess: () => {
      toast.success('Team split saved');
      setDraft({});
      void qc.invalidateQueries({ queryKey: ['manager'] });
    },
    onError: (e) => toast.error(e instanceof ApiError ? e.message : 'Could not save the split. Try again.'),
  });

  const verdict = (key: PlanKey) => {
    const p = plan?.company?.[key];
    if (typeof p !== 'number') return null;
    const diff = (total(key) ?? 0) - p;
    if (diff === 0) return <StatusPill tone="good">Adds up</StatusPill>;
    return <StatusPill tone="danger">{diff > 0 ? `${diff} over the plan` : `${-diff} still to split`}</StatusPill>;
  };

  return (
    <Card title="Split the CEO's plan into teams">
      <div className="scrollx">
        <table>
          <caption className="sr-only">Split the CEO's plan into teams</caption>
          <thead>
            <tr>
              <th />
              {keys.map((k) => (
                <th key={k}>{PLAN_LABEL[k]}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>CEO plan · whole team</td>
              {keys.map((k) => (
                <td key={k}>{plan?.company?.[k] ?? '—'}</td>
              ))}
            </tr>
            {automatic && plan?.share && (
              <tr>
                <td>Your share · by agents in your teams</td>
                {keys.map((k) => (
                  <td key={k}>
                    <b>{plan.share?.[k] ?? '—'}</b>
                  </td>
                ))}
              </tr>
            )}
            {plan?.teams.map((t) => (
              <tr key={t.teamLeadId}>
                <td>{`Team ${teamShort(t.team)}`}</td>
                {keys.map((k) => {
                  const agents = agentSums[t.teamLeadId]?.[k] ?? t.agents[k];
                  const hand = Boolean(t.handSet?.includes(k));
                  return (
                    <td key={k}>
                      <div className="lb-split-cell">
                      <input
                        className="mg-target-input"
                        inputMode="numeric"
                        aria-label={`${PLAN_LABEL[k]} for Team ${teamShort(t.team)}`}
                        value={value(t.teamLeadId, k, t.split[k])}
                        disabled={!editable}
                        onChange={(e) => {
                          const v = e.target.value.replace(/[^\d]/g, '').slice(0, 6);
                          setDraft((prev) => ({ ...prev, [t.teamLeadId]: { ...prev[t.teamLeadId], [k]: v } }));
                        }}
                      />
                      {automatic && typeof t.split[k] === 'number' && (
                        <span className="lb-split-cell__meta">
                          <SplitTag hand={hand} />
                          {hand && editable && (
                            <ResetLink label={`Reset ${PLAN_LABEL[k]} for Team ${teamShort(t.team)} to automatic`} disabled={reset.isPending} onClick={() => reset.mutate({ teamLeadId: t.teamLeadId, key: k })} />
                          )}
                        </span>
                      )}
                      {agents !== null && agents !== undefined && <span className="mg-agents-sum">agents {agents}</span>}
                      </div>
                    </td>
                  );
                })}
              </tr>
            ))}
            {plan?.otherTeams && (
              <tr>
                <td>Teams under other Managers</td>
                {keys.map((k) => (
                  <td key={k}>{plan.otherTeams?.[k] ?? '—'}</td>
                ))}
              </tr>
            )}
            <tr>
              <td>
                <b>Total split</b>
              </td>
              {keys.map((k) => (
                <td key={k}>
                  <b>{total(k) ?? '—'}</b>
                  <div>{verdict(k)}</div>
                </td>
              ))}
            </tr>
            {plan && !plan.teams.length && (
              <tr>
                <td colSpan={keys.length + 1}>No Team Leads report to you yet. The CEO gives you teams.</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      {flags.length > 0 && (
        <ul className="lb-split-flags" aria-label="Split warnings">
          {flags.map((f) => (
            <li key={f}>{f}</li>
          ))}
        </ul>
      )}
      <div className="mg-note">
        {automatic
          ? "The CEO's plan is split automatically by the number of agents in each team · a number you change is kept (Set by hand) and the rest of your share goes to your other teams · Reset puts it back to automatic"
          : "The split must add up to the CEO's plan · you can't lower the plan, only the CEO can"}
        {plan && !plan.company ? ' · the CEO has not set this month’s plan yet' : ''} · under each team: the sum of its agents' targets
      </div>
      {editable && (
        <div className="ceo-actions" style={{ padding: '0 14px 14px' }}>
          <Button variant="primary" onClick={() => save.mutate()} loading={save.isPending} disabled={!dirty}>
            Save split
          </Button>
          <Button onClick={() => setDraft({})} disabled={!dirty || save.isPending}>
            Cancel
          </Button>
        </div>
      )}
    </Card>
  );
}
