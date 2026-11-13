import { useQuery } from '@tanstack/react-query';
import { StaffAvatar } from '../../../components/StaffAvatar';
import { useParams } from 'react-router-dom';
import { ButtonLink } from '../../../components/Button';
import { Card } from '../../../components/Card';
import { ErrorState } from '../../../components/ErrorState';
import { StatGrid, StatTile } from '../../../components/StatTile';
import { StatusPill, type StatusTone } from '../../../components/Badge';
import { TopBar } from '../../../components/TopBar';
import { api } from '../../../lib/api/client';
import { formatTimeIST } from '../../../lib/format/date';
import { flagWords } from '../_kit/flags';
import { useScreenPath } from '../../../portals/PortalContext';
import { ActionButton } from '../../ceo/_kit/actions';
import { hm, ms } from '../../ceo/_kit/format';
import { monthLong, teamShort, type Forecast, Verdict } from '../_kit/kit';
import { NoteActions, NotesList, type CoachingNote } from '../_kit/Notes';

interface AgentResponse {
  staff: { id: string; code: string; name: string; role: string; isIntern: boolean; photoUrl?: string | null };
  team: string | null;
  teamLeadId: string | null;
  teams: { id: string; team: string; name: string }[];
  month: { year: number; month: number; dayOfMonth: number; daysInMonth: number };
  main: { metric: string; done: number; target: number | null; atThisSpeed: number; pace: string };
  lateLogins: number;
  lateMinutes: number;
  lostSeconds: number;
  leaveLeft: { casual: number; emergency: number };
  registerToPay: number | null;
  targets: (Forecast & { key: string; label: string })[];
  attendance: { id: string; date: string; loginAt: string | null; lateMinutes: number; productionSeconds: number; dayType: string; countsAs: string; shortfallSeconds: number }[];
  quality: { averageTalkSeconds: number | null; callsThisMonth: number; stuckRegistrations: number; followUpsOverdue: number; flags: { kind: string; open: number; resolved: number }[] };
  notes: CoachingNote[];
}

function dayLabel(date: string): string {
  const d = new Date(`${date}T00:00:00Z`);
  return `${d.toLocaleDateString('en-GB', { weekday: 'short', timeZone: 'UTC' })} ${d.getUTCDate()}`;
}

function countsTone(text: string): StatusTone {
  if (/absent|not logged/i.test(text)) return 'danger';
  if (/short|late|half/i.test(text)) return 'warn';
  if (/leave|holiday|off/i.test(text)) return 'info';
  if (/working/i.test(text)) return 'blue';
  return 'good';
}

/**
 * One agent — design MG-Agent.dc.html, on GET /manager/agents/:id: targets and
 * pace, this month's attendance, work quality and coaching notes. Phone numbers
 * stay hidden. Change target opens Targets; Move to another team uses
 * POST /staff/:id/reporting-line.
 */
