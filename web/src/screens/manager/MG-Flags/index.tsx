import { useQuery } from '@tanstack/react-query';
import { Card } from '../../../components/Card';
import { ErrorState } from '../../../components/ErrorState';
import { StatGrid, StatTile } from '../../../components/StatTile';
import { StatusPill } from '../../../components/Badge';
import { TopBar } from '../../../components/TopBar';
import { api } from '../../../lib/api/client';
import { formatDateIST, istDateKey } from '../../../lib/format/date';
import { useNow } from '../../../lib/useNow';
import { useScreenPath } from '../../../portals/PortalContext';
import { ActionButton } from '../../ceo/_kit/actions';
import { roleTeam } from '../_kit/kit';
import { flagWords } from '../_kit/flags';

interface FlagRow {
  id: string;
  code: string;
  kind: string;
  title: string;
  subjectType: string;
  subjectId: string;
  details: Record<string, unknown> | null;
  raisedAt: string;
  staff: { id: string; code: string; name: string; role: string } | null;
  team: string | null;
  isIntern: boolean;
  ownerRole: 'team_lead' | 'manager' | 'ceo';
  goesToCeo: boolean;
  escalated: { at: string; by: { id: string; name: string; role: string } | null; note: string | null } | null;
  canResolve: boolean;
  canEscalate: boolean;
}
interface FlagsResponse {
  summary: { open: number; forCeo: number; resolvedThisMonth: number };
  rows: FlagRow[];
}

/** A short "what happened" from the flag's details, without any money (the API strips it). */
function whatHappened(f: FlagRow): string {
  const d = f.details ?? {};
  for (const key of ['message', 'summary', 'reason', 'note', 'text']) {
    const v = d[key];
    if (typeof v === 'string' && v.trim()) return v;
  }
  if (typeof d.durationSeconds === 'number') return `Visit of ${Math.round(d.durationSeconds / 60)} min`;
  return f.title;
}

function raised(iso: string, now: Date): string {
  const days = Math.round((new Date(istDateKey(now)).getTime() - new Date(istDateKey(iso)).getTime()) / 86_400_000);
  if (days <= 0) return 'Today';
  if (days === 1) return 'Yesterday';
  if (days < 7) return `${days} days`;
  return formatDateIST(iso);
}

/**
 * Flags — design MG-Flags.dc.html, on GET /manager/flags: quality and fraud
 * flags for the Manager's teams, flags sent to the Manager and flags about no
 * particular person (the same scope as GET /requests/flags). Resolve uses
 * POST /manager/flags/:id/resolve, "Send to CEO" POST /manager/flags/:id/escalate
 * with a note. Money and bypass flags never reach a Manager: they go to the CEO.
 */
export default function ManagerFlags() {
  const to = useScreenPath();
  const now = useNow();
  const q = useQuery({ queryKey: ['manager', 'flags'], queryFn: () => api.get<FlagsResponse>('/manager/flags') });
  const d = q.data;
  return (
    <div className="lb-page">
      <TopBar back={{ to: to('MG-Home'), label: 'Command Center' }} title="Flags" subtitle="Quality and fraud flags for your teams." />
      <StatGrid>
        <StatTile label="Open for your teams" value={d?.summary.open ?? '—'} tone="red" loading={q.isPending} />
        <StatTile label="Money-related · CEO decides" value={d?.summary.forCeo ?? '—'} tone="gold" loading={q.isPending} />
        <StatTile label="Resolved this month" value={d?.summary.resolvedThisMonth ?? '—'} tone="good" loading={q.isPending} />
      </StatGrid>
      {q.error ? (
        <ErrorState error={q.error} onRetry={() => void q.refetch()} />
      ) : (
        <Card>
          <div className="scrollx">
            <table>
              <thead>
                <tr>
                  <th>Flag</th>
                  <th>About</th>
                  <th>What happened</th>
                  <th>Raised</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {d?.rows.map((f) => (
                  <tr key={f.id}>
                    <td>
                      <StatusPill tone={f.goesToCeo ? 'crit' : 'warn'}>{flagWords(f.kind)}</StatusPill>
                    </td>
                    <td className="mg-what">
                      <b>{f.staff?.name ?? 'No one in particular'}</b>
                      <span>{f.staff ? roleTeam(f.staff.role, f.team, f.isIntern) : f.subjectType.replace(/_/g, ' ')}</span>
                    </td>
                    <td style={{ whiteSpace: 'normal', maxWidth: 320 }}>{whatHappened(f)}</td>
                    <td>{raised(f.raisedAt, now)}</td>
                    <td>
                      {f.goesToCeo ? (
                        <StatusPill tone="muted" title={f.escalated?.note ? `"${f.escalated.note}"` : undefined}>
                          {f.escalated ? 'Sent to the CEO' : 'Goes to CEO'}
                        </StatusPill>
                      ) : (
                        <div className="ceo-actions">
                          {f.canResolve && (
                            <ActionButton
                              label="Resolve"
                              variant="success"
                              title={`Resolve: ${flagWords(f.kind)}`}
                              reason={{ label: 'What you found and did', required: true }}
                              run={({ reason }) => api.post(`/manager/flags/${f.id}/resolve`, { resolution: reason, status: 'resolved' })}
                              success="Flag resolved"
                              confirmLabel="Resolve"
                            />
                          )}
                          {f.canEscalate && (
                            <ActionButton
                              label="Send to CEO"
                              title={`Send to the CEO: ${flagWords(f.kind)}`}
                              description="It moves to the CEO's flags with your note. Only the CEO closes it after that."
                              reason={{ label: 'Note for the CEO', required: true }}
                              run={({ reason }) => api.post(`/manager/flags/${f.id}/escalate`, { note: reason })}
                              success="Sent to the CEO"
                              confirmLabel="Send to CEO"
                            />
                          )}
                          {!f.canResolve && !f.canEscalate && <StatusPill tone="muted">{f.ownerRole === 'team_lead' ? 'With the Team Lead' : 'Not yours to close'}</StatusPill>}
                        </div>
                      )}
                    </td>
                  </tr>
                ))}
                {d && !d.rows.length && (
                  <tr>
                    <td colSpan={5}>No open flags for your teams.</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
          <div className="mg-note">You resolve flags about work quality and logins · anything about money or bypass goes to the CEO</div>
        </Card>
      )}
    </div>
  );
}
