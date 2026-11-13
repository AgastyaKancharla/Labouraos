import { useQuery } from '@tanstack/react-query';
import { ButtonLink } from '../../../components/Button';
import { Card } from '../../../components/Card';
import { ErrorState } from '../../../components/ErrorState';
import { StatGrid, StatTile } from '../../../components/StatTile';
import { StatusPill, type StatusTone } from '../../../components/Badge';
import { TopBar } from '../../../components/TopBar';
import { api } from '../../../lib/api/client';
import { formatDayMonthIST } from '../../../lib/format/date';
import { useScreenPath } from '../../../portals/PortalContext';
import { monthLong, teamShort } from '../_kit/kit';
import { AttendanceTabs } from '../_kit/tabs';

interface Who {
  id: string;
  name: string;
  role: string;
  isIntern: boolean;
}
interface LeaveResponse {
  month: string;
  summary: { offToday: number; offNext7: number; withTeamLeads: number; waitingForYou: number; atOrOver3: number };
  off: {
    id: string;
    staff: Who;
    team: string | null;
    kind: string;
    from: string;
    to: string;
    days: number;
    /** "first" / "second" for a half day of leave; null for full days. */
    half?: string | null;
    status: string;
    where: string;
    withTeamLead: boolean;
    withManager: boolean;
    decidedBy: { name: string; role: string; isYou: boolean } | null;
    waitingHours: number | null;
  }[];
  heavy: { staff: Who; team: string | null; taken: number; takenDates: { from: string; to: string }[]; pending: number; wouldBe: number; requestId: string | null }[];
  balances: { staff: Who; team: string | null; plannedLeft: number; emergencyLeft: number; plannedUsedThisMonth: number; emergencyUsedThisMonth: number }[];
}

function teamRole(team: string | null, w: Who): string {
  const role = w.role === 'team_lead' ? 'Team Lead' : w.role === 'field_agent' ? 'field' : w.role === 'call_agent' ? 'call' : w.role;
  return `${teamShort(team)} · ${role}${w.isIntern ? ' (intern)' : ''}`;
}

function dates(from: string, to: string): string {
  return from === to ? formatDayMonthIST(from) : `${formatDayMonthIST(from)}–${formatDayMonthIST(to)}`;
}

function whereText(r: LeaveResponse['off'][number]): { text: string; tone: StatusTone } {
  if (r.status === 'approved') return { text: `Approved by ${r.decidedBy ? (r.decidedBy.isYou ? 'you' : r.decidedBy.name.split(/\s+/)[0]) : '—'}`, tone: 'good' };
  if (r.withManager && r.withTeamLead) return { text: 'Waiting · Team Lead and you', tone: 'warn' };
  if (r.withManager) return { text: 'Waiting · you', tone: 'warn' };
  if (r.withTeamLead) return { text: `With the Team Lead${r.waitingHours !== null ? ` · ${r.waitingHours} h` : ''}`, tone: 'info' };
  return { text: r.where, tone: 'muted' };
}

/**
 * Leave — design MG-Leave.dc.html, on GET /manager/leave: who is off in the
 * next two weeks and where every request is, people at or over 3 planned
 * days this month, and everyone's leave left. Deciding a request comes with
 * the Requests screens (build/team-lead-portal).
 */
