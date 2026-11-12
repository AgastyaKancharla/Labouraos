import { useQuery } from '@tanstack/react-query';
import { Card } from '../../../components/Card';
import { DataTable, type Column } from '../../../components/DataTable';
import { StatusPill } from '../../../components/Badge';
import { TopBar } from '../../../components/TopBar';
import { api } from '../../../lib/api/client';
import { formatDateIST, istDateKey } from '../../../lib/format/date';
import { useNow } from '../../../lib/useNow';
import { useScreenPath } from '../../../portals/PortalContext';
import { ActionButton } from '../../ceo/_kit/actions';
import { roleLabel } from '../../ceo/_kit/format';
import { firstName, useTeam, type Brief } from '../_kit/api';

/** Flags — design T-Flags.dc.html, on GET /requests/flags (scoped to the team; Send to Manager moves the flag up). */
export interface FlagView {
  id: string;
  code: string;
  kind: string;
  title: string;
  subjectType: string;
  raisedFor: Brief | null;
  details: Record<string, unknown>;
  status: string;
  raisedAt: string;
  ownerRole: 'team_lead' | 'manager' | 'ceo';
  owner: Brief | null;
  ceoDecides: boolean;
  escalated: { at: string; by: Brief | null; note: string | null } | null;
  canResolve: boolean;
  canEscalate: boolean;
}

/** One line on what happened, from the flag's details. */
export function whatHappened(f: FlagView): string {
  const d = f.details ?? {};
  const bits: string[] = [];
  for (const key of ['businessCode', 'jobSeekerCode', 'callCode']) if (typeof d[key] === 'string') bits.push(String(d[key]));
  if (typeof d.note === 'string' && d.note) bits.push(String(d.note));
  if (typeof d.reversalReason === 'string') bits.push(String(d.reversalReason));
  if (Array.isArray(d.reasons)) bits.push((d.reasons as string[]).join(', '));
  if (typeof d.durationSeconds === 'number') bits.push(`inside ${Math.max(1, Math.round(Number(d.durationSeconds) / 60))} min`);
  return bits.join(' · ') || f.title;
}

export default function TeamLeadFlags() {
  const to = useScreenPath();
  const now = useNow();
  const team = useTeam();
  const flags = useQuery({ queryKey: ['requests', 'flags', 'open'], queryFn: () => api.get<FlagView[]>('/requests/flags', { query: { status: 'open' } }) });
  const mgr = team.data?.manager ? firstName(team.data.manager.name) : 'the Manager';
  const columns: Column<FlagView>[] = [
    { key: 'flag', header: 'Flag', cell: (f) => <div className="tl-strong">{f.title}</div>, filter: 'select', filterValue: (f) => f.title },
    { key: 'about', header: 'About', cell: (f) => <div><div className="tl-strong">{f.raisedFor?.name ?? '—'}</div><div className="tl-sub">{roleLabel(f.raisedFor?.role)}</div></div> },
    { key: 'what', header: 'What happened', cell: (f) => <span className="tl-sub">{whatHappened(f)}</span> },
    { key: 'raised', header: 'Raised', cell: (f) => (istDateKey(f.raisedAt) === istDateKey(now) ? 'Today' : formatDateIST(f.raisedAt)), sortValue: (f) => f.raisedAt },
    {
      key: 'act',
      header: '',
      cell: (f) =>
        f.ownerRole !== 'team_lead' ? (
          <StatusPill tone="info">{f.ceoDecides || f.ownerRole === 'ceo' ? 'Goes to the CEO' : `With ${mgr}`}</StatusPill>
        ) : (
          <div className="tl-actions">
            {f.canResolve && (
              <ActionButton label="Resolve" variant="primary" title={`Resolve: ${f.title}`} description="Say what you found — it stays in the flag's history." reason={{ label: 'What you found', required: true }} run={({ reason }) => api.post(`/requests/flags/${f.id}/resolve`, { resolution: reason })} success="Flag resolved" />
            )}
            {f.canEscalate && (
              <ActionButton label="Send to Manager" title={`Send to ${mgr}`} description={`${mgr} decides it from now on.`} reason={{ label: 'Note for the Manager', required: true }} run={({ reason }) => api.post(`/requests/flags/${f.id}/escalate`, { note: reason })} success={`Sent to ${mgr}`} />
            )}
          </div>
        ),
    },
  ];
  return (
    <div className="lb-page">
      <TopBar showSearch={false} back={{ to: to('T-Home'), label: 'My team' }} title="Flags" subtitle={`Quality and fraud flags for ${team.data?.teamName ?? 'your team'}.`} />
      <Card flush>
        <DataTable columns={columns} rows={flags.data} rowKey={(f) => f.id} caption="Flags" loading={flags.isPending} error={flags.error} onRetry={() => void flags.refetch()} emptyTitle="No open flags for your team." />
        <div className="tl-note" style={{ padding: '0 18px 14px' }}>
          You resolve flags about your team's work · anything about money or a business hiding a hire goes to {mgr} and the CEO
        </div>
      </Card>
    </div>
  );
}
