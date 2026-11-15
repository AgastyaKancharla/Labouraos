import { useState, type FormEvent } from 'react';
import { StaffAvatar } from '../../../components/StaffAvatar';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Button } from '../../../components/Button';
import { Card } from '../../../components/Card';
import { DataTable, type Column } from '../../../components/DataTable';
import { StatusPill, type StatusTone } from '../../../components/Badge';
import { DateField, SelectField, TextField } from '../../../components/fields';
import { TopBar } from '../../../components/TopBar';
import { api } from '../../../lib/api/client';
import { ApiError } from '../../../lib/api/errors';
import { formatDateTimeIST, istDateKey } from '../../../lib/format/date';
import { useT } from '../../../i18n/I18nProvider';
import { NewTempPasswordButton, ResetSignInButton, TempPasswordModal, type TempPasswordResult } from '../../shared/staffAccess';
import { useNow } from '../../../lib/useNow';
import { useScreenPath } from '../../../portals/PortalContext';
import { ActionButton } from '../../ceo/_kit/actions';
import { roleWord, teamShort } from '../_kit/kit';

/** GET /manager/staff. */
export interface StaffRow {
  id: string;
  code: string;
  name: string;
  role: string;
  isIntern: boolean;
  team: string | null;
  teamLeadId: string | null;
  reportsTo: { id: string; name: string; role: string; isYou: boolean } | null;
  state: 'active' | 'invite_pending' | 'locked' | 'deactivated' | string;
  locked: { byManager: boolean; until: string | null; reason: string | null } | null;
  pendingDevice: { id: string; label: string; platform: string; requestedAt: string | null } | null;
  approvedDevices: { id: string; label: string; platform: string }[];
  joinedOn: string | null;
  /** Staff photo (signed link); initials when none. */
  photoUrl?: string | null;
}
interface StaffResponse {
  manager: { id: string; name: string };
  rows: StaffRow[];
  /** Team Leads (active or not signed in yet) and the Manager themself. */
  reportsToOptions: { id: string; name: string; role: string; team: string | null; notSignedInYet?: boolean }[];
  creatableRoles: string[];
}

function statusOf(r: StaffRow): { text: string; tone: StatusTone } {
  if (r.state === 'locked' && r.locked) {
    return { text: r.locked.byManager ? `Locked${r.locked.reason ? ` · ${r.locked.reason}` : ''}` : `Locked · ${r.locked.reason ?? 'wrong passwords'}`, tone: 'danger' };
  }
  if (r.state === 'invite_pending') return { text: 'Not signed in yet', tone: 'info' };
  if (r.pendingDevice) return { text: 'New device waiting', tone: 'warn' };
  return { text: 'Active', tone: 'good' };
}

const ROLE_OPTIONS = [
  { value: 'call_agent', label: 'Call agent' },
  { value: 'field_agent', label: 'Field agent' },
  { value: 'call_agent:intern', label: 'Call agent (intern)' },
  { value: 'field_agent:intern', label: 'Field agent (intern)' },
  { value: 'team_lead', label: 'Team Lead' },
];

/**
 * Staff & access — design MG-Staff.dc.html, on GET /manager/staff plus the
 * staff endpoints: "New temporary password" and "Reset sign-in completely"
 * (Master Guide rev 174–175), lock and unlock with a reason,
 * approve a new device, change Team Lead, remove a lost phone, and "Add a
 * staff member" (Team Lead, call agent, field agent or intern, inside the
 * Manager's own teams). No salaries; a Manager cannot create a Manager or CEO.
 */
