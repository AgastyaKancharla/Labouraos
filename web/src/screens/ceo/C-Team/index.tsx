import { useState } from 'react';
import { SpokenLanguagesButton, useStaffLanguages } from './SpokenLanguages';
import { StaffAvatar } from '../../../components/StaffAvatar';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Button } from '../../../components/Button';
import { Card } from '../../../components/Card';
import { DataTable, type Column } from '../../../components/DataTable';
import { ErrorState } from '../../../components/ErrorState';
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
import { NewTempPasswordButton, SetCallingPhoneButton, ReactivateButton, ResetSignInButton, TempPasswordModal, type TempPasswordResult } from '../../shared/staffAccess';
import { useT } from '../../../i18n/I18nProvider';
import { roleLabel } from '../_kit/format';
import { TeamTabs } from '../_kit/tabs';
import { RowMenu } from '../../../components/RowMenu';
import '../_kit/ceo.css';

/** Team & access — design C-Team.dc.html. */
export interface TeamRow {
  id: string;
  code: string;
  name: string;
  email: string | null;
  role: string;
  /** CEO-level accounts: ceo, founder or co_founder. */
  title?: string | null;
  team: string | null;
  reportsTo: { id: string; name: string; role: string } | null;
  state: 'active' | 'invite_pending' | 'locked' | 'deactivated';
  authenticator: boolean;
  signedIn: boolean;
  lockedUntil: string | null;
  lockedReason: string | null;
  /** Joining date (yyyy-mm-dd), entered by the CEO; pay starts on it. */
  joinedOn?: string | null;
  /** Staff photo (signed link) — initials when none; and whether the CEO asked for a new one. */
  photoUrl?: string | null;
  photoRetakeRequested?: boolean;
  /** Owner account (owner decision 14 Nov): call or field agent accounts only. */
  ownerAccount?: boolean;
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
  /** Bosses: active or not signed in yet (labelled); never deactivated. */
  reportsToOptions: { id: string; name: string; role: string; team: string | null; notSignedInYet?: boolean }[];
}

const STATE: Record<TeamRow['state'], { label: string; tone: StatusTone }> = {
  active: { label: 'Active', tone: 'good' },
  invite_pending: { label: 'Not signed in yet', tone: 'warn' },
  locked: { label: 'Locked', tone: 'danger' },
  deactivated: { label: 'Deactivated', tone: 'muted' },
};

/** Shown wherever the CEO marks an owner account (owner decision 14 Nov). */
export const OWNER_ACCOUNT_EXPLANATION = 'Owner account: their work counts in the lists, but not in targets, leaderboard, attendance or salary';

/** Why a change can be refused (the API checks it): a month is never split between paid agent and owner account. */
const OWNER_ACCOUNT_TIMING =
  'Best set when adding them: it can only change while they have no salary and no finished attendance in a month whose salaries are not approved yet.';

const isAgentRole = (role: string) => role === 'call_agent' || role === 'field_agent';

const ROLE_OPTIONS = [
  { value: 'call_agent', label: 'Call agent' },
  { value: 'field_agent', label: 'Field agent' },
  { value: 'team_lead', label: 'Team Lead' },
  { value: 'manager', label: 'Manager' },
  { value: 'finance', label: 'Finance' },
  { value: 'ceo', label: 'Co-founder (CEO-level)' },
];

/** Who a role reports to (guide: agents → Team Lead, Team Lead → Manager, Manager and Finance → CEO). */
/** Guide, People and roles: the one top-level role's titles. */
const TITLE_LABEL: Record<string, string> = { ceo: 'CEO', founder: 'Founder', co_founder: 'Co-founder' };

export function bossRoleFor(role: string): string | null {
  if (role === 'call_agent' || role === 'field_agent') return 'team_lead';
  if (role === 'team_lead') return 'manager';
  if (role === 'manager' || role === 'finance') return 'ceo';
  return null;
}

/** Who can be someone's boss: an owner agent account may also report straight to a CEO (rev 174–175). */
export function bossRolesFor(role: string, ownerAccount: boolean): string[] {
  const main = bossRoleFor(role);
  if (!main) return [];
  return ownerAccount && isAgentRole(role) ? [main, 'ceo'] : [main];
}

/** "Asha · Team Lead · Team South (not signed in yet)". */
export function bossLabel(o: { name: string; role: string; team: string | null; notSignedInYet?: boolean }, notSignedIn: string): string {
  return `${o.name} · ${roleLabel(o.role)}${o.team ? ` · ${o.team}` : ''}${o.notSignedInYet ? ` ${notSignedIn}` : ''}`;
}

function stateLabel(r: TeamRow) {
  const s = STATE[r.state];
  return r.state === 'active' && r.authenticator ? `${s.label} · authenticator` : s.label;
}

export function useTeam() {
  return useQuery({ queryKey: ['ceo', 'team'], queryFn: () => api.get<TeamResponse>('/ceo/team') });
}

