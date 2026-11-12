import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Button } from '../../../components/Button';
import { Card } from '../../../components/Card';
import { DataTable, type Column } from '../../../components/DataTable';
import { ErrorState } from '../../../components/ErrorState';
import { Modal } from '../../../components/Modal';
import { StatusPill, type StatusTone } from '../../../components/Badge';
import { DateField, SelectField, TextField } from '../../../components/fields';
import { TopBar } from '../../../components/TopBar';
import { useToast } from '../../../components/Toast';
import { api } from '../../../lib/api/client';
import { ApiError } from '../../../lib/api/errors';
import { useScreenPath } from '../../../portals/PortalContext';
import { formatDateIST } from '../../../lib/format/date';
import { FormAction } from '../../finance/_kit/kit';
import { ActionButton } from '../_kit/actions';
import { PasswordResetButton } from '../_kit/passwordReset';
import { roleLabel } from '../_kit/format';
import { TeamTabs } from '../_kit/tabs';
import '../_kit/ceo.css';

/** Team & access — design C-Team.dc.html. */
export interface TeamRow {
  id: string;
  code: string;
  name: string;
  email: string | null;
  role: string;
  team: string | null;
  reportsTo: { id: string; name: string; role: string } | null;
  state: 'active' | 'invite_pending' | 'locked' | 'deactivated';
  authenticator: boolean;
  signedIn: boolean;
  lockedUntil: string | null;
  lockedReason: string | null;
  /** Joining date (yyyy-mm-dd), entered by the CEO; pay starts on it. */
  joinedOn?: string | null;
}
interface TeamResponse {
  rows: TeamRow[];
  totals: { accounts: number; signedInNow: number; invitesPending: number; locked: number; withoutAuthenticator: number };
  organisation: {
    ceos: { id: string; name: string }[];
    managers: { id: string; name: string; teams: string[] }[];
    teamLeads: { id: string; name: string; team: string | null; manager: string | null; callAgents: number; fieldAgents: number }[];
    finance: { id: string; name: string }[];
  };
  reportsToOptions: { id: string; name: string; role: string; team: string | null }[];
}

const STATE: Record<TeamRow['state'], { label: string; tone: StatusTone }> = {
  active: { label: 'Active', tone: 'good' },
  invite_pending: { label: 'Invite not accepted', tone: 'warn' },
  locked: { label: 'Locked', tone: 'danger' },
  deactivated: { label: 'Deactivated', tone: 'muted' },
};

const ROLE_OPTIONS = [
  { value: 'call_agent', label: 'Call agent' },
  { value: 'field_agent', label: 'Field agent' },
  { value: 'team_lead', label: 'Team Lead' },
  { value: 'manager', label: 'Manager' },
  { value: 'finance', label: 'Finance' },
  { value: 'ceo', label: 'Co-founder (CEO-level)' },
];

/** Who a role reports to (guide: agents → Team Lead, Team Lead → Manager, Manager and Finance → CEO). */
export function bossRoleFor(role: string): string | null {
  if (role === 'call_agent' || role === 'field_agent') return 'team_lead';
  if (role === 'team_lead') return 'manager';
  if (role === 'manager' || role === 'finance') return 'ceo';
  return null;
}

function stateLabel(r: TeamRow) {
  const s = STATE[r.state];
  return r.state === 'active' && r.authenticator ? `${s.label} · authenticator` : s.label;
}

export function useTeam() {
  return useQuery({ queryKey: ['ceo', 'team'], queryFn: () => api.get<TeamResponse>('/ceo/team') });
}

