import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Button, ButtonLink } from '../../../components/Button';
import { DataTable, type Column } from '../../../components/DataTable';
import { Modal } from '../../../components/Modal';
import { StatusPill } from '../../../components/Badge';
import { SelectField, TextField } from '../../../components/fields';
import { TopBar } from '../../../components/TopBar';
import { useToast } from '../../../components/Toast';
import { api } from '../../../lib/api/client';
import { ApiError } from '../../../lib/api/errors';
import { useScreenPath } from '../../../portals/PortalContext';
import { ActionButton } from '../_kit/actions';
import { roleLabel } from '../_kit/format';
import { TeamTabs } from '../_kit/tabs';

/** Teams — design C-Teams.dc.html. A team is a Team Lead and the agents who report to them. */
interface TeamRow {
  id: string;
  code: string;
  teamName: string | null;
  team: string;
  teamLead: { id: string; name: string };
  manager: { id: string; name: string } | null;
  callAgents: number;
  fieldAgents: number;
  agents: { id: string; code: string; name: string; role: string }[];
  placementsThisMonth: number;
  activationsThisMonth: number;
  agentsBehind: number;
}
interface TeamsResponse {
  rows: TeamRow[];
  agentsWithoutTeam: { id: string; code: string; name: string; role: string }[];
  managers: { id: string; name: string }[];
  allAgents: { id: string; name: string; role: string; teamLeadId: string | null }[];
}

export default function Teams() {
  const to = useScreenPath();
  const teams = useQuery({ queryKey: ['ceo', 'teams'], queryFn: () => api.get<TeamsResponse>('/ceo/teams') });
  const [editing, setEditing] = useState<TeamRow | null>(null);
  const d = teams.data;

  const columns: Column<TeamRow>[] = [
    { key: 'team', header: 'Team', cell: (r) => <strong>{r.team}</strong>, sortValue: (r) => r.team, filter: 'text', filterValue: (r) => `${r.team} ${r.teamLead.name}`, csv: (r) => r.team },
    { key: 'lead', header: 'Team Lead', cell: (r) => r.teamLead.name, csv: (r) => r.teamLead.name },
    { key: 'manager', header: 'Manager', cell: (r) => r.manager?.name ?? <StatusPill tone="warn">No Manager</StatusPill>, filter: 'select', filterValue: (r) => r.manager?.name ?? 'No Manager', csv: (r) => r.manager?.name },
    {
      key: 'agents',
      header: 'Agents',
      cell: (r) => `${r.callAgents} call · ${r.fieldAgents} field`,
      sortValue: (r) => r.callAgents + r.fieldAgents,
      csv: (r) => `${r.callAgents} call, ${r.fieldAgents} field`,
    },
    {
      key: 'month',
      header: 'This month',
      cell: (r) => `${r.placementsThisMonth} placement${r.placementsThisMonth === 1 ? '' : 's'} · ${r.activationsThisMonth} activated`,
      sortValue: (r) => r.placementsThisMonth,
      csv: (r) => r.placementsThisMonth,
    },
    {
      key: 'pace',
      header: 'Pace',
      cell: (r) => (r.agentsBehind ? <StatusPill tone="warn">{`${r.agentsBehind} agent${r.agentsBehind === 1 ? '' : 's'} behind`}</StatusPill> : <StatusPill tone="good">On pace</StatusPill>),
      filter: 'select',
      filterValue: (r) => (r.agentsBehind ? 'Behind' : 'On pace'),
      csv: (r) => (r.agentsBehind ? `${r.agentsBehind} behind` : 'On pace'),
    },
    {
      key: 'edit',
      header: '',
      cell: (r) => (
        <Button
          onClick={(e) => {
            e.stopPropagation();
            setEditing(r);
          }}
        >
          Edit
        </Button>
      ),
    },
  ];

  return (
    <div className="lb-page">
      <TopBar back={{ to: to('C-Team'), label: 'Team & access' }} title="Teams" subtitle="Teams, their Team Leads and which Manager looks after them." />
      <TeamTabs />
      <div className="panel" style={{ padding: '6px 18px 14px' }}>
        <DataTable
          columns={columns}
          rows={d?.rows}
          rowKey={(r) => r.id}
          caption="Teams"
          loading={teams.isPending}
          error={teams.error}
          onRetry={() => void teams.refetch()}
          download="teams"
          emptyTitle="No teams yet. A team starts when you add a Team Lead."
        />
        <div className="ceo-note">A Manager sees only the teams given to them · move an agent between teams here</div>
        <div className="ceo-actions" style={{ marginTop: 12 }}>
          <ButtonLink to={to('C-Team')} variant="primary">
            + New team
          </ButtonLink>
          {d && (
            <ActionButton
              label="Move an agent"
              title="Move an agent to another team"
              description="Pick the agent; the next step picks the team. Their open work moves with them."
              choice={{
                label: 'Agent and new team',
                options: d.allAgents.flatMap((a) =>
                  d.rows
                    .filter((t) => t.id !== a.teamLeadId)
                    .map((t) => ({ value: `${a.id}|${t.id}`, label: `${a.name} (${roleLabel(a.role)}) → ${t.team}` })),
                ),
              }}
              reason={{ label: 'Reason', required: false }}
              confirmLabel="Move"
              run={({ choice, reason }) => {
                const [agentId, leadId] = choice.split('|');
                return api.post(`/staff/${agentId}/reporting-line`, { reportsToId: leadId, reason: reason || undefined, moveOpenWork: true });
              }}
              success="Agent moved"
              disabled={!d.allAgents.length || d.rows.length < 1}
            />
          )}
        </div>
        {d && d.agentsWithoutTeam.length > 0 && (
          <p className="ceo-error">
            {d.agentsWithoutTeam.length} agent{d.agentsWithoutTeam.length === 1 ? ' has' : 's have'} no team: {d.agentsWithoutTeam.map((a) => a.name).join(', ')}. Move them to a team.
          </p>
        )}
      </div>
      {editing && d && <EditTeam row={editing} managers={d.managers} onClose={() => setEditing(null)} />}
    </div>
  );
}