export default function Team() {
  const t = useT();
  const to = useScreenPath();
  const team = useTeam();
  const d = team.data;
  const options = d?.reportsToOptions ?? [];
  const languages = useStaffLanguages();

  const bossChoices = (r: TeamRow) => {
    const roles = bossRolesFor(r.role, Boolean(r.ownerAccount));
    return options.filter((o) => roles.includes(o.role) && o.id !== r.id).map((o) => ({ value: o.id, label: bossLabel(o, t('access.boss.notSignedIn')) }));
  };

  const columns: Column<TeamRow>[] = [
    {
      key: 'name',
      header: 'Name',
      cell: (r) => (
        <div className="lb-name-cell">
          <StaffAvatar name={r.name} photoUrl={r.photoUrl} />
          <div>
            <div style={{ fontWeight: 600 }}>{r.name}</div>
            <div className="ceo-cell-sub">
              {r.code}
              {r.ownerAccount ? ' · owner account' : ''}
              {languages.byId.get(r.id)?.length ? ` · speaks ${languages.byId.get(r.id)!.join(', ')}` : ''}
              {r.signedIn ? ' · signed in now' : ''}
              {r.photoRetakeRequested ? ' · new photo asked' : ''}
            </div>
          </div>
        </div>
      ),
      sortValue: (r) => r.name,
      filter: 'text',
      filterValue: (r) => `${r.name} ${r.code} ${r.email ?? ''}`,
      csv: (r) => r.name,
    },
    { key: 'code', header: 'Staff code', cell: (r) => <span className="code">{r.code}</span>, csv: (r) => r.code, hideOnPhone: true },
    { key: 'role', header: 'Role', cell: (r) => (r.role === 'ceo' ? (r.title ? TITLE_LABEL[r.title] ?? 'CEO-level' : 'CEO-level') : roleLabel(r.role)), filter: 'select', filterValue: (r) => roleLabel(r.role), sortValue: (r) => r.role, csv: (r) => roleLabel(r.role) },
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
      header: 'Actions',
      // 17 Nov: the row's actions sit in two menus, "Edit ▾" (profile settings) and "Access ▾" (sign-in and
      // account). Each item opens the same dialog and calls the same API as the button it replaces.
      cell: (r) => {
        const active = r.state !== 'deactivated';
        const canMove = Boolean(bossRoleFor(r.role)) && r.role !== 'manager' && r.role !== 'finance' && active;
        const canTitle = r.role === 'ceo' && active;
        const canOwner = isAgentRole(r.role) && active;
        const canLanguages = languages.loaded && active;
        const canPhoto = r.state === 'active' && r.role !== 'ceo' && !r.photoRetakeRequested;
        const canJoined = r.role !== 'ceo';
        const hasEdit = canMove || canTitle || canOwner || canLanguages || canPhoto || canJoined;
        return (
          <div className="ceo-actions" onClick={(e) => e.stopPropagation()}>
            {hasEdit && (
              <RowMenu label="Edit" name={r.name} testId={`edit-menu-${r.id}`}>
                {canMove && (
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
                {canTitle && (
                  <ActionButton
                    label="Title"
                    title={`Title for ${r.name}`}
                    description="CEO, founder and co-founder are one top-level role: same access, a different title."
                    choice={{ label: 'Title', options: Object.entries(TITLE_LABEL).map(([value, label]) => ({ value, label })), initial: r.title ?? 'ceo' }}
                    confirmLabel="Save title"
                    run={({ choice }) => api.post(`/ceo/team/${r.id}/title`, { title: choice })}
                    success="Title saved"
                  />
                )}
                {canOwner && (
                  <ActionButton
                    label={r.ownerAccount ? 'Owner account · clear' : 'Mark as owner account'}
                    title={r.ownerAccount ? `Clear owner account · ${r.name}` : `Mark ${r.name} as an owner account`}
                    description={
                      r.ownerAccount
                        ? `They go back to being a normal agent: targets, leaderboard, attendance and salary apply again from now. ${OWNER_ACCOUNT_TIMING}`
                        : `${OWNER_ACCOUNT_EXPLANATION}. They sign in like any agent: device approval and a login code each time. ${OWNER_ACCOUNT_TIMING}`
                    }
                    confirmLabel={r.ownerAccount ? 'Clear owner account' : 'Mark as owner account'}
                    run={() => api.put(`/staff/${r.id}/owner-account`, { ownerAccount: !r.ownerAccount })}
                    success={r.ownerAccount ? `${r.name} is a normal agent again` : `${r.name} is now an owner account`}
                  />
                )}
                {canLanguages && (
                  <SpokenLanguagesButton key={(languages.byId.get(r.id) ?? []).join(',')} id={r.id} name={r.name} current={languages.byId.get(r.id) ?? []} options={languages.options} />
                )}
                {canPhoto && (
                  <ActionButton
                    label="Ask for a new photo"
                    title={`New staff photo · ${r.name}`}
                    description="They take a new live camera selfie at their next login, before going on. Their current photo stays until then."
                    reason={{ label: 'Reason', required: false }}
                    confirmLabel="Ask for a new photo"
                    run={({ reason }) => api.post(`/staff/${r.id}/photo/retake`, { reason: reason || undefined })}
                    success={`${r.name} will take a new photo at their next login`}
                  />
                )}
                {canJoined && (
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
              </RowMenu>
            )}
            <RowMenu label="Access" name={r.name} testId={`access-menu-${r.id}`}>
              {active && <NewTempPasswordButton id={r.id} name={r.name} />}
              {active && <SetCallingPhoneButton id={r.id} name={r.name} />}
              {(r.state === 'active' || r.state === 'locked') && <ResetSignInButton id={r.id} name={r.name} />}
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
              {active && r.role !== 'ceo' && (
                <ActionButton
                  label="Deactivate"
                  variant="danger"
                  title={`Deactivate ${r.name}`}
                  description="For someone who has left. Their records stay; they can never sign in again unless reactivated."
                  run={() => api.post(`/staff/${r.id}/deactivate`)}
                  success={`${r.name} is deactivated`}
                />
              )}
              {r.state === 'deactivated' && <ReactivateButton id={r.id} name={r.name} />}
            </RowMenu>
          </div>
        );
      },
    },
  ];

  return (
    <div className="lb-page">
      <TopBar icon="teamAndAccess" iconTone="royal"
        back={{ to: to('Main'), label: 'Command Center' }}
        title="Team & access"
        subtitle="Your organisation, every account and what each role can see."
        actions={
          <Button variant="primary" onClick={() => document.querySelector<HTMLInputElement>('input[name="new-staff-name"]')?.focus()}>
            + Add staff
          </Button>
        }
      />
      <TeamTabs />
      {team.error ? (
        <ErrorState error={team.error} onRetry={() => void team.refetch()} />
      ) : (
        <div className="two-col">
          <Card icon="teamAndAccess" tone="navy" title="Organisation">
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
          <Card icon="consentAndPrivacy" tone="cyan" title="Who can see what">
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

function AddStaff({ options }: { options: TeamResponse['reportsToOptions'] }) {
  const t = useT();
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [role, setRole] = useState('call_agent');
  const [boss, setBoss] = useState('');
  const [joinedOn, setJoinedOn] = useState('');
  const [ownerAccount, setOwnerAccount] = useState(false);
  const [shown, setShown] = useState<TempPasswordResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const toast = useToast();
  const qc = useQueryClient();
  const bossRole = bossRoleFor(role);
  // An owner agent account may report straight to a CEO; bosses not signed in yet can be chosen.
  const bossRoles = bossRolesFor(role, ownerAccount);
  const choices = options.filter((o) => bossRoles.includes(o.role)).map((o) => ({ value: o.id, label: bossLabel(o, t('access.boss.notSignedIn')) }));
  const effectiveBoss = choices.some((c) => c.value === boss) ? boss : (choices[0]?.value ?? '');
  const add = useMutation({
    mutationFn: () =>
      api.post<TempPasswordResult>('/staff', {
        name: name.trim(),
        // Optional for every role (rev 174–175).
        email: email.trim() || undefined,
        role,
        reportsToId: bossRole ? effectiveBoss || undefined : undefined,
        joinedOn: joinedOn || undefined,
        ...(ownerAccount && isAgentRole(role) ? { ownerAccount: true } : {}),
      }),
    onSuccess: (res) => {
      setShown(res);
      toast.success(`${res.staff.name} added · staff code ${res.staff.code}`);
      setName('');
      setEmail('');
      setJoinedOn('');
      setOwnerAccount(false);
      setError(null);
      void qc.invalidateQueries({ queryKey: ['ceo'] });
    },
    onError: (e) => setError(e instanceof ApiError ? e.message : 'Could not add. Try again.'),
  });
  const missing = !name.trim() || (bossRole !== null && !effectiveBoss);
  return (
    <Card icon="jobSeekers" tone="good" title="Add a staff member">
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
        <TextField label="Email (optional)" value={email} onChange={setEmail} type="email" />
        <DateField label="Joining date" value={joinedOn} onChange={setJoinedOn} hint="Pay starts on it · empty = first login" name="new-staff-joined" />
        {isAgentRole(role) && (
          <label className="ceo-check" title={OWNER_ACCOUNT_EXPLANATION}>
            <input type="checkbox" name="new-staff-owner" checked={ownerAccount} onChange={(e) => setOwnerAccount(e.target.checked)} /> Owner account
            <span className="ceo-cell-sub" style={{ display: 'block' }}>
              {OWNER_ACCOUNT_EXPLANATION}
            </span>
          </label>
        )}
        <div style={{ alignSelf: 'flex-end' }}>
          <Button variant="primary" type="submit" loading={add.isPending} disabled={missing}>
            Add · get temporary password
          </Button>
        </div>
      </form>
      {error && (
        <p role="alert" className="ceo-error">
          {error}
        </p>
      )}
      <p className="ceo-note">
        Agents report to a Team Lead (an owner account may report to a CEO), Team Leads to a Manager, Managers to the CEO; someone not signed in yet can already be chosen. Their requests, targets, login codes and reports follow this line automatically. You get their staff code and a temporary password (24 hours, shown once) to give them.
      </p>
      <TempPasswordModal result={shown} onClose={() => setShown(null)} />
    </Card>
  );
}