export default function Team() {
  const to = useScreenPath();
  const team = useTeam();
  const d = team.data;
  const options = d?.reportsToOptions ?? [];

  const bossChoices = (r: TeamRow) => {
    const role = bossRoleFor(r.role);
    return options.filter((o) => o.role === role && o.id !== r.id).map((o) => ({ value: o.id, label: `${o.name} · ${roleLabel(o.role)}${o.team ? ` · ${o.team}` : ''}` }));
  };

  const columns: Column<TeamRow>[] = [
    {
      key: 'name',
      header: 'Name',
      cell: (r) => (
        <div>
          <div style={{ fontWeight: 600 }}>{r.name}</div>
          <div className="ceo-cell-sub">
            {r.code}
            {r.signedIn ? ' · signed in now' : ''}
          </div>
        </div>
      ),
      sortValue: (r) => r.name,
      filter: 'text',
      filterValue: (r) => `${r.name} ${r.code} ${r.email ?? ''}`,
      csv: (r) => r.name,
    },
    { key: 'code', header: 'Staff code', cell: (r) => <span className="code">{r.code}</span>, csv: (r) => r.code, hideOnPhone: true },
    { key: 'role', header: 'Role', cell: (r) => (r.role === 'ceo' ? 'CEO-level' : roleLabel(r.role)), filter: 'select', filterValue: (r) => roleLabel(r.role), sortValue: (r) => r.role, csv: (r) => roleLabel(r.role) },
    { key: 'team', header: 'Team', cell: (r) => r.team ?? (r.role === 'ceo' ? 'All' : '—'), filter: 'select', filterValue: (r) => r.team ?? '', csv: (r) => r.team, hideOnPhone: true },
    {
      key: 'reportsTo',
      header: 'Reports to',
      cell: (r) => (r.reportsTo ? (r.reportsTo.role === 'ceo' ? 'CEO' : `${r.reportsTo.name} (${roleLabel(r.reportsTo.role)})`) : '—'),
      csv: (r) => r.reportsTo?.name,
      hideOnPhone: true,
    },
    {
      key: 'status',
      header: 'Status',
      cell: (r) => <StatusPill tone={STATE[r.state].tone}>{stateLabel(r)}</StatusPill>,
      filter: 'select',
      filterValue: (r) => STATE[r.state].label,
      csv: (r) => stateLabel(r),
    },
    {
      key: 'actions',
      header: '',
      cell: (r) => (
        <div className="ceo-actions" onClick={(e) => e.stopPropagation()}>
          {bossRoleFor(r.role) && r.role !== 'manager' && r.role !== 'finance' && r.state !== 'deactivated' && (
            <ActionButton
              label="Change who they report to"
              title={`Change who ${r.name} reports to`}
              description="Their requests, targets, login codes and reports follow the new line straight away. Open work moves with them."
              choice={{ label: 'Reports to', options: bossChoices(r), initial: bossChoices(r).find((o) => o.value !== r.reportsTo?.id)?.value }}
              reason={{ label: 'Reason', required: false }}
              confirmLabel="Move"
              run={({ choice, reason }) => api.post(`/staff/${r.id}/reporting-line`, { reportsToId: choice, reason: reason || undefined, moveOpenWork: true })}
              success={`${r.name} now reports to the new person`}
            />
          )}
          {r.state === 'invite_pending' && <ResendInvite row={r} />}
          {(r.state === 'active' || r.state === 'locked') && <PasswordResetButton id={r.id} name={r.name} />}
          {r.state === 'locked' && (
            <ActionButton label="Unlock" title={`Unlock ${r.name}`} description={r.lockedReason ? `Locked: ${r.lockedReason}` : undefined} run={() => api.post(`/staff/${r.id}/unlock`)} success={`${r.name} is unlocked`} />
          )}
          {(r.state === 'active' || r.state === 'invite_pending') && (
            <ActionButton
              label="Lock"
              variant="danger"
              title={`Lock ${r.name}`}
              description="They are signed out everywhere and cannot sign in until someone unlocks them."
              reason
              run={({ reason }) => api.post(`/staff/${r.id}/lock`, { reason })}
              success={`${r.name} is locked`}
            />
          )}
          {r.state !== 'deactivated' && r.role !== 'ceo' && (
            <ActionButton
              label="Deactivate"
              variant="danger"
              title={`Deactivate ${r.name}`}
              description="For someone who has left. Their records stay; they can never sign in again unless reactivated."
              run={() => api.post(`/staff/${r.id}/deactivate`)}
              success={`${r.name} is deactivated`}
            />
          )}
          {r.state === 'deactivated' && <ReactivateButton row={r} />}
          {r.role !== 'ceo' && (
            <FormAction
              label={r.joinedOn ? `Joined ${formatDateIST(`${r.joinedOn}T00:00:00+05:30`)}` : 'Joining date'}
              size="compact"
              title={`Joining date · ${r.name}`}
              description="Pay starts on this day: working days before it are not paid. Leave it empty and the first login is used."
              fields={[{ name: 'joinedOn', kind: 'date', label: 'Joined on', required: true, initial: r.joinedOn ?? '' }]}
              run={(v) => api.put(`/staff/${r.id}/joined-on`, { joinedOn: v.joinedOn })}
              success={`Joining date saved for ${r.name}`}
            />
          )}
        </div>
      ),
    },
  ];

  return (
    <div className="lb-page">
      <TopBar
        back={{ to: to('Main'), label: 'Command Center' }}
        title="Team & access"
        subtitle="Your organisation, every account and what each role can see."
        actions={
          <Button variant="primary" onClick={() => document.querySelector<HTMLInputElement>('input[name="new-staff-name"]')?.focus()}>
            + Invite staff
          </Button>
        }
      />
      <TeamTabs />
      {team.error ? (
        <ErrorState error={team.error} onRetry={() => void team.refetch()} />
      ) : (
        <div className="two-col">
          <Card title="Organisation">
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8, fontSize: 13 }}>
              <div className="rule" style={{ borderLeftColor: 'var(--navy)' }}>
                <strong>CEO / founders</strong> · {d ? d.organisation.ceos.map((c) => c.name).join(' · ') || '—' : '…'} — same full powers, different titles
              </div>
              {d?.organisation.managers.map((m) => (
                <div key={m.id}>
                  <div className="rule" style={{ borderLeftColor: 'var(--royal)', marginLeft: 20 }}>
                    <strong>Manager</strong> · {m.name}
                    {m.teams.length ? ` · ${m.teams.join(' & ')}` : ' · no teams yet'}
                  </div>
                  {d.organisation.teamLeads
                    .filter((t) => t.manager === m.name)
                    .map((t) => (
                      <div key={t.id} className="rule" style={{ borderLeftColor: 'var(--cyan-raw)', marginLeft: 40, marginTop: 8 }}>
                        <strong>Team Lead</strong> · {t.name} · {t.team} · {t.callAgents} call + {t.fieldAgents} field agent{t.fieldAgents === 1 ? '' : 's'}
                      </div>
                    ))}
                </div>
              ))}
              {d?.organisation.teamLeads
                .filter((t) => !t.manager)
                .map((t) => (
                  <div key={t.id} className="rule" style={{ borderLeftColor: 'var(--cyan-raw)', marginLeft: 20 }}>
                    <strong>Team Lead</strong> · {t.name} · {t.team} · no Manager yet
                  </div>
                ))}
              {d?.organisation.finance.map((f) => (
                <div key={f.id} className="rule" style={{ borderLeftColor: 'var(--gold-raw)', marginLeft: 20 }}>
                  <strong>Finance</strong> · {f.name}
                </div>
              ))}
            </div>
          </Card>
          <Card title="Who can see what">
            <div className="kv">
              <span>CEO, founder, co-founder</span>
              <span>Everything, with every power: change, approve, refund, full numbers (logged)</span>
              <span>Manager</span>
              <span>Teams, targets, attendance, pipeline counts, quality flags — no revenue, salaries or pricing</span>
              <span>Team Lead</span>
              <span>Their own team</span>
              <span>Finance</span>
              <span>Money records, personal details masked</span>
              <span>Agents</span>
              <span>Their own work, numbers hidden</span>
            </div>
          </Card>
        </div>
      )}
      <div className="panel" style={{ padding: '6px 18px 14px' }}>
        <DataTable
          columns={columns}
          rows={d?.rows}
          rowKey={(r) => r.id}
          caption="Staff accounts"
          loading={team.isPending}
          error={team.error}
          onRetry={() => void team.refetch()}
          download="staff-accounts"
          emptyTitle="No staff accounts match these filters."
        />
        <div className="ceo-note">
          {d ? `${d.totals.accounts} staff accounts · ${d.totals.signedInNow} signed in now · ` : ''}only CEO-level people create CEO-level accounts (co-founders) and Managers; Managers create everyone below them
        </div>
      </div>
      <AddStaff options={options} />
    </div>
  );
}

