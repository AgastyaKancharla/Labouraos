import { useQuery } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { ButtonLink } from '../../../components/Button';
import { DataTable, type Column } from '../../../components/DataTable';
import { StatusPill } from '../../../components/Badge';
import { TopBar } from '../../../components/TopBar';
import { api } from '../../../lib/api/client';
import { useScreenPath } from '../../../portals/PortalContext';
import { paceText, paceTone, roleTeam, teamShort } from '../_kit/kit';

/** GET /manager/agents. */
export interface AgentRow {
  staff: { id: string; code: string; name: string; role: string; isIntern: boolean };
  team: string | null;
  teamLeadId: string | null;
  main: { metric: string; done: number; target: number | null; percent: number | null; atThisSpeed: number };
  pace: string;
  attendancePercent: number | null;
  lateLogins: number;
  lateMinutes: number;
  leaveLeft: number;
  openFlags: number;
}
interface AgentsResponse {
  month: { year: number; month: number; dayOfMonth: number; daysInMonth: number };
  rows: AgentRow[];
}

function roleFilter(r: AgentRow): string {
  if (r.staff.isIntern) return 'Intern';
  return r.staff.role === 'field_agent' ? 'Field agent' : 'Call agent';
}

/**
 * Agents — design MG-Agents.dc.html, on GET /manager/agents: every call and
 * field agent in the Manager's teams with their main target, attendance,
 * late logins, leave left and open flags. The filters are the table's own
 * column filters (Team, Role, At this speed, Name or staff code).
 */
export default function Agents() {
  const to = useScreenPath();
  const navigate = useNavigate();
  const q = useQuery({ queryKey: ['manager', 'agents'], queryFn: () => api.get<AgentsResponse>('/manager/agents') });

  const columns: Column<AgentRow>[] = [
    {
      key: 'agent',
      header: 'Agent',
      cell: (r) => (
        <div>
          <div style={{ fontWeight: 600 }}>{r.staff.name}</div>
          <div className="ceo-cell-sub">{roleTeam(r.staff.role, r.team, r.staff.isIntern)}</div>
        </div>
      ),
      filter: 'text',
      filterValue: (r) => `${r.staff.name} ${r.staff.code}`,
      sortValue: (r) => r.staff.name,
      csv: (r) => r.staff.name,
    },
    { key: 'team', header: 'Team', cell: (r) => teamShort(r.team), filter: 'select', filterValue: (r) => teamShort(r.team), csv: (r) => r.team, hideOnPhone: true },
    { key: 'role', header: 'Role', cell: (r) => roleFilter(r), filter: 'select', filterValue: roleFilter, csv: roleFilter, hideOnPhone: true },
    {
      key: 'main',
      header: 'Main target done',
      cell: (r) => (r.main.target ? `${r.main.percent ?? 0}% · ${r.main.done} of ${r.main.target}` : `${r.main.done} · no target`),
      sortValue: (r) => r.main.percent ?? -1,
      csv: (r) => (r.main.target ? `${r.main.done} of ${r.main.target}` : r.main.done),
    },
    { key: 'pace', header: 'At this speed', cell: (r) => <StatusPill tone={paceTone(r.pace)}>{paceText(r.pace)}</StatusPill>, filter: 'select', filterValue: (r) => paceText(r.pace), csv: (r) => paceText(r.pace) },
    { key: 'att', header: 'Attendance', cell: (r) => (r.attendancePercent === null ? '—' : `${r.attendancePercent}%`), sortValue: (r) => r.attendancePercent ?? -1, csv: (r) => r.attendancePercent },
    { key: 'late', header: 'Late logins', cell: (r) => (r.lateLogins ? `${r.lateLogins} · ${r.lateMinutes} min` : '—'), sortValue: (r) => r.lateMinutes, csv: (r) => r.lateLogins },
    { key: 'leave', header: 'Leave left', cell: (r) => r.leaveLeft, sortValue: (r) => r.leaveLeft, csv: (r) => r.leaveLeft, hideOnPhone: true },
    { key: 'flags', header: 'Flags', cell: (r) => (r.openFlags ? <StatusPill tone="danger">{String(r.openFlags)}</StatusPill> : '0'), sortValue: (r) => r.openFlags, csv: (r) => r.openFlags },
  ];

  return (
    <div className="lb-page">
      <TopBar back={{ to: to('MG-Home'), label: 'Command Center' }} title="Agents" subtitle="Every call and field agent in your teams: targets, attendance, leave and flags." actions={<ButtonLink to={to('MG-Targets')}>Leaderboard</ButtonLink>} />
      <div className="panel" style={{ padding: '6px 18px 14px' }}>
        <DataTable
          columns={columns}
          rows={q.data?.rows}
          rowKey={(r) => r.staff.id}
          caption="Agents"
          loading={q.isPending}
          error={q.error}
          onRetry={() => void q.refetch()}
          download="agents"
          emptyTitle="No agents in your teams yet."
          onRowClick={(r) => navigate(to('MG-Agent', { id: r.staff.id }))}
        />
        <div className="ceo-note">
          Main target = people placed for field agents, job seekers who paid the registration fee for call agents · at this speed = where they end on the last day of the month if they keep going like this
        </div>
      </div>
    </div>
  );
}
