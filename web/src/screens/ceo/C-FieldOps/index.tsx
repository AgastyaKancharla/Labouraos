import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Card } from '../../../components/Card';
import { DataTable, type Column } from '../../../components/DataTable';
import { StatGrid, StatTile } from '../../../components/StatTile';
import { StatusPill } from '../../../components/Badge';
import { TopBar } from '../../../components/TopBar';
import { api } from '../../../lib/api/client';
import { formatDateTimeIST, formatTimeIST } from '../../../lib/format/date';
import { periodFor, periodToUtcRange, type Period } from '../../../lib/period';
import { useNow } from '../../../lib/useNow';
import { useScreenPath } from '../../../portals/PortalContext';
import { ActionButton } from '../_kit/actions';
import { initials, liveLabel } from '../_kit/format';
import { humanize } from '../_kit/kit';

/** Field operations — design C-FieldOps.dc.html. Location is saved only at login, at visits and on calls. */
interface Biz {
  id: string;
  code: string;
  name: string;
  locality: string | null;
}
interface AgentRow {
  staff: { id: string; name: string; team: string | null };
  now: { status: string; since: string | null } | null;
  lastVisit: { business: string; area: string | null; at: string } | null;
  visits: number;
  onboarded: number;
  vacancies: number;
  shown: number;
  interviews: number;
  geofenceMismatches: number;
  openFlags: string[];
}
interface FieldOps {
  summary: { visits: number; onboarded: number; vacanciesThisWeek: number; visitToOnboardPercent: number; geofenceMismatches: number; openFlags: number };
  agentsNow: { staff: { id: string; name: string }; status: string; area: string | null; lastCheckInAt: string | null }[];
  proof: { id: string; at: string; business: Biz; agent: { id: string; name: string } | null; hasSelfie: boolean; photoLive: boolean | null; geofenceFlag: boolean; flag: { id: string; code: string; kind: string } | null }[];
  rows: AgentRow[];
  requests: { id: string; business: Biz; purpose: string; createdAt: string; suggested: { id: string; name: string } | null }[];
  revisits: { id: string; business: Biz; purpose: string; agent: { id: string; name: string } | null; since: string }[];
  agents: { id: string; name: string }[];
}

