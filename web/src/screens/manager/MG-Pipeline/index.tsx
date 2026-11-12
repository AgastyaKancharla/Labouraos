import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Card } from '../../../components/Card';
import { ErrorState } from '../../../components/ErrorState';
import { StatGrid, StatTile } from '../../../components/StatTile';
import { StatusPill } from '../../../components/Badge';
import { TopBar } from '../../../components/TopBar';
import { api } from '../../../lib/api/client';
import { periodFor, periodToUtcRange, type Period } from '../../../lib/period';
import { useNow } from '../../../lib/useNow';
import { useScreenPath } from '../../../portals/PortalContext';
import { teamShort } from '../_kit/kit';
import { RunButton } from '../_kit/RunButton';

/** GET /manager/pipeline. */
export interface PipelineResponse {
  funnel: { registered: number; paid: number; interviewed: number; offered: number; placed: number; daysToFill: number | null };
  closeToRefund: {
    windowDays: number;
    total: number;
    jobSeekers: number;
    businesses: number;
    rows: {
      kind: 'job_seeker' | 'business';
      id: string;
      code: string;
      name: string | null;
      trade: string | null;
      daysLeft: number;
      bucket: string;
      businessName: string | null;
      agent: { id: string; code: string; name: string } | null;
      team: string | null;
      standing: string;
    }[];
  };
  stuck: { kind: string; label: string; count: number; why: string | null; agents: number }[];
  oldestVacancies: {
    id: string;
    code: string;
    trade: string;
    business: { id: string; name: string };
    area: string | null;
    openDays: number;
    shown: number;
    selected: number;
    accountAgent: { id: string; name: string } | null;
  }[];
}

const SHOWN = 10;

/**
 * Pipeline — design MG-Pipeline.dc.html, on GET /manager/pipeline: the work
 * flowing through the Manager's teams as counts, the 15-day close-to-a-refund
 * priority with "Remind the agent", stuck work and the oldest vacancies.
 * Work lists only: phone numbers hidden, no money.
 */
