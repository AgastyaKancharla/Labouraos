import { useState, type FormEvent } from 'react';
import { StaffAvatar } from '../../../components/StaffAvatar';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Button } from '../../../components/Button';
import { Card } from '../../../components/Card';
import { DataTable, type Column } from '../../../components/DataTable';
import { Modal } from '../../../components/Modal';
import { StatusPill, type StatusTone } from '../../../components/Badge';
import { DateField, SelectField, TextField } from '../../../components/fields';
import { useToast } from '../../../components/Toast';
import { TopBar } from '../../../components/TopBar';
import { api } from '../../../lib/api/client';
import { ApiError } from '../../../lib/api/errors';
import { formatDateTimeIST, istDateKey } from '../../../lib/format/date';
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
  reportsToOptions: { id: string; name: string; role: string; team: string | null }[];
  creatableRoles: string[];
}

/** One-time link returned by create, re-invite and reset (shown once; only its hash is stored). */
interface LinkResult {
  title: string;
  name: string;
  code: string;
  url: string;
  expiresAt: string;
  note: string;
}

function statusOf(r: StaffRow): { text: string; tone: StatusTone } {
  if (r.state === 'locked' && r.locked) {
    return { text: r.locked.byManager ? `Locked${r.locked.reason ? ` · ${r.locked.reason}` : ''}` : `Locked · ${r.locked.reason ?? 'wrong passwords'}`, tone: 'danger' };
  }
  if (r.state === 'invite_pending') return { text: 'Invite not accepted', tone: 'info' };
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
 * staff endpoints: reset password (a new one-time link to the invite page —
 * the old password works until it is used), lock and unlock with a reason,
 * approve a new device, change Team Lead, remove a lost phone, and "Add a
 * staff member" (Team Lead, call agent, field agent or intern, inside the
 * Manager's own teams). No salaries; a Manager cannot create a Manager or CEO.
 */
export default function StaffAndAccess() {
  const to = useScreenPath();
  const now = useNow();
  const toast = useToast();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['manager', 'staff'], queryFn: () => api.get<StaffResponse>('/manager/staff') });
  const d = q.data;
  const [link, setLink] = useState<LinkResult | null>(null);

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
    .map((o) => ({ value: o.id, label: o.role === 'manager' ? `${o.name} · you (for a new Team Lead)` : `${o.name} · Team Lead · ${teamShort(o.team)}` }));
  const chosenReport = reportOptions.some((o) => o.value === reportsTo) ? reportsTo : (reportOptions[0]?.value ?? '');

  const create = useMutation({
    mutationFn: () =>
      api.post<{ staff: { code: string; name: string }; inviteUrl: string; inviteExpiresAt: string }>('/staff', {
        name: name.trim(),
        role: baseRole,
        ...(forLead ? { reportsToId: chosenReport } : { teamLeadId: chosenReport }),
        intern: intern === 'intern',
        joinedOn: joinedOn || null,
      }),
    onSuccess: (res) => {
      setName('');
      setFormError(null);
      setLink({
        title: 'Staff member added',
        name: res.staff.name,
        code: res.staff.code,
        url: res.inviteUrl,
        expiresAt: res.inviteExpiresAt,
        note: 'Send this link to them. They set their own password on it and sign in with their staff code. The link works once, for 72 hours.',
      });
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
        {r.state === 'locked' ? (
          <ActionButton label="Unlock" variant="success" title={`Unlock ${r.name}`} reason run={({ reason }) => api.post(`/staff/${r.id}/unlock`, { reason })} success={`${r.name} can sign in again`} confirmLabel="Unlock" />
        ) : r.state === 'invite_pending' ? (
          <ActionButton
            label="Send new invite"
            title={`New invite for ${r.name}`}
            description="The old invite link stops working."
            run={async () => {
              const res = await api.post<{ inviteUrl: string; inviteExpiresAt: string }>(`/staff/${r.id}/reissue-invite`);
              setLink({ title: 'New invite link', name: r.name, code: r.code, url: res.inviteUrl, expiresAt: res.inviteExpiresAt, note: 'Send this link to them. It works once, for 72 hours.' });
              return res;
            }}
            success="New invite ready"
            confirmLabel="Make a new link"
          />
        ) : (
          <ActionButton
            label="Reset password"
            title={`Reset ${r.name}'s password`}
            description="You get a one-time link to send them. They choose a new password on it; their old password keeps working until they use the link, then stops."
            run={async () => {
              const res = await api.post<{ resetUrl: string; expiresAt: string }>(`/staff/${r.id}/reset-password`);
              setLink({ title: 'Password reset link', name: r.name, code: r.code, url: res.resetUrl, expiresAt: res.expiresAt, note: 'Send this link to them (in person or on WhatsApp). It works once, for 72 hours. Their old password stops working once they set the new one.' });
              return res;
            }}
            success="Reset link ready"
            confirmLabel="Make the link"
          />
        )}
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

  const copy = async () => {
    if (!link) return;
    try {
      await navigator.clipboard.writeText(link.url);
      toast.success('Link copied');
    } catch {
      toast.error('Copy did not work — select the link and copy it');
    }
  };

  return (
    <div className="lb-page">
      <TopBar back={{ to: to('MG-Home'), label: 'Command Center' }} title="Staff & access" subtitle="People in your teams, their devices and accounts." />
      <div className="panel" style={{ padding: '6px 18px 14px' }}>
        <DataTable columns={columns} rows={d?.rows} rowKey={(r) => r.id} caption="Staff in your teams" loading={q.isPending} error={q.error} onRetry={() => void q.refetch()} download="staff" emptyTitle="Nobody in your teams yet." />
        <div className="ceo-note">
          Changing someone's Team Lead moves their requests, targets and open work to the new Team Lead · both Team Leads are told · you can't see salaries or create a Manager or CEO
        </div>
      </div>
      <Card title="Add a staff member">
        <form onSubmit={submit} noValidate>
          <div className="ceo-form-row">
            <TextField label="Full name" value={name} onChange={setName} placeholder="Name" required />
            <SelectField label="Role" value={role} onChange={(v) => setRole(v || 'call_agent')} options={ROLE_OPTIONS} placeholder={null} />
            <SelectField label="Reports to" value={chosenReport} onChange={(v) => setReportsTo(v)} options={reportOptions} placeholder={reportOptions.length ? null : 'Add a Team Lead first'} />
            <DateField label="Start date" value={joinedOn} onChange={setJoinedOn} />
            <div>
              <Button type="submit" variant="primary" loading={create.isPending}>
                Add · send staff code
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
      <Modal
        open={Boolean(link)}
        onClose={() => setLink(null)}
        title={link?.title ?? ''}
        footer={
          <>
            <Button onClick={() => void copy()}>Copy link</Button>
            <Button variant="primary" onClick={() => setLink(null)}>
              Done
            </Button>
          </>
        }
      >
        {link && (
          <div className="lb-stack">
            <p style={{ marginTop: 0 }}>
              <b>{link.name}</b> · staff code <span className="mono">{link.code}</span>
            </p>
            <p className="lb-break mono" style={{ wordBreak: 'break-all', background: 'var(--bg, #eef3fb)', padding: 10, borderRadius: 8 }}>
              {link.url}
            </p>
            <p className="ceo-sub">
              {link.note} Expires {formatDateTimeIST(link.expiresAt)}. This link is shown only once.
            </p>
          </div>
        )}
      </Modal>
    </div>
  );
}