export default function ManagerLeave() {
  const to = useScreenPath();
  const q = useQuery({ queryKey: ['manager', 'leave'], queryFn: () => api.get<LeaveResponse>('/manager/leave') });
  const d = q.data;
  const s = d?.summary;
  const monthName = d ? monthLong(Number(d.month.slice(5, 7))) : '';
  return (
    <div className="lb-page">
      <TopBar back={{ to: to('MG-Home'), label: 'Command Center' }} title="Leave" subtitle="Who is off, where every leave request is, who is taking too much leave, and how much everyone has left." />
      <AttendanceTabs />
      {q.error ? (
        <ErrorState error={q.error} onRetry={() => void q.refetch()} />
      ) : (
        <>
          <StatGrid>
            <StatTile label="Off today" value={s?.offToday ?? '—'} tone="cyan" loading={q.isPending} />
            <StatTile label="Off in the next 7 days" value={s?.offNext7 ?? '—'} tone="royal" loading={q.isPending} />
            <StatTile label="With Team Leads" value={s?.withTeamLeads ?? '—'} tone="gold" loading={q.isPending} />
            <StatTile label="Waiting for you" value={s?.waitingForYou ?? '—'} tone="gold" loading={q.isPending} to={to('MG-Requests')} />
            <StatTile label="At or over 3 planned days" value={s?.atOrOver3 ?? '—'} tone="red" loading={q.isPending} />
          </StatGrid>
          <Card title="Who is off · next 2 weeks" aside={<ButtonLink to={to('MG-Requests')}>Requests waiting for you</ButtonLink>}>
            <div className="scrollx">
              <table>
                <thead>
                  <tr>
                    <th>Date</th>
                    <th>Who</th>
                    <th className="hide-phone">Team</th>
                    <th>Type</th>
                    <th>Where the request is</th>
                  </tr>
                </thead>
                <tbody>
                  {d?.off.map((r) => {
                    const w = whereText(r);
                    return (
                      <tr key={r.id}>
                        <td>{dates(r.from, r.to)}</td>
                        <td>{r.staff.name}</td>
                        <td className="hide-phone">{teamRole(r.team, r.staff)}</td>
                        <td>
                          {r.kind === 'casual' ? 'Planned' : 'Emergency'}
                          {r.half ? ` · half day (${r.half} half)` : r.days > 1 ? ` · ${r.days} days` : ''}
                        </td>
                        <td>
                          <StatusPill tone={w.tone}>{w.text}</StatusPill>
                        </td>
                      </tr>
                    );
                  })}
                  {d && !d.off.length && (
                    <tr>
                      <td colSpan={5}>Nobody in your teams is off in the next two weeks.</td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
            <div className="mg-note">Agents ask their Team Lead · a Team Lead can forward to you · not answered in 24 hours = it shows for you too</div>
          </Card>
          <Card title={`More than 3 planned leave days · ${monthName}`}>
            <div className="scrollx">
              <table>
                <thead>
                  <tr>
                    <th>Who</th>
                    <th className="hide-phone">Team</th>
                    <th>Planned leave taken</th>
                    <th>Also</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {d?.heavy.map((h) => (
                    <tr key={h.staff.id}>
                      <td>{h.staff.name}</td>
                      <td className="hide-phone">{teamRole(h.team, h.staff)}</td>
                      <td>
                        {h.taken} day{h.taken === 1 ? '' : 's'}
                        {h.takenDates.length ? ` (${h.takenDates.map((x) => dates(x.from, x.to)).join(', ')})` : ''}
                      </td>
                      <td>
                        {h.pending ? (
                          <StatusPill tone="warn">{`Asking for ${h.pending} more · would be ${h.wouldBe} · you decide`}</StatusPill>
                        ) : (
                          <StatusPill tone="warn">{`At ${h.taken} · a ${h.taken + 1}th day comes to you`}</StatusPill>
                        )}
                      </td>
                      <td>
                        {h.requestId ? <ButtonLink to={to('MG-Requests')}>Open request</ButtonLink> : h.staff.role === 'team_lead' ? <ButtonLink to={to('MG-TL', { id: h.staff.id })}>Open profile</ButtonLink> : <ButtonLink to={to('MG-Agent', { id: h.staff.id })}>Open profile</ButtonLink>}
                      </td>
                    </tr>
                  ))}
                  {d && !d.heavy.length && (
                    <tr>
                      <td colSpan={5}>Nobody is at 3 planned leave days this month.</td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
            <div className="mg-note">Team Leads approve up to 3 planned leave days a month per person · more than 3 comes to you, and you decide how many · nothing is blocked · emergency leave isn't counted</div>
          </Card>
          <Card title="Leave left">
            <div className="scrollx">
              <table>
                <thead>
                  <tr>
                    <th>Name</th>
                    <th className="hide-phone">Team</th>
                    <th>Planned left</th>
                    <th>Emergency left</th>
                    <th className="hide-phone">Planned used in {monthName.slice(0, 3)}</th>
                    <th className="hide-phone">Emergency used in {monthName.slice(0, 3)}</th>
                  </tr>
                </thead>
                <tbody>
                  {d?.balances.map((b) => (
                    <tr key={b.staff.id}>
                      <td>{b.staff.name}</td>
                      <td className="hide-phone">{teamRole(b.team, b.staff)}</td>
                      <td>{b.plannedLeft}</td>
                      <td>{b.emergencyLeft}</td>
                      <td className="hide-phone">{b.plannedUsedThisMonth}</td>
                      <td className="hide-phone">{b.emergencyUsedThisMonth}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="mg-note">1 planned and 1 emergency day are added every month and keep adding up · only emergency leave is paid out when someone leaves</div>
          </Card>
        </>
      )}
    </div>
  );
}