export default function Pipeline() {
  const to = useScreenPath();
  const now = useNow();
  const [period, setPeriod] = useState<Period>(() => periodFor('month', now));
  const range = periodToUtcRange(period);
  const q = useQuery({ queryKey: ['manager', 'pipeline', range], queryFn: () => api.get<PipelineResponse>('/manager/pipeline', { query: range }) });
  const d = q.data;
  const f = d?.funnel;
  const near = d?.closeToRefund;

  return (
    <div className="lb-page">
      <TopBar back={{ to: to('MG-Home'), label: 'Command Center' }} title="Pipeline" subtitle="The work flowing through your teams, as counts — and what is stuck." period={period} onPeriodChange={setPeriod} />
      {q.error ? (
        <ErrorState error={q.error} onRetry={() => void q.refetch()} />
      ) : (
        <>
          <StatGrid>
            <StatTile label="Registered" value={f?.registered ?? '—'} tone="royal" loading={q.isPending} />
            <StatTile label="Paid" value={f?.paid ?? '—'} tone="cyan" loading={q.isPending} />
            <StatTile label="Interviewed" value={f?.interviewed ?? '—'} tone="navy" loading={q.isPending} />
            <StatTile label="Offered" value={f?.offered ?? '—'} tone="gold" loading={q.isPending} />
            <StatTile label="Placed" value={f?.placed ?? '—'} tone="good" loading={q.isPending} />
            <StatTile label="Time to fill" value={f ? (f.daysToFill === null ? '—' : `${f.daysToFill} days`) : '—'} tone="royal" loading={q.isPending} />
          </StatGrid>

          <Card title="Close to a refund · priority">
            <div className="scrollx">
              <table>
                <thead>
                  <tr>
                    <th>Job seeker / business</th>
                    <th>Team</th>
                    <th>Refund due in</th>
                    <th>Where it stands</th>
                    <th>Agent</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {near?.rows.slice(0, SHOWN).map((r) => (
                    <tr key={`${r.kind}-${r.id}`}>
                      <td className="mg-what">
                        <b>
                          {r.code}
                          {r.name ? ` · ${r.name}` : ''}
                        </b>
                        <span>{r.kind === 'job_seeker' ? (r.trade ?? '—') : `Replacement · ${r.businessName ?? ''}`}</span>
                      </td>
                      <td>{teamShort(r.team)}</td>
                      <td>
                        <StatusPill tone={r.daysLeft <= 5 ? 'danger' : r.daysLeft <= 10 ? 'warn' : 'info'}>{`${r.daysLeft} day${r.daysLeft === 1 ? '' : 's'}`}</StatusPill>
                      </td>
                      <td>{r.standing}</td>
                      <td>{r.agent?.name ?? '—'}</td>
                      <td>
                        <RunButton
                          label="Remind the agent"
                          disabled={!r.agent}
                          run={() => api.post<{ created: boolean }>('/manager/pipeline/remind', { kind: r.kind === 'job_seeker' ? 'job_seeker' : 'placement', id: r.id })}
                          success={(res) => (res.created ? `${r.agent?.name ?? 'The agent'} will call first` : 'Already on the agent’s list')}
                        />
                      </td>
                    </tr>
                  ))}
                  {near && !near.rows.length && (
                    <tr>
                      <td colSpan={6}>Nobody in your teams is close to a refund.</td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
            {near && near.total > 0 && (
              <div className="mg-note">
                {near.total} in your teams {near.total === 1 ? 'has' : 'have'} a refund due within {near.windowDays} days · they come first in Call next and matching · showing {Math.min(SHOWN, near.total)} of {near.total}
              </div>
            )}
          </Card>

          <Card title="Stuck work">
            <div className="scrollx">
              <table>
                <thead>
                  <tr>
                    <th>What</th>
                    <th>How many</th>
                    <th>Why</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {d?.stuck.map((s) => (
                    <tr key={s.kind}>
                      <td>{s.label}</td>
                      <td>
                        <b>{s.count}</b>
                      </td>
                      <td style={{ whiteSpace: 'normal' }}>{s.why ?? '—'}</td>
                      <td>
                        <RunButton
                          label="Remind the agents"
                          disabled={!s.count || !s.agents}
                          run={() => api.post<{ reminded: number }>(`/manager/pipeline/stuck/${s.kind}/remind`)}
                          success={(res) => (res.reminded ? `Reminded ${res.reminded} agent${res.reminded === 1 ? '' : 's'}` : 'Already reminded today')}
                        />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>

          <Card title="Vacancies open longest">
            <div className="scrollx">
              <table>
                <thead>
                  <tr>
                    <th>Code</th>
                    <th>Job</th>
                    <th className="hide-phone">Area</th>
                    <th>Open</th>
                    <th>Progress</th>
                    <th className="hide-phone">Account agent</th>
                  </tr>
                </thead>
                <tbody>
                  {d?.oldestVacancies.map((v) => (
                    <tr key={v.id}>
                      <td>{v.code}</td>
                      <td>
                        {v.trade} · {v.business.name}
                      </td>
                      <td className="hide-phone">{v.area ?? '—'}</td>
                      <td>{v.openDays} days</td>
                      <td>{v.shown ? `${v.shown} shown${v.selected ? ` · ${v.selected} selected` : ' · 0 selected'}` : 'Nobody shown yet'}</td>
                      <td className="hide-phone">{v.accountAgent?.name ?? '—'}</td>
                    </tr>
                  ))}
                  {d && !d.oldestVacancies.length && (
                    <tr>
                      <td colSpan={6}>No open vacancies for your teams.</td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
            <div className="mg-note">Work lists only · phone numbers hidden · money is the CEO's view</div>
          </Card>
        </>
      )}
    </div>
  );
}
