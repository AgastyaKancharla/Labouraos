import { useQuery } from '@tanstack/react-query';
import { useNavigate, useParams } from 'react-router-dom';
import { Card } from '../../../components/Card';
import { ErrorState } from '../../../components/ErrorState';
import { StatGrid, StatTile } from '../../../components/StatTile';
import { StatusPill } from '../../../components/Badge';
import { TopBar } from '../../../components/TopBar';
import { api } from '../../../lib/api/client';
import { formatDayMonthIST } from '../../../lib/format/date';
import { useScreenPath } from '../../../portals/PortalContext';
import { hm } from '../../ceo/_kit/format';
import { hoursText, paceText, paceTone, type Forecast } from '../_kit/kit';
import { NoteActions, NotesList, type CoachingNote } from '../_kit/Notes';

interface TeamResponse {
  teamLead: { id: string; code: string; name: string };
  team: string;
  placed: Forecast;
  attendancePercent: number | null;
  lostThisWeekSeconds: number;
  averageAnswerHours: number | null;
  requestsWaiting: number;
  claimsDecided: number;
  claimsOnTime: number;
  members: { staff: { id: string; code: string; name: string; role: string; isIntern: boolean }; percent: number | null; pace: string; lateLogins: number; lateMinutes: number; leaveLeft: number }[];
  ownWork: {
    workedDays: number;
    expectedDays: number;
    lateLogins: number;
    loginCodesGiven: number;
    visitsAssigned: number;
    visitsOpen: number;
    claimsLateHours: number[];
    leave: { id: string; from: string; to: string; status: string; decidedBy: string | null; decidedByYou: boolean }[];
  };
  notes: CoachingNote[];
}

/**
 * One Team Lead's scorecard — design MG-TL.dc.html, on GET /manager/teams/:id:
 * the team's results, the members, how the Team Lead runs it, and coaching
 * notes (and written warnings, which only a Manager gives).
 */
export default function TeamLeadScorecard() {
  const to = useScreenPath();
  const navigate = useNavigate();
  const { id = '' } = useParams<{ id: string }>();
  const q = useQuery({ queryKey: ['manager', 'team', id], queryFn: () => api.get<TeamResponse>(`/manager/teams/${encodeURIComponent(id)}`) });
  const d = q.data;
  const first = d?.teamLead.name.split(/\s+/)[0] ?? '';
  const leaveText = (l: TeamResponse['ownWork']['leave'][number]) => {
    const dates = l.from === l.to ? formatDayMonthIST(l.from) : `${formatDayMonthIST(l.from)}–${formatDayMonthIST(l.to)}`;
    if (l.status === 'approved') return `${dates} approved by ${l.decidedByYou ? 'you' : (l.decidedBy ?? '—')}`;
    if (l.status === 'rejected') return `${dates} rejected`;
    return `${dates} waiting`;
  };
  return (
    <div className="lb-page">
      <TopBar back={{ to: to('MG-Teams'), label: 'Teams' }} title={d ? `${d.team} · ${d.teamLead.name}` : 'Team'} subtitle="A Team Lead's scorecard: the team's results, how they run it, and your coaching notes." />
      {q.error ? (
        <ErrorState error={q.error} onRetry={() => void q.refetch()} />
      ) : (
        <>
          <StatGrid>
            <StatTile label="People placed at this speed" value={d ? (d.placed.target !== null ? `${d.placed.atThisSpeed} of ${d.placed.target}` : d.placed.atThisSpeed) : '—'} tone={d?.placed.verdict === 'short' ? 'red' : 'good'} loading={q.isPending} />
            <StatTile label="Attendance" value={d ? (d.attendancePercent === null ? '—' : `${d.attendancePercent}%`) : '—'} tone="good" loading={q.isPending} />
            <StatTile label="Production lost this week" value={d ? hm(d.lostThisWeekSeconds) : '—'} tone="orange" loading={q.isPending} />
            <StatTile label="Average answer to requests" value={d ? hoursText(d.averageAnswerHours) : '—'} tone="gold" loading={q.isPending} />
            <StatTile label="Claims decided in 48 h" value={d ? (d.claimsDecided ? `${d.claimsOnTime} of ${d.claimsDecided}` : '—') : '—'} tone="cyan" loading={q.isPending} />
          </StatGrid>
          <Card title="Team members">
            <div className="scrollx">
              <table>
                <thead>
                  <tr>
                    <th>Agent</th>
                    <th>Role</th>
                    <th>Of target</th>
                    <th>At this speed</th>
                    <th>Late logins</th>
                    <th>Leave left</th>
                  </tr>
                </thead>
                <tbody>
                  {d?.members.map((m) => (
                    <tr key={m.staff.id} style={{ cursor: 'pointer' }} onClick={() => navigate(to('MG-Agent', { id: m.staff.id }))}>
                      <td>
                        <b>{m.staff.name}</b>
                      </td>
                      <td>
                        {m.staff.role === 'field_agent' ? 'Field' : 'Call'}
                        {m.staff.isIntern ? ' (intern)' : ''}
                      </td>
                      <td>{m.percent === null ? '—' : `${m.percent}%`}</td>
                      <td>
                        <StatusPill tone={paceTone(m.pace)}>{paceText(m.pace)}</StatusPill>
                      </td>
                      <td>{m.lateLogins ? `${m.lateLogins} late · ${m.lateMinutes} min` : '—'}</td>
                      <td>{m.leaveLeft}</td>
                    </tr>
                  ))}
                  {d && !d.members.length && (
                    <tr>
                      <td colSpan={6}>No agents in this team yet.</td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </Card>
          <div className="two-col">
            <Card title={`${first}'s own work`}>
              <div className="mg-kv-list">
                <span>Their attendance</span>
                <span>{d ? `${d.ownWork.workedDays} of ${d.ownWork.expectedDays} days · ${d.ownWork.lateLogins ? `${d.ownWork.lateLogins} late` : 'on time'}` : '—'}</span>
                <span>Login codes given</span>
                <span>{d ? `${d.ownWork.loginCodesGiven} this month` : '—'}</span>
                <span>Visit assignments</span>
                <span>{d ? `${d.ownWork.visitsAssigned} assigned · ${d.ownWork.visitsOpen} still open` : '—'}</span>
                <span>Claims</span>
                <span>{d ? (d.ownWork.claimsLateHours.length ? `${d.ownWork.claimsLateHours.length} decided late (${d.ownWork.claimsLateHours.map((h) => `${h} h`).join(', ')})` : 'None decided late') : '—'}</span>
                <span>Leave</span>
                <span>{d ? (d.ownWork.leave.length ? d.ownWork.leave.map(leaveText).join(' · ') : 'None this month') : '—'}</span>
              </div>
            </Card>
            <Card title="Coaching notes">
              <NotesList notes={d?.notes} />
              {d && (
                <div className="ceo-actions" style={{ marginTop: 12 }}>
                  <NoteActions staffId={d.teamLead.id} name={d.teamLead.name} who={`${first} and the CEO`} />
                </div>
              )}
            </Card>
          </div>
        </>
      )}
    </div>
  );
}
