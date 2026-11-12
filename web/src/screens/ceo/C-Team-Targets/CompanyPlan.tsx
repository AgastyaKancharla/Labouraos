import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Button } from '../../../components/Button';
import { StatusPill } from '../../../components/Badge';
import { ErrorState } from '../../../components/ErrorState';
import { useToast } from '../../../components/Toast';
import { api } from '../../../lib/api/client';
import { ApiError } from '../../../lib/api/errors';
import { monthName } from '../_kit/month';

const KEYS = ['registered', 'paid', 'businessesSignedUp', 'vacancies', 'interviewsDone', 'placed', 'repeatBusinesses', 'leftWithin30'] as const;
type Key = (typeof KEYS)[number];
type Values = Record<Key, number | null>;
const INPUT = { width: 68, padding: '7px 10px', border: '1px solid var(--line-strong, #c3ceea)', borderRadius: 8, font: 'inherit', fontSize: 13, background: 'var(--panel)', color: 'var(--text)' } as const;
const LABEL: Record<Key, string> = {
  registered: 'Registrations',
  paid: 'Paid ₹499',
  businessesSignedUp: 'Businesses',
  vacancies: 'Vacancies',
  interviewsDone: 'Interviews',
  placed: 'Placements',
  repeatBusinesses: 'Repeat businesses',
  leftWithin30: 'Left in 30 days (at most)',
};

export interface CompanyPlanBoard {
  year: number;
  month: number;
  plan: Values | null;
  setAt: string | null;
  teams: { teamLeadId: string; team: string; teamLead: string; manager: { id: string; name: string } | null; split: Values }[];
  total: Values;
  difference: Record<Key, number | null>;
}

/**
 * C-Team-Targets "Company plan": the CEO sets the month's totals
 * (GET/PUT /plans/company); each team's split by its Manager is shown
 * underneath, with whether the split adds up. Counts only.
 */
export function CompanyPlan({ month, editable }: { month: string; editable: boolean }) {
  const toast = useToast();
  const qc = useQueryClient();
  const [year, mon] = month.split('-').map(Number);
  const q = useQuery({ queryKey: ['plans', 'company', month], queryFn: () => api.get<CompanyPlanBoard>('/plans/company', { query: { year: String(year), month: String(mon) } }) });
  const [draft, setDraft] = useState<Partial<Record<Key, string>>>({});
  useEffect(() => setDraft({}), [month]);
  const d = q.data;
  const value = (k: Key) => draft[k] ?? (d?.plan?.[k] === null || d?.plan?.[k] === undefined ? '' : String(d.plan[k]));
  const dirty = Object.keys(draft).length > 0;
  const save = useMutation({
    mutationFn: () => {
      const body: Record<string, unknown> = { year, month: mon };
      for (const [k, v] of Object.entries(draft)) body[k] = v === '' ? null : Number(v);
      return api.put<CompanyPlanBoard>('/plans/company', body);
    },
    onSuccess: () => {
      toast.success(`${monthName(month, false)} plan saved`);
      setDraft({});
      void qc.invalidateQueries({ queryKey: ['plans'] });
    },
    onError: (e) => toast.error(e instanceof ApiError ? e.message : 'Could not save the plan. Try again.'),
  });

  if (q.error) return <ErrorState error={q.error} onRetry={() => void q.refetch()} />;

  return (
    <section className="panel" style={{ padding: '14px 18px' }} aria-labelledby="company-plan-title">
      <h2 id="company-plan-title" className="h2" style={{ marginTop: 0 }}>
        Company plan · {monthName(month, false)}
      </h2>
      <div className="scrollx">
        <table>
          <caption className="sr-only">Company plan and the teams' split</caption>
          <thead>
            <tr>
              <th />
              {KEYS.map((k) => (
                <th key={k}>{LABEL[k]}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>
                <b>Your plan · whole company</b>
              </td>
              {KEYS.map((k) => (
                <td key={k}>
                  <input
                    style={INPUT}
                    inputMode="numeric"
                    aria-label={`Plan: ${LABEL[k]}`}
                    value={value(k)}
                    disabled={!editable || q.isPending}
                    onChange={(e) => {
                      const v = e.target.value.replace(/[^\d]/g, '').slice(0, 6);
                      setDraft((prev) => ({ ...prev, [k]: v }));
                    }}
                  />
                </td>
              ))}
            </tr>
            {d?.teams.map((t) => (
              <tr key={t.teamLeadId}>
                <td>
                  <div style={{ fontWeight: 600 }}>{t.team}</div>
                  <div className="ceo-cell-sub">{t.manager ? `Split by ${t.manager.name}` : 'No Manager yet'}</div>
                </td>
                {KEYS.map((k) => (
                  <td key={k}>{t.split[k] ?? '—'}</td>
                ))}
              </tr>
            ))}
            <tr>
              <td>
                <b>Total split by the Managers</b>
              </td>
              {KEYS.map((k) => {
                const diff = d?.difference[k];
                return (
                  <td key={k}>
                    <b>{d?.total[k] ?? '—'}</b>
                    {diff !== null && diff !== undefined && (
                      <div>
                        <StatusPill tone={diff === 0 ? 'good' : 'danger'}>{diff === 0 ? 'Adds up' : diff > 0 ? `${diff} over` : `${-diff} not split`}</StatusPill>
                      </div>
                    )}
                  </td>
                );
              })}
            </tr>
          </tbody>
        </table>
      </div>
      <div className="ceo-note">You set the month's totals · each Manager splits them into their teams, and the agents' targets add up under each team · empty means no number for that one</div>
      {editable && (
        <div className="ceo-actions" style={{ marginTop: 12 }}>
          <Button variant="primary" onClick={() => save.mutate()} loading={save.isPending} disabled={!dirty}>
            Save plan
          </Button>
          <Button onClick={() => setDraft({})} disabled={!dirty || save.isPending}>
            Cancel
          </Button>
        </div>
      )}
    </section>
  );
}