export default function StaffAndAccess() {
  const t = useT();
  const to = useScreenPath();
  const now = useNow();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['manager', 'staff'], queryFn: () => api.get<StaffResponse>('/manager/staff') });
  const d = q.data;
  const [shown, setShown] = useState<TempPasswordResult | null>(null);

  // Add a staff member
  const [name, setName] = useState('');
  const [role, setRole] = useState<string>('call_agent');
  const [reportsTo, setReportsTo] = useState('');
  const [joinedOn, setJoinedOn] = useState(() => istDateKey(now));
  const [formError, setFormError] = useState<string | null>(null);
  const [baseRole, intern] = role.split(':');
  const forLead = baseRole === 'team_lead';
  const reportOptions = (d?.reportsToOptions ?? [])
    .filter((o) => (forLead ? o.role === 'manager' : o.role === 'team_lead'))
    .map((o) => ({
      value: o.id,
      label: o.role === 'manager' ? `${o.name} · you (for a new Team Lead)` : `${o.name} · Team Lead · ${teamShort(o.team)}${o.notSignedInYet ? ` ${t('access.boss.notSignedIn')}` : ''}`,
    }));
  const chosenReport = reportOptions.some((o) => o.value === reportsTo) ? reportsTo : (reportOptions[0]?.value ?? '');

  const create = useMutation({
    mutationFn: () =>
      api.post<TempPasswordResult>('/staff', {
        name: name.trim(),
        role: baseRole,
        ...(forLead ? { reportsToId: chosenReport } : { teamLeadId: chosenReport }),
        intern: intern === 'intern',
        joinedOn: joinedOn || null,
      }),
    onSuccess: (res) => {
      setName('');
      setFormError(null);
      setShown(res);
      void qc.invalidateQueries();
    },
    onError: (e) => setFormError(e instanceof ApiError ? e.message : 'Could not add the staff member. Try again.'),
  });

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!name.trim()) {
      setFormError('Write their full name');
      return;
    }
    if (!chosenReport) {
      setFormError(forLead ? 'Pick who the Team Lead reports to' : 'Every agent must have a Team Lead — add a Team Lead first');
      return;
    }
    create.mutate();
  };

  const leads = (d?.reportsToOptions ?? []).filter((o) => o.role === 'team_lead');

  const actions = (r: StaffRow) => {
    const isAgent = r.role === 'call_agent' || r.role === 'field_agent';
    return (
      <div className="ceo-actions" onClick={(e) => e.stopPropagation()}>
        {r.pendingDevice && (
          <ActionButton
            label="Approve device"
            variant="success"
            title={`Approve ${r.name}'s new device`}
            description={`${r.pendingDevice.label} (${r.pendingDevice.platform})${r.pendingDevice.requestedAt ? `, asked ${formatDateTimeIST(r.pendingDevice.requestedAt)}` : ''}.`}
            run={() => api.post(`/staff/devices/${r.pendingDevice?.id}/approve`)}
            success="Device approved"
            confirmLabel="Approve"
          />
        )}
        {r.state === 'locked' && (
          <ActionButton label="Unlock" variant="success" title={`Unlock ${r.name}`} reason run={({ reason }) => api.post(`/staff/${r.id}/unlock`, { reason })} success={`${r.name} can sign in again`} confirmLabel="Unlock" />
        )}
        {/* Rev 174–175: "New temporary password" replaces the invite and reset links; a Manager can do it for people below Manager in their teams. */}
        <NewTempPasswordButton id={r.id} name={r.name} />
        {r.state !== 'invite_pending' && <ResetSignInButton id={r.id} name={r.name} />}
        {isAgent && leads.length > 1 && (
          <ActionButton
            label="Change Team Lead"
            title={`Change ${r.name}'s Team Lead`}
            description="Their requests, targets and open work move to the new Team Lead · both Team Leads are told."
            choice={{ label: 'New Team Lead', options: leads.filter((l) => l.id !== r.teamLeadId).map((l) => ({ value: l.id, label: `${l.name} · ${teamShort(l.team)}` })) }}
            reason
            run={({ choice, reason }) => api.post(`/staff/${r.id}/reporting-line`, { reportsToId: choice, reason })}
            success="Team Lead changed"
            confirmLabel="Change"
          />
        )}
        {r.role === 'field_agent' && r.approvedDevices.length > 0 && (
          <ActionButton
            label="Remove lost phone"
            variant="danger"
            title={`Remove ${r.name}'s phone`}
            description="The phone can no longer sign in. Their next phone needs approving."
            choice={{ label: 'Phone', options: r.approvedDevices.map((dv) => ({ value: dv.id, label: `${dv.label} (${dv.platform})` })) }}
            run={({ choice }) => api.post(`/staff/devices/${choice}/revoke`)}
            success="Phone removed"
            confirmLabel="Remove"
          />
        )}
        {r.state !== 'locked' && (
          <ActionButton label="Lock" variant="danger" title={`Lock ${r.name}'s account`} description="They are signed out at once and cannot sign in until someone unlocks the account." reason run={({ reason }) => api.post(`/staff/${r.id}/lock`, { reason })} success={`${r.name} is locked`} confirmLabel="Lock" />
        )}
        <ActionButton
          label="Deactivate"
          variant="danger"
          title={`Deactivate ${r.name}`}
          description="For someone who has left. Their records stay; they can never sign in again unless reactivated. Anyone who reports to them must be moved first."
          run={() => api.post(`/staff/${r.id}/deactivate`)}
          success={`${r.name} is deactivated`}
          confirmLabel="Deactivate"
        />
      </div>
    );
  };

  const columns: Column<StaffRow>[] = [
    { key: 'name', header: 'Name', cell: (r) => <div className="lb-name-cell"><StaffAvatar name={r.name} photoUrl={r.photoUrl} /><div><div style={{ fontWeight: 600 }}>{r.name}</div><div className="ceo-cell-sub">{r.code}</div></div></div>, filter: 'text', filterValue: (r) => `${r.name} ${r.code}`, sortValue: (r) => r.name, csv: (r) => r.name },
    { key: 'role', header: 'Role', cell: (r) => roleWord(r.role, r.isIntern), filter: 'select', filterValue: (r) => roleWord(r.role, r.isIntern), csv: (r) => roleWord(r.role, r.isIntern) },
    { key: 'team', header: 'Team', cell: (r) => teamShort(r.team), filter: 'select', filterValue: (r) => teamShort(r.team), csv: (r) => r.team, hideOnPhone: true },
    { key: 'reports', header: 'Reports to', cell: (r) => (r.reportsTo ? `${r.reportsTo.name}${r.reportsTo.isYou ? ' (you)' : ''}` : '—'), csv: (r) => r.reportsTo?.name, hideOnPhone: true },
    { key: 'status', header: 'Status', cell: (r) => { const s = statusOf(r); return <StatusPill tone={s.tone}>{s.text}</StatusPill>; }, filter: 'select', filterValue: (r) => statusOf(r).text, csv: (r) => statusOf(r).text },
    { key: 'actions', header: 'Actions', cell: actions },
  ];

  return (
    <div className="lb-page">
      <TopBar icon="teamAndAccess" iconTone="navy" back={{ to: to('MG-Home'), label: 'Command Center' }} title="Staff & access" subtitle="People in your teams, their devices and accounts." />
      <div className="panel" style={{ padding: '6px 18px 14px' }}>
        <DataTable columns={columns} rows={d?.rows} rowKey={(r) => r.id} caption="Staff in your teams" loading={q.isPending} error={q.error} onRetry={() => void q.refetch()} download="staff" emptyTitle="Nobody in your teams yet." />
        <div className="ceo-note">
          Changing someone's Team Lead moves their requests, targets and open work to the new Team Lead · both Team Leads are told · you can't see salaries or create a Manager or CEO
        </div>
      </div>
      <Card icon="jobSeekers" tone="good" title="Add a staff member">
        <form onSubmit={submit} noValidate>
          <div className="ceo-form-row">
            <TextField label="Full name" value={name} onChange={setName} placeholder="Name" required />
            <SelectField label="Role" value={role} onChange={(v) => setRole(v || 'call_agent')} options={ROLE_OPTIONS} placeholder={null} />
            <SelectField label="Reports to" value={chosenReport} onChange={(v) => setReportsTo(v)} options={reportOptions} placeholder={reportOptions.length ? null : 'Add a Team Lead first'} />
            <DateField label="Start date" value={joinedOn} onChange={setJoinedOn} />
            <div>
              <Button type="submit" variant="primary" loading={create.isPending}>
                Add · get temporary password
              </Button>
            </div>
          </div>
          {formError && (
            <p className="ceo-error" role="alert">
              {formError}
            </p>
          )}
          <div className="ceo-note">Every agent must have a Team Lead and every Team Lead a Manager. Leave, corrections, login codes, targets and reports follow this line automatically.</div>
        </form>
      </Card>
      <TempPasswordModal result={shown} onClose={() => setShown(null)} />
    </div>
  );
}
