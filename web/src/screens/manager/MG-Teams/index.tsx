import { useQuery } from '@tanstack/react-query';
import { ButtonLink } from '../../../components/Button';
import { Card } from '../../../components/Card';
import { ErrorState } from '../../../components/ErrorState';
import { StatusPill } from '../../../components/Badge';
import { TopBar } from '../../../components/TopBar';
import { api } from '../../../lib/api/client';
import { useScreenPath } from '../../../portals/PortalContext';
import { hm } from '../../ceo/_kit/format';
import { hoursText, teamShort, type Forecast } from '../_kit/kit';

interface TeamsResponse {
  manager: { id: string; name: string };
  cards: {
    teamLeadId: string;
    team: string;
    teamLead: { id: string; name: string; code: string };
    callAgents: number;
    fieldAgents: number;
    placed: Forecast;
    verdict: 'on_track' | 'behind' | 'no_target';
    attendancePercent: number | null;
    lostThisWeekSeconds: number;
    requestsWaiting: number;
    averageAnswerHours: number | null;
    claimsDecided: number;
    claimsOnTime: number;
  }[];
  reportingTree: { teamLeadId: string; team: string; teamLead: string; agents: { id: string; name: string; role: string; isIntern: boolean }[] }[];
  unassigned: { id: string; name: string; role: string }[];
  table: { teamLeadId: string; team: string; registered: number; paid: number; businessesSignedUp: number; interviewsDone: number; placed: number; lateLogins: number; openFlags: number }[];
}

function names(list: { name: string; isIntern?: boolean }[]): string {
  return list.map((a) => `${a.name}${a.isIntern ? ' (intern)' : ''}`).join(', ');
}

/**
 * Teams — design MG-Teams.dc.html, on GET /manager/teams: each Team Lead's
 * scorecard, who reports to whom and the month's counts per team.
 * "Change reporting" opens Staff & access, where Team Leads are changed.
 */
export default function Teams() {
  const to = useScreenPath();
  const q = useQuery({ queryKey: ['manager', 'teams'], queryFn: () => api.get<TeamsResponse>('/manager/teams') });
  const d = q.data;
  return (
    <div className="lb-page">
      <TopBar back={{ to: to('MG-Home'), label: 'Command Center' }} title="Teams" subtitle="Each Team Lead's scorecard: how their team delivers and how well they run it." />
      {q.error ? (
        <ErrorState error={q.error} onRetry={() => void q.refetch()} />
      ) : (
        <>
          <div className="two-col">
            {d?.cards.map((c) => (
              <Card
                key={c.teamLeadId}
                className="mg-team-card"
                title={`${c.team} · ${c.teamLead.name}`}
                aside={c.verdict === 'no_target' ? <StatusPill tone="muted">No target</StatusPill> : <StatusPill tone={c.verdict === 'on_track' ? 'good' : 'danger'}>{c.verdict === 'on_track' ? 'On track' : 'Behind'}</StatusPill>}
              >
                <dl>
                  <div>
                    <dt>Agents</dt>
                    <dd>
                      {c.callAgents} call · {c.fieldAgents} field
                    </dd>
                  </div>
                  <div>
                    <dt>People placed</dt>
                    <dd>{c.placed.target !== null ? `${c.placed.done} of ${c.placed.target} placed · at this speed ${c.placed.atThisSpeed}` : `${c.placed.done} placed · no target`}</dd>
                  </div>
                  <div>
                    <dt>Attendance this month</dt>
                    <dd>{c.attendancePercent === null ? '—' : `${c.attendancePercent}%`}</dd>
                  </div>
                  <div>
                    <dt>Work time lost</dt>
                    <dd>{hm(c.lostThisWeekSeconds)} this week</dd>
                  </div>
                  <div>
                    <dt>Requests waiting</dt>
                    <dd>{c.requestsWaiting}</dd>
                  </div>
                  <div>
                    <dt>Answer time</dt>
                    <dd>{c.averageAnswerHours === null ? '—' : `${hoursText(c.averageAnswerHours)} average`}</dd>
                  </div>
                  <div>
                    <dt>Claims decided in 48 h</dt>
                    <dd>{c.claimsDecided ? `${c.claimsOnTime} of ${c.claimsDecided}` : '—'}</dd>
                  </div>
                </dl>
                <div className="ceo-actions" style={{ marginTop: 12 }}>
                  <ButtonLink to={to('MG-TL', { id: c.teamLeadId })} variant="primary">
                    Open scorecard
                  </ButtonLink>
                  <ButtonLink to={to('MG-Agents')}>Agents</ButtonLink>
                </div>
              </Card>
            ))}
          </div>
          {d && !d.cards.length && (
            <Card>
              <p className="ceo-sub" style={{ margin: 0 }}>
                No Team Leads report to you yet. The CEO gives you teams; you can add a Team Lead on Staff &amp; access.
              </p>
            </Card>
          )}
          <Card title="Who reports to whom" aside={<ButtonLink to={to('MG-Staff')}>Change reporting</ButtonLink>}>
            <div className="mg-tree">
              <div>
                <b>{d?.manager.name ?? '…'}</b> · Manager · reports to the CEO
              </div>
              {d?.reportingTree.map((t) => (
                <div key={t.teamLeadId}>
                  <div className="mg-tree-lead">
                    <b>{t.teamLead}</b> · Team Lead · {teamShort(t.team)}
                  </div>
                  <div className="mg-tree-agents">
                    {[
                      t.agents.filter((a) => a.role === 'call_agent').length ? `${names(t.agents.filter((a) => a.role === 'call_agent'))} (call)` : null,
                      t.agents.filter((a) => a.role === 'field_agent').length ? `${names(t.agents.filter((a) => a.role === 'field_agent'))} (field)` : null,
                    ]
                      .filter(Boolean)
                      .join(' · ') || 'No agents yet'}
                  </div>
                </div>
              ))}
              {d && d.unassigned.length > 0 && <div className="ceo-error">Without a Team Lead: {names(d.unassigned)}</div>}
            </div>
          </Card>
          <Card>
            <div className="scrollx">
              <table>
                <thead>
                  <tr>
                    <th>Team</th>
                    <th>Registrations</th>
                    <th>Paid</th>
                    <th>Businesses</th>
                    <th>Interviews</th>
                    <th>Placements</th>
                    <th>Late logins</th>
                    <th>Flags open</th>
                  </tr>
                </thead>
                <tbody>
                  {d?.table.map((r) => (
                    <tr key={r.teamLeadId}>
                      <td>
                        <b>{teamShort(r.team)}</b>
                      </td>
                      <td>{r.registered}</td>
                      <td>{r.paid}</td>
                      <td>{r.businessesSignedUp}</td>
                      <td>{r.interviewsDone}</td>
                      <td>{r.placed}</td>
                      <td>{r.lateLogins}</td>
                      <td>{r.openFlags}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="mg-note">This month so far · you look after {d?.cards.length ? d.cards.map((c) => teamShort(c.team)).join(' and ') : 'no teams yet'} · the CEO can give you more teams</div>
          </Card>
        </>
      )}
    </div>
  );
}