export default function Agent() {
  const to = useScreenPath();
  const { id = '' } = useParams<{ id: string }>();
  const q = useQuery({ queryKey: ['manager', 'agent', id], queryFn: () => api.get<AgentResponse>(`/manager/agents/${encodeURIComponent(id)}`) });
  const d = q.data;
  const he = 'Will they make it?';
  const roleWord = d ? (d.staff.role === 'field_agent' ? 'field agent' : 'call agent') + (d.staff.isIntern ? ' (intern)' : '') : '';
  const title = d ? `${d.staff.name} · ${roleWord}${d.team ? ` · ${d.team}` : ''}` : 'Agent';
  const mainLabel = d?.main.metric === 'placed' ? 'People placed · at this speed' : 'Paid the registration fee · at this speed';

  return (
    <div className="lb-page">
      <TopBar back={{ to: to('MG-Agents'), label: 'Agents' }} title={title} titleBadge={d ? <StaffAvatar name={d.staff.name} photoUrl={d.staff.photoUrl} size="md" /> : undefined} subtitle="One agent: targets and pace, attendance, quality and coaching. Phone numbers stay hidden." />
      {q.error ? (
        <ErrorState error={q.error} onRetry={() => void q.refetch()} />
      ) : (
        <>
          <StatGrid>
            <StatTile label={mainLabel} value={d ? (d.main.target ? `${d.main.atThisSpeed} of ${d.main.target}` : `${d.main.atThisSpeed}`) : '—'} tone={d?.main.pace === 'behind' ? 'red' : 'good'} loading={q.isPending} />
            <StatTile label="Late logins" value={d ? `${d.lateLogins} · ${d.lateMinutes} min` : '—'} tone="gold" loading={q.isPending} />
            <StatTile label="Work time lost" value={d ? hm(d.lostSeconds) : '—'} tone="orange" loading={q.isPending} />
            <StatTile label="Leave left" value={d ? `${d.leaveLeft.casual + d.leaveLeft.emergency} day${d.leaveLeft.casual + d.leaveLeft.emergency === 1 ? '' : 's'}` : '—'} tone="cyan" loading={q.isPending} />
            <StatTile label="Registrations that paid" value={d ? (d.registerToPay === null ? '—' : `${d.registerToPay}%`) : '—'} tone="royal" loading={q.isPending} />
          </StatGrid>
          <div className="two-col">
            <Card title={`Targets · ${d ? monthLong(d.month.month) : ''}`} aside={<ButtonLink to={to('MG-Targets')}>Change target</ButtonLink>}>
              <div className="scrollx">
                <table>
                  <thead>
                    <tr>
                      <th>What</th>
                      <th>Target</th>
                      <th>Done</th>
                      <th>At this speed</th>
                      <th>{he}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {d?.targets.map((t) => (
                      <tr key={t.key}>
                        <td>{t.label}</td>
                        <td>{t.target ?? '—'}</td>
                        <td>{t.done}</td>
                        <td>{t.atThisSpeed}</td>
                        <td>{t.verdict === 'no_target' ? '—' : <Verdict f={t} />}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Card>
            <Card title="Attendance · this month" aside={<ButtonLink to={to('MG-Attendance')}>Full report</ButtonLink>}>
              <div className="scrollx" style={{ maxHeight: 360, overflowY: 'auto' }}>
                <table>
                  <thead>
                    <tr>
                      <th>Day</th>
                      <th>Login</th>
                      <th>Production</th>
                      <th>Counts as</th>
                    </tr>
                  </thead>
                  <tbody>
                    {d?.attendance.map((a) => (
                      <tr key={a.id}>
                        <td>{dayLabel(a.date)}</td>
                        <td>{a.loginAt ? `${formatTimeIST(a.loginAt)}${a.lateMinutes ? ` · ${a.lateMinutes} late` : ''}` : '—'}</td>
                        <td>{a.loginAt ? hm(a.productionSeconds) : '—'}</td>
                        <td>
                          <StatusPill tone={countsTone(a.countsAs)}>{a.countsAs}</StatusPill>
                        </td>
                      </tr>
                    ))}
                    {d && !d.attendance.length && (
                      <tr>
                        <td colSpan={4}>No working days yet this month.</td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </Card>
          </div>
          <div className="two-col">
            <Card title="Work quality">
              <div className="mg-kv-list">
                <span>Average talk time</span>
                <span>{d ? ms(d.quality.averageTalkSeconds) : '—'}</span>
                <span>Calls this month</span>
                <span>{d?.quality.callsThisMonth ?? '—'}</span>
                <span>Registrations stuck at payment</span>
                <span>{d ? `${d.quality.stuckRegistrations} (over 24 h)` : '—'}</span>
                <span>Follow-ups overdue</span>
                <span>{d?.quality.followUpsOverdue ?? '—'}</span>
                <span>Flags (60 days)</span>
                <span>{d ? (d.quality.flags.length ? d.quality.flags.map((f) => `${f.open + f.resolved} · ${flagWords(f.kind)}${f.open ? '' : ' (resolved)'}`).join(', ') : 'None') : '—'}</span>
              </div>
            </Card>
            <Card title="Coaching notes">
              <NotesList notes={d?.notes} />
              {d && (
                <div className="ceo-actions" style={{ marginTop: 12 }}>
                  <NoteActions staffId={d.staff.id} name={d.staff.name} who={`${d.staff.name.split(/\s+/)[0]}'s Team Lead, Managers and the CEO`} />
                  <ActionButton
                    label="Move to another team"
                    title={`Move ${d.staff.name} to another team`}
                    description="Their requests, targets and open work move to the new Team Lead · both Team Leads are told."
                    choice={{ label: 'New Team Lead', options: d.teams.filter((t) => t.id !== d.teamLeadId).map((t) => ({ value: t.id, label: `${t.name} · ${teamShort(t.team)}` })) }}
                    reason
                    disabled={d.teams.filter((t) => t.id !== d.teamLeadId).length === 0}
                    run={({ choice, reason }) => api.post(`/staff/${d.staff.id}/reporting-line`, { reportsToId: choice, reason })}
                    success="Moved to the new team"
                    confirmLabel="Move"
                  />
                </div>
              )}
            </Card>
          </div>
        </>
      )}
    </div>
  );
}
