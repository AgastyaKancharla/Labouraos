import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Card } from '../../../components/Card';
import { StatGrid, StatTile } from '../../../components/StatTile';
import { TopBar } from '../../../components/TopBar';
import { ErrorState } from '../../../components/ErrorState';
import { api } from '../../../lib/api/client';
import { useScreenPath } from '../../../portals/PortalContext';
import { FunnelTable, KIND_LABEL, OUTCOME_LABEL, SIGNUP_KINDS, SOURCE_LABEL, type SignupCounts, minutesText } from '../../shared/appSignups';

const RANGES = [7, 30, 90] as const;

/**
 * MG-AppSignups — the app sign-up pipeline as counts (customer app proposal
 * 4.4): started, how far people got, finished, time to finish and the share
 * finished without help. No names, no phone numbers, no money: the API
 * answers the Manager with counts only.
 */
export default function ManagerAppSignups() {
  const to = useScreenPath();
  const [days, setDays] = useState<(typeof RANGES)[number]>(30);
  const q = useQuery({
    queryKey: ['signup-tracker', 'manager', days],
    queryFn: () => api.get<SignupCounts>(`/signup-tracker/manager?days=${days}`),
  });
  const d = q.data;
  const outcomeKeys = ['open', 'self', 'assisted', 'no_response', 'gave_up'];

  return (
    <div className="lb-page">
      <TopBar
        showSearch={false}
        back={{ to: to('MG-Pipeline'), label: 'Pipeline' }}
        title="App sign-ups"
        subtitle="Job seekers, businesses and referral partners who signed up in the Laboura app, as counts."
        actions={
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }} role="group" aria-label="Period">
            {RANGES.map((r) => (
              <button key={r} type="button" className={`tag ${days === r ? 'tb' : 'tn'}`} aria-pressed={days === r} onClick={() => setDays(r)}>
                Last {r} days
              </button>
            ))}
          </div>
        }
      />
      {q.isError ? <ErrorState error={q.error} onRetry={() => void q.refetch()} /> : null}
      <StatGrid>
        <StatTile label="Started" value={d?.started ?? '—'} tone="royal" loading={q.isPending} />
        <StatTile label="Finished" value={d?.finished ?? '—'} tone="good" loading={q.isPending} />
        <StatTile
          label="Finished without help"
          value={d ? (d.finishedWithoutHelpPercent === null ? '—' : `${d.finishedWithoutHelpPercent}%`) : '—'}
          tone="cyan"
          loading={q.isPending}
        />
        <StatTile label="Typical time to finish" value={d ? minutesText(d.medianMinutesToFinish) : '—'} tone="navy" loading={q.isPending} />
      </StatGrid>
      <Card title="Open sign-ups by stage">
        <FunnelTable funnel={d?.openByStage} caption="Open sign-ups by stage" />
      </Card>
      <Card title="How far everyone got">
        <FunnelTable funnel={d?.reachedStage} caption="Sign-ups that reached each stage" note="Each number counts everyone who reached that stage or went further." />
      </Card>
      <div className="two-col">
        <Card title="How they ended">
          <div className="lb-table">
            <div className="lb-table__scroll">
              <table aria-label="Outcomes by kind">
                <thead>
                  <tr>
                    <th scope="col">Kind</th>
                    {outcomeKeys.map((o) => (
                      <th key={o} scope="col" style={{ textAlign: 'right' }}>
                        {OUTCOME_LABEL[o]}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {SIGNUP_KINDS.map((k) => (
                    <tr key={k}>
                      <th scope="row">{KIND_LABEL[k]}</th>
                      {outcomeKeys.map((o) => (
                        <td key={o} style={{ textAlign: 'right' }}>
                          {d?.outcomes?.[k]?.[o] ?? 0}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </Card>
        <Card title="Where they came from">
          <div className="kv" role="list" aria-label="Sign-ups by source" style={{ padding: '0 18px 12px' }}>
            {Object.entries(d?.bySource ?? {}).flatMap(([source, n]) => [
              <span key={`${source}-k`} role="listitem">{SOURCE_LABEL[source] ?? source}</span>,
              <span key={`${source}-v`}>{n}</span>,
            ])}
          </div>
          {d && Object.keys(d.bySource).length === 0 ? <p className="sub" style={{ padding: '0 18px 12px' }}>No sign-ups yet</p> : null}
        </Card>
      </div>
    </div>
  );
}
