import { useState } from 'react';
import { StaffAvatar } from '../../../components/StaffAvatar';
import { useQuery } from '@tanstack/react-query';
import { Link, useNavigate } from 'react-router-dom';
import { Card } from '../../../components/Card';
import { DataTable, type Column } from '../../../components/DataTable';
import { StatusPill } from '../../../components/Badge';
import { TopBar } from '../../../components/TopBar';
import { api } from '../../../lib/api/client';
import { useScreenPath } from '../../../portals/PortalContext';
import { FilterPanel, SearchField, SelectFilter } from '../../ceo/_kit/kit';
import { useTeam, type Brief } from '../_kit/api';

/** Agents — design T-Agents.dc.html. */
interface AgentRow {
  staff: Brief & { photoUrl?: string | null };
  main: { label: string; target: number | null; done: number; projection: number; verdict: string | null; onTrack: boolean | null };
  attendance: { present: number; workingDays: number };
  lateLogins: { count: number; minutes: number };
  leaveLeft: number;
  callQuality: number | null;
}

export default function TeamLeadAgents() {
  const to = useScreenPath();
  const navigate = useNavigate();
  const team = useTeam();
  const board = useQuery({ queryKey: ['team-lead', 'agents'], queryFn: () => api.get<{ rows: AgentRow[] }>('/team-lead/agents') });
  const [role, setRole] = useState('');
  const [speed, setSpeed] = useState('');
  const [search, setSearch] = useState('');
  const rows = (board.data?.rows ?? []).filter(
    (r) =>
      (!role || r.staff.role === role) &&
      (!speed || (speed === 'behind' ? r.main.onTrack === false : r.main.onTrack === true)) &&
      (!search.trim() || `${r.staff.name} ${r.staff.code}`.toLowerCase().includes(search.trim().toLowerCase())),
  );
  const columns: Column<AgentRow>[] = [
    { key: 'agent', header: 'Agent', cell: (r) => (
        <span className="lb-name-cell">
          <StaffAvatar name={r.staff.name} photoUrl={r.staff.photoUrl} />
          <Link to={to('T-Agent', { id: r.staff.id })}>{r.staff.name}</Link>
        </span>
      ), sortValue: (r) => r.staff.name },
    { key: 'role', header: 'Role', cell: (r) => (r.staff.role === 'field_agent' ? 'Field' : 'Call') },
    {
      key: 'main',
      header: 'Main target',
      cell: (r) => (
        <div>
          <div className="tl-strong">{r.main.target === null ? `${r.main.done} · no target` : `${r.main.done} of ${r.main.target}`}</div>
          <div className="tl-sub">{r.main.label}</div>
        </div>
      ),
      sortValue: (r) => r.main.done,
    },
    { key: 'speed', header: 'At this speed', cell: (r) => (r.main.onTrack === null ? <span className="tl-sub">—</span> : <StatusPill tone={r.main.onTrack ? 'good' : 'warn'}>{r.main.onTrack ? 'On track' : 'Behind'}</StatusPill>) },
    { key: 'att', header: 'Attendance', cell: (r) => `${r.attendance.present} of ${r.attendance.workingDays}` },
    { key: 'late', header: 'Late logins', cell: (r) => (r.lateLogins.count ? `${r.lateLogins.count} · ${r.lateLogins.minutes} min` : '0'), sortValue: (r) => r.lateLogins.count },
    { key: 'leave', header: 'Leave left', cell: (r) => r.leaveLeft, sortValue: (r) => r.leaveLeft, hideOnPhone: true },
    { key: 'quality', header: 'Call quality', cell: (r) => (r.callQuality === null ? '—' : `${r.callQuality} / 100`), sortValue: (r) => r.callQuality ?? -1, hideOnPhone: true },
  ];
  const info = team.data;
  const calls = info?.members.filter((m) => m.role === 'call_agent').map((m) => m.name) ?? [];
  const fields = info?.members.filter((m) => m.role === 'field_agent').map((m) => m.name) ?? [];
  return (
    <div className="lb-page">
      <TopBar showSearch={false} back={{ to: to('T-Home'), label: 'My team' }} title="Agents" subtitle={`Everyone in ${info?.teamName ?? 'your team'}: targets, attendance, leave and call quality.`} />
      <FilterPanel>
        <SelectFilter label="Role" value={role} onChange={setRole} options={[{ value: '', label: 'Everyone' }, { value: 'call_agent', label: 'Call agents' }, { value: 'field_agent', label: 'Field agents' }]} />
        <SelectFilter label="At this speed" value={speed} onChange={setSpeed} options={[{ value: '', label: 'Everyone' }, { value: 'behind', label: 'Behind' }, { value: 'on', label: 'On track' }]} />
        <SearchField value={search} onChange={setSearch} placeholder="Name or staff code" />
      </FilterPanel>
      <Card flush>
        <DataTable columns={columns} rows={board.data ? rows : undefined} rowKey={(r) => r.staff.id} caption="Agents" loading={board.isPending} error={board.error} onRetry={() => void board.refetch()} emptyTitle="No rows match these filters. Change a filter to see more." onRowClick={(r) => navigate(to('T-Agent', { id: r.staff.id }))} />
        <div className="tl-note" style={{ padding: '0 18px 14px' }}>
          Call quality = average score of the calls you listened to this month
        </div>
      </Card>
      <Card title="Who reports to you">
        <div className="tl-chain">
          <div>{info?.manager ? `${info.manager.name} · Manager · your manager` : 'No Manager set yet — ask the CEO'}</div>
          <div>
            <b>You · {info?.lead.name ?? '…'}</b> · Team Lead{info?.teamName ? ` · ${info.teamName}` : ''}
          </div>
          <div className="tl-sub">
            {calls.length ? `${calls.join(', ')} (call)` : ''}
            {calls.length && fields.length ? ' · ' : ''}
            {fields.length ? `${fields.join(', ')} (field)` : ''}
          </div>
        </div>
        <div className="tl-note">New people are added to your team by {info?.manager?.name.split(' ')[0] ?? 'your Manager'} or the CEO when their account is created.</div>
      </Card>
    </div>
  );
}