export default function FieldOpsScreen() {
  const to = useScreenPath();
  const now = useNow();
  const [period, setPeriod] = useState<Period>(() => periodFor('today', now));
  const range = periodToUtcRange(period);
  const fo = useQuery({ queryKey: ['ceo', 'field-ops', range], queryFn: () => api.get<FieldOps>('/ceo/field-ops', { query: range }), refetchInterval: 30_000 });
  const d = fo.data;
  const s = d?.summary;
  const today = period.preset === 'today';

  const nowText = (r: AgentRow) => {
    const l = liveLabel(r.now?.status ?? 'not_logged_in').label;
    return r.now?.status === 'on_visit' && r.lastVisit ? `${l} · ${r.lastVisit.business}` : l;
  };
  const columns: Column<AgentRow>[] = [
    { key: 'agent', header: 'Agent', cell: (r) => <strong>{r.staff.name}</strong>, filter: 'text', filterValue: (r) => r.staff.name, sortValue: (r) => r.staff.name, csv: (r) => r.staff.name },
    { key: 'now', header: 'Now', cell: (r) => <StatusPill tone={liveLabel(r.now?.status ?? 'not_logged_in').tone}>{nowText(r)}</StatusPill>, filter: 'select', filterValue: (r) => liveLabel(r.now?.status ?? 'not_logged_in').label, csv: nowText },
    { key: 'visits', header: 'Visits', cell: (r) => r.visits, sortValue: (r) => r.visits, csv: (r) => r.visits, align: 'right' },
    { key: 'onb', header: 'Onboarded', cell: (r) => r.onboarded, sortValue: (r) => r.onboarded, csv: (r) => r.onboarded, align: 'right' },
    { key: 'vac', header: 'Vacancies', cell: (r) => r.vacancies, sortValue: (r) => r.vacancies, csv: (r) => r.vacancies, align: 'right' },
    { key: 'shown', header: 'Shown', cell: (r) => r.shown, csv: (r) => r.shown, align: 'right', hideOnPhone: true },
    { key: 'int', header: 'Interviews', cell: (r) => r.interviews, csv: (r) => r.interviews, align: 'right', hideOnPhone: true },
    { key: 'geo', header: 'GPS mismatches', cell: (r) => r.geofenceMismatches || '—', csv: (r) => r.geofenceMismatches, align: 'right', hideOnPhone: true },
    { key: 'flags', header: 'Flags', cell: (r) => (r.openFlags.length ? <StatusPill tone="warn">{[...new Set(r.openFlags)].map((k) => humanize(k)).join(', ')}</StatusPill> : '—'), filter: 'select', filterValue: (r) => (r.openFlags.length ? 'Flagged' : 'None'), csv: (r) => r.openFlags.join(' ') },
  ];
  const agentOptions = (d?.agents ?? []).map((a) => ({ value: a.id, label: a.name }));

  return (
    <div className="lb-page">
      <TopBar back={{ to: to('Main'), label: 'Command Center' }} title="Field operations" subtitle="Where field agents are, what they've done today, and visit proof to check." period={period} onPeriodChange={setPeriod} />
      <StatGrid>
        <StatTile label={today ? 'Shop visits today' : 'Shop visits'} value={s?.visits ?? '—'} tone="navy" loading={fo.isPending} />
        <StatTile label={today ? 'Onboarded today' : 'Onboarded'} value={s?.onboarded ?? '—'} tone="good" loading={fo.isPending} />
        <StatTile label="Vacancies this week" value={s?.vacanciesThisWeek ?? '—'} tone="cyan" loading={fo.isPending} to={to('C-Vacancies')} />
        <StatTile label="Visit → onboard rate" value={s ? `${s.visitToOnboardPercent}%` : '—'} tone="royal" loading={fo.isPending} />
        <StatTile label="Geofence mismatch" value={s?.geofenceMismatches ?? '—'} tone="orange" loading={fo.isPending} />
        <StatTile label="Open field flags" value={s?.openFlags ?? '—'} tone="red" loading={fo.isPending} to={to('C-Audit-Flags')} />
      </StatGrid>
      <div className="two-col">
        <Card title="Agents now">
          {d && !d.agentsNow.length ? (
            <p className="ceo-sub">No field agents yet.</p>
          ) : (
            <div className="ceo-chips">
              {d?.agentsNow.map((a) => (
                <span key={a.staff.id} className="ceo-chip" title={a.lastCheckInAt ? `Last location ${formatTimeIST(a.lastCheckInAt)}` : undefined}>
                  <span className="avatar av-cyan">{initials(a.staff.name)}</span>
                  {a.staff.name.split(' ')[0]} · {a.area ?? liveLabel(a.status).label}
                </span>
              ))}
            </div>
          )}
          <p className="ceo-note">Location is saved only at login, at visits and on calls — never tracked all day.</p>
        </Card>
        <Card title="Visit proof to check">
          {d && !d.proof.length ? (
            <p className="ceo-sub">No visits to check in this period.</p>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {d?.proof.map((p) => (
                <div key={p.id} className="ceo-rule-row">
                  <span>
                    <strong>{p.business.name}</strong> · {p.agent?.name ?? '—'} · {formatTimeIST(p.at)}
                    <div className="ceo-cell-sub">
                      {p.hasSelfie ? 'Selfie' : 'No selfie'} · {p.photoLive === false ? 'photo not live' : 'live photo'}
                    </div>
                  </span>
                  <span>{p.geofenceFlag ? <StatusPill tone="warn">GPS away from pin</StatusPill> : <StatusPill tone="good">GPS at the shop</StatusPill>}</span>
                  <span className="ceo-actions">
                    {p.flag ? (
                      <>
                        <ActionButton label="Looks fine" variant="success" title="Close this flag" reason={{ label: 'What you checked', required: true }} run={({ reason }) => api.post(`/review-flags/${p.flag!.id}/resolve`, { status: 'dismissed', resolution: reason })} success="Flag closed" />
                        <span className="ceo-sub">Open on the Team Lead's flags</span>
                      </>
                    ) : (
                      <span className="ceo-sub">No flag</span>
                    )}
                  </span>
                </div>
              ))}
            </div>
          )}
        </Card>
      </div>
      <div className="panel" style={{ padding: '6px 18px 14px' }}>
        <DataTable columns={columns} rows={d?.rows} rowKey={(r) => r.staff.id} caption="Field agents" loading={fo.isPending} error={fo.error} onRetry={() => void fo.refetch()} download={`field-ops-${period.from}-${period.to}`} emptyTitle="No field agents yet." />
        <div className="ceo-note">A visit counts only with a live shop photo and GPS</div>
      </div>
      <div className="two-col">
        <Card title="Visit requests to assign">
          {d && !d.requests.length ? (
            <p className="ceo-sub">No visit requests waiting.</p>
          ) : (
            <div className="scrollx">
              <table>
                <thead><tr><th>Business lead</th><th>Why</th><th>Suggested agent</th><th /></tr></thead>
                <tbody>
                  {d?.requests.map((r) => (
                    <tr key={r.id}>
                      <td>{r.business.name}{r.business.locality ? ` · ${r.business.locality}` : ''}</td>
                      <td>{humanize(r.purpose)} · {formatDateTimeIST(r.createdAt)}</td>
                      <td>{r.suggested?.name ?? '—'}</td>
                      <td>
                        <ActionButton label="Assign" title={`Assign the visit to ${r.business.name}`} choice={{ label: 'Field agent', options: agentOptions, initial: r.suggested?.id }} run={({ choice }) => api.post(`/businesses/${r.business.id}/visit-assignments/${r.id}/assign`, { assignedStaffId: choice })} success="Visit assigned" disabled={!agentOptions.length} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
        <Card title="Visits assigned, not done yet">
          {d && !d.revisits.length ? (
            <p className="ceo-sub">Nothing waiting.</p>
          ) : (
            <div className="scrollx">
              <table>
                <thead><tr><th>Business</th><th>Agent</th><th>Since</th></tr></thead>
                <tbody>
                  {d?.revisits.map((r) => (
                    <tr key={r.id}>
                      <td>{r.business.name}</td>
                      <td>{r.agent?.name ?? '—'}</td>
                      <td>{formatDateTimeIST(r.since)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      </div>
    </div>
  );
}