function ResendInvite({ row }: { row: TeamRow }) {
  const [shown, setShown] = useState<{ code: string; token: string } | null>(null);
  return (
    <>
      <ActionButton
        label="Resend"
        title={`Resend ${row.name}'s invite`}
        description="A fresh one-time invite replaces the old one. Give it to them so they set a password."
        run={async () => {
          const res = await api.post<{ staff: { code: string }; inviteToken: string }>(`/staff/${row.id}/reissue-invite`);
          setShown({ code: res.staff.code, token: res.inviteToken });
          return res;
        }}
        success="New invite ready"
      />
      <InviteShown shown={shown} name={row.name} onClose={() => setShown(null)} />
    </>
  );
}

function ReactivateButton({ row }: { row: TeamRow }) {
  const [shown, setShown] = useState<{ code: string; token: string } | null>(null);
  return (
    <>
      <ActionButton
        label="Reactivate"
        title={`Reactivate ${row.name}`}
        description="They get a fresh invite to set a new password."
        run={async () => {
          const res = await api.post<{ staff: { code: string }; inviteToken?: string }>(`/staff/${row.id}/reactivate`);
          if (res.inviteToken) setShown({ code: res.staff.code, token: res.inviteToken });
          return res;
        }}
        success={`${row.name} is reactivated`}
      />
      <InviteShown shown={shown} name={row.name} onClose={() => setShown(null)} />
    </>
  );
}