function EditTeam({ row, managers, onClose }: { row: TeamRow; managers: { id: string; name: string }[]; onClose: () => void }) {
  const [name, setName] = useState(row.teamName ?? '');
  const [manager, setManager] = useState(row.manager?.id ?? managers[0]?.id ?? '');
  const toast = useToast();
  const qc = useQueryClient();
  const save = useMutation({
    mutationFn: async () => {
      if ((row.teamName ?? '') !== name.trim()) await api.post(`/ceo/teams/${row.id}`, { name: name.trim() });
      if (manager && manager !== row.manager?.id) await api.post(`/staff/${row.id}/reporting-line`, { reportsToId: manager, moveOpenWork: true });
    },
    onSuccess: () => {
      toast.success(`${name.trim() || row.team} saved`);
      void qc.invalidateQueries({ queryKey: ['ceo'] });
      onClose();
    },
    onError: (e) => toast.error(e instanceof ApiError ? e.message : 'Could not save. Try again.'),
  });
  return (
    <Modal
      open
      onClose={onClose}
      title={`Edit ${row.team}`}
      dismissible={!save.isPending}
      footer={
        <>
          <Button onClick={onClose} disabled={save.isPending}>
            Cancel
          </Button>
          <Button variant="primary" onClick={() => save.mutate()} loading={save.isPending}>
            Save
          </Button>
        </>
      }
    >
      <TextField label="Team name" value={name} onChange={setName} placeholder={`Team ${row.teamLead.name.split(' ')[0]}`} maxLength={40} hint="Shown wherever the team appears. Leave empty to use the Team Lead's name." />
      <SelectField label="Manager who looks after this team" value={manager} onChange={setManager} options={managers.map((m) => ({ value: m.id, label: m.name }))} placeholder={null} />
      <p className="ceo-sub">Agents: {row.agents.length ? row.agents.map((a) => `${a.name} (${roleLabel(a.role)})`).join(', ') : 'none yet'}</p>
    </Modal>
  );
}
