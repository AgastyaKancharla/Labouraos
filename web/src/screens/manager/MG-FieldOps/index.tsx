import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { ButtonLink } from '../../../components/Button';
import { Card } from '../../../components/Card';
import { DataTable, type Column } from '../../../components/DataTable';
import { StatGrid, StatTile } from '../../../components/StatTile';
import { StatusPill } from '../../../components/Badge';
import { TopBar } from '../../../components/TopBar';
import { api } from '../../../lib/api/client';
import { formatDateIST, istDateKey } from '../../../lib/format/date';
import { periodFor, periodToUtcRange, type Period } from '../../../lib/period';
import { useNow } from '../../../lib/useNow';
import { useScreenPath } from '../../../portals/PortalContext';
import { ActionButton } from '../../ceo/_kit/actions';
import { humanize } from '../../ceo/_kit/kit';
import { liveLabel } from '../../ceo/_kit/format';
import { teamShort } from '../_kit/kit';

interface Row {
  staff: { id: string; code: string; name: string; role: string; isIntern: boolean };
  team: string | null;
  now: string;
  visits: number;
  withProof: number;
  onboarded: number;
  shortVisits: number;
  flags: string[];
}
interface FieldOpsResponse {
  summary: { visits: number; onboarded: number; requestsToAssign: number; shortVisitsFlagged: number; proofProblems: number };
  visitsByTeam: { teamLeadId: string; team: string; visitsThisWeek: number }[];
  rows: Row[];
  requests: { id: string; business: { id: string; code: string; name: string; locality: string | null }; purpose: string; createdAt: string; suggested: { id: string; name: string } | null }[];
  agents: { id: string; name: string; onLeave: boolean }[];
}

/**
 * Field ops · today — design MG-FieldOps.dc.html, on GET /manager/field-ops:
 * visits, proof checks and visit requests to assign for the Manager's field
 * agents. Assign uses POST /businesses/:id/visit-assignments/:id/assign.
 */
export default function ManagerFieldOps() {
  const to = useScreenPath();
  const navigate = useNavigate();
  const now = useNow();
  const [period, setPeriod] = useState<Period>(() => periodFor('today', now));
  const range = periodToUtcRange(period);
  const q = useQuery({ queryKey: ['manager', 'field-ops', range], queryFn: () => api.get<FieldOpsResponse>('/manager/field-ops', { query: range }) });
  const d = q.data;
  const s = d?.summary;
  const agentOptions = (d?.agents ?? []).filter((a) => !a.onLeave).map((a) => ({ value: a.id, label: a.name }));

  const columns: Column<Row>[] = [
    { key: 'agent', header: 'Field agent', cell: (r) => <b>{r.staff.name}{r.staff.isIntern ? ' (intern)' : ''}</b>, filter: 'text', filterValue: (r) => r.staff.name, sortValue: (r) => r.staff.name, csv: (r) => r.staff.name },
    { key: 'team', header: 'Team', cell: (r) => teamShort(r.team), filter: 'select', filterValue: (r) => teamShort(r.team), csv: (r) => r.team },
    { key: 'visits', header: 'Visits', cell: (r) => (r.now === 'on_leave' ? '—' : r.visits), sortValue: (r) => r.visits, csv: (r) => r.visits },
    { key: 'proof', header: 'Photo + selfie + GPS', cell: (r) => (r.visits ? `${r.withProof} of ${r.visits}` : '—'), csv: (r) => r.withProof, hideOnPhone: true },
    { key: 'onb', header: 'Onboarded', cell: (r) => r.onboarded, sortValue: (r) => r.onboarded, csv: (r) => r.onboarded },
    {
      key: 'flags',
      header: 'Flags',
      cell: (r) =>
        r.now === 'on_leave' ? (
          <StatusPill tone="muted">On leave</StatusPill>
        ) : r.shortVisits ? (
          <StatusPill tone="danger">{`${r.shortVisits} under 3 min`}</StatusPill>
        ) : r.flags.length ? (
          <StatusPill tone="warn">{r.flags.join(', ')}</StatusPill>
        ) : (
          <StatusPill tone="good">Good</StatusPill>
        ),
      csv: (r) => r.flags.join('; '),
    },
    { key: 'now', header: 'Right now', cell: (r) => liveLabel(r.now).label, csv: (r) => liveLabel(r.now).label, hideOnPhone: true },
  ];

  return (
    <div className="lb-page">
      <TopBar back={{ to: to('MG-Home'), label: 'Command Center' }} title="Field ops · today" subtitle="Visits, proof checks and requests to assign, for your field agents." period={period} onPeriodChange={setPeriod} />
      <StatGrid>
        <StatTile label="Visits" value={s?.visits ?? '—'} tone="royal" loading={q.isPending} />
        {d?.visitsByTeam.map((t) => (
          <StatTile key={t.teamLeadId} label={`${teamShort(t.team)} visits this week`} value={t.visitsThisWeek} tone="navy" />
        ))}
        <StatTile label="Businesses onboarded" value={s?.onboarded ?? '—'} tone="good" loading={q.isPending} />
        <StatTile label="Visit requests to assign" value={s?.requestsToAssign ?? '—'} tone="gold" loading={q.isPending} />
        <StatTile label="Short visits flagged" value={s?.shortVisitsFlagged ?? '—'} tone="red" loading={q.isPending} to={to('MG-Flags')} />
      </StatGrid>
      <Card title="Visit requests to assign">
        <div className="scrollx">
          <table>
            <thead>
              <tr>
                <th>Business</th>
                <th>Why</th>
                <th>When</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {d?.requests.map((r) => (
                <tr key={r.id}>
                  <td>
                    {r.business.name}
                    {r.business.locality ? ` · ${r.business.locality}` : ''}
                  </td>
                  <td>{humanize(r.purpose)}</td>
                  <td>{istDateKey(r.createdAt) === istDateKey(now) ? 'Today' : formatDateIST(r.createdAt)}</td>
                  <td>
                    <ActionButton
                      label="Assign"
                      title={`Assign the visit to ${r.business.name}`}
                      choice={{ label: 'Field agent', options: agentOptions, initial: r.suggested?.id }}
                      disabled={!agentOptions.length}
                      run={({ choice }) => api.post(`/businesses/${r.business.id}/visit-assignments/${r.id}/assign`, { assignedStaffId: choice })}
                      success="Visit assigned"
                      confirmLabel="Assign"
                    />
                  </td>
                </tr>
              ))}
              {d && !d.requests.length && (
                <tr>
                  <td colSpan={4}>No visit requests waiting.</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </Card>
      <div className="panel" style={{ padding: '6px 18px 14px' }}>
        <DataTable columns={columns} rows={d?.rows} rowKey={(r) => r.staff.id} caption="Field agents" loading={q.isPending} error={q.error} onRetry={() => void q.refetch()} download="field-ops" emptyTitle="No field agents in your teams yet." onRowClick={(r) => navigate(to('MG-Agent', { id: r.staff.id }))} />
        <div className="ceo-note">Each visit needs a shop photo before entering, a selfie and GPS · visits under 3 minutes are flagged</div>
        <div className="ceo-actions" style={{ marginTop: 12 }}>
          <ButtonLink to={to('MG-Flags')}>Visit flags</ButtonLink>
        </div>
      </div>
    </div>
  );
}