function InviteShown({ shown, name, onClose }: { shown: { code: string; token: string } | null; name: string; onClose: () => void }) {
  const toast = useToast();
  return (
    <Modal
      open={Boolean(shown)}
      onClose={onClose}
      title={`Give these to ${name}`}
      footer={
        <Button variant="primary" onClick={onClose}>
          Done
        </Button>
      }
    >
      <p style={{ marginTop: 0 }}>The invite is shown only this once. They use it to set their own password; nobody else ever sees it.</p>
      <div className="kv">
        <span>Staff code</span>
        <span className="code">{shown?.code}</span>
        <span>One-time invite</span>
        <span className="code" style={{ wordBreak: 'break-all' }}>
          {shown?.token}
        </span>
      </div>
      <div style={{ marginTop: 12 }}>
        <Button
          onClick={() => {
            void navigator.clipboard?.writeText(`${shown?.code ?? ''} ${shown?.token ?? ''}`);
            toast.success('Copied');
          }}
        >
          Copy both
        </Button>
      </div>
    </Modal>
  );
}

function AddStaff({ options }: { options: TeamResponse['reportsToOptions'] }) {
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [role, setRole] = useState('call_agent');
  const [boss, setBoss] = useState('');
  const [joinedOn, setJoinedOn] = useState('');
  const [shown, setShown] = useState<{ code: string; token: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const toast = useToast();
  const qc = useQueryClient();
  const bossRole = bossRoleFor(role);
  const choices = options.filter((o) => o.role === bossRole).map((o) => ({ value: o.id, label: `${o.name} · ${roleLabel(o.role)}${o.team ? ` · ${o.team}` : ''}` }));
  const effectiveBoss = choices.some((c) => c.value === boss) ? boss : (choices[0]?.value ?? '');
  const needsEmail = role === 'manager' || role === 'finance' || role === 'ceo';
  const add = useMutation({
    mutationFn: () =>
      api.post<{ staff: { code: string; name: string }; inviteToken: string }>('/staff', {
        name: name.trim(),
        email: email.trim(),
        role,
        reportsToId: bossRole ? effectiveBoss || undefined : undefined,
        joinedOn: joinedOn || undefined,
      }),
    onSuccess: (res) => {
      setShown({ code: res.staff.code, token: res.inviteToken });
      toast.success(`${res.staff.name} added · staff code ${res.staff.code}`);
      setName('');
      setEmail('');
      setJoinedOn('');
      setError(null);
      void qc.invalidateQueries({ queryKey: ['ceo'] });
    },
    onError: (e) => setError(e instanceof ApiError ? e.message : 'Could not add. Try again.'),
  });
  const missing = !name.trim() || (needsEmail && !email.trim()) || (bossRole !== null && !effectiveBoss);
  return (
    <Card title="Add a staff member">
      <form
        className="ceo-form-row"
        onSubmit={(e) => {
          e.preventDefault();
          if (!missing) add.mutate();
        }}
      >
        <TextField label="Full name" value={name} onChange={setName} required placeholder="Name" name="new-staff-name" />
        <SelectField label="Role" value={role} onChange={(v) => setRole(v || 'call_agent')} options={ROLE_OPTIONS} placeholder={null} />
        {bossRole && (
          <SelectField
            label="Reports to"
            value={effectiveBoss}
            onChange={setBoss}
            placeholder={null}
            options={choices.length ? choices : [{ value: '', label: `No ${roleLabel(bossRole)} yet — add one first` }]}
          />
        )}
        <TextField label={needsEmail ? 'Email (for the authenticator)' : 'Email (optional)'} value={email} onChange={setEmail} required={needsEmail} type="email" />
        <DateField label="Joining date" value={joinedOn} onChange={setJoinedOn} hint="Pay starts on it · empty = first login" name="new-staff-joined" />
        <div style={{ alignSelf: 'flex-end' }}>
          <Button variant="primary" type="submit" loading={add.isPending} disabled={missing}>
            Add · send staff code
          </Button>
        </div>
      </form>
      {error && (
        <p role="alert" className="ceo-error">
          {error}
        </p>
      )}
      <p className="ceo-note">Agents must report to a Team Lead, Team Leads to a Manager, Managers to the CEO. Their requests, targets, login codes and reports follow this line automatically.</p>
      <InviteShown shown={shown} name="the new staff member" onClose={() => setShown(null)} />
    </Card>
  );
}
