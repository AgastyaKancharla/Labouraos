import { useState } from 'react';
import { StaffAvatar } from '../../../components/StaffAvatar';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Button } from '../../../components/Button';
import { Card } from '../../../components/Card';
import { EmptyState, ErrorState } from '../../../components/ErrorState';
import { StatusPill } from '../../../components/Badge';
import { StatGrid, StatTile } from '../../../components/StatTile';
import { TopBar } from '../../../components/TopBar';
import { useToast } from '../../../components/Toast';
import { api } from '../../../lib/api/client';
import { ApiError } from '../../../lib/api/errors';
import { formatTimeIST } from '../../../lib/format/date';
import { useNow } from '../../../lib/useNow';
import { useScreenPath } from '../../../portals/PortalContext';
import { ActionButton } from '../../ceo/_kit/actions';
import { roleLabel } from '../../ceo/_kit/format';
import { firstName, useTeam, waitedFor } from '../_kit/api';
import '../../ceo/_kit/ceo.css';
import { NewTempPasswordButton, PendingResetCards, ResetSignInButton, usePendingResets } from '../../shared/staffAccess';
import { useT } from '../../../i18n/I18nProvider';

/** Login codes — design T-LoginCodes.dc.html: codes for the team's sign-ins, new devices, passwords and locks. */
interface Pending {
  id: string;
  createdAt: string;
  expiresAt: string;
  staff: { id: string; name: string; code: string; role: string; photoUrl?: string | null };
  staffDevice: { id: string; label: string; platform: string; status?: string };
}
interface Device {
  id: string;
  label: string;
  platform: string;
  requestedAt: string | null;
  staff: { id: string; name: string; code: string; role: string };
}
interface Access {
  codesToday: number;
  locked: Array<{ id: string; code: string; name: string; role: string; lockedUntil: string | null; lockedReason: string | null }>;
  /** Not signed in yet; expired = their temporary password ran out. */
  invites: Array<{ id: string; code: string; name: string; role: string; expired?: boolean }>;
}

export default function TeamLeadLoginCodes() {
  const t = useT();
  const to = useScreenPath();
  const resets = usePendingResets();
  const now = useNow();
  const team = useTeam();
  const pending = useQuery({ queryKey: ['login-codes', 'pending'], queryFn: () => api.get<Pending[]>('/login-codes/pending'), refetchInterval: 10_000 });
  const devices = useQuery({ queryKey: ['staff', 'devices', 'pending'], queryFn: () => api.get<Device[]>('/staff/devices/pending'), refetchInterval: 30_000 });
  const access = useQuery({ queryKey: ['team-lead', 'access'], queryFn: () => api.get<Access>('/team-lead/access'), refetchInterval: 30_000 });
  const problems = [...(access.data?.locked ?? []).map((l) => ({ ...l, kind: 'locked' as const })), ...(access.data?.invites ?? []).map((i) => ({ ...i, kind: 'invite' as const, lockedUntil: null, lockedReason: null }))];
  return (
    <div className="lb-page">
      <TopBar showSearch={false} back={{ to: to('T-Home'), label: 'My team' }} title="Login codes" subtitle="Codes for your agents' sign-in, password resets (red), new devices, passwords and locks." />
      <StatGrid>
        <StatTile label="Waiting for a code" value={pending.data?.length ?? '—'} tone="gold" loading={pending.isPending} />
        <StatTile label="Codes given today" value={access.data?.codesToday ?? '—'} tone="royal" loading={access.isPending} />
        <StatTile label="Device to approve" value={devices.data?.length ?? '—'} tone="orange" loading={devices.isPending} />
        <StatTile label="Account locked" value={access.data?.locked.length ?? '—'} tone="red" loading={access.isPending} />
      </StatGrid>
      <PendingResetCards />
      {pending.error ? (
        <ErrorState error={pending.error} onRetry={() => void pending.refetch()} />
      ) : pending.data && pending.data.length === 0 && !resets.data?.length ? (
        <Card>
          <EmptyState title="Nobody in your team is waiting for a login code." />
        </Card>
      ) : (
        <div className="two-col">
          {(pending.data ?? []).map((p) => (
            <CodeCard key={p.id} request={p} waited={waitedFor(p.createdAt, now)} />
          ))}
        </div>
      )}
      <div className="two-col">
        <Card title="New devices">
          {devices.error ? (
            <ErrorState error={devices.error} compact onRetry={() => void devices.refetch()} />
          ) : devices.data && devices.data.length === 0 ? (
            <p className="tl-sub">No new devices waiting.</p>
          ) : (
            <div className="scrollx">
              <table>
                <caption className="sr-only">New devices</caption>
                <thead>
                  <tr>
                    <th>Agent</th>
                    <th>Device</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {(devices.data ?? []).map((d) => (
                    <tr key={d.id}>
                      <td>{d.staff.name}</td>
                      <td>
                        {d.label} <span className="tl-sub">· {d.platform}</span>
                      </td>
                      <td>
                        <div className="tl-actions">
                          <ActionButton label="Approve device" variant="success" title={`Approve ${d.staff.name}'s ${d.label}`} reason={{ label: 'Note (optional)', required: false }} run={({ reason }) => api.post(`/requests/device.${d.id}/decide`, { decision: 'approved', reason: reason || undefined })} success="Device approved" />
                          <ActionButton label="Refuse" variant="danger" title={`Refuse ${d.staff.name}'s ${d.label}`} reason run={({ reason }) => api.post(`/requests/device.${d.id}/decide`, { decision: 'rejected', reason })} success="Device refused" />
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
        <Card title="Passwords and locks">
          {access.error ? (
            <ErrorState error={access.error} compact onRetry={() => void access.refetch()} />
          ) : problems.length === 0 ? (
            <p className="tl-sub">No locked accounts and nobody waiting to sign in for the first time.</p>
          ) : (
            <div className="scrollx">
              <table>
                <caption className="sr-only">Passwords and locks</caption>
                <thead>
                  <tr>
                    <th>Agent</th>
                    <th>Problem</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {problems.map((p) => (
                    <tr key={`${p.kind}-${p.id}`}>
                      <td>{p.name}</td>
                      <td>{p.kind === 'locked' ? `Locked · ${p.lockedReason ?? '5 wrong passwords'}${p.lockedUntil ? ` · until ${formatTimeIST(p.lockedUntil)}` : ''}` : t('access.state.notSignedIn')}</td>
                      <td>{p.kind === 'locked' ? <ActionButton label="Unlock" title={`Unlock ${p.name}`} run={() => api.post(`/staff/${p.id}/unlock`)} success={`${p.name} is unlocked`} /> : <NewTempPasswordButton id={p.id} name={p.name} />}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <div className="tl-chain" style={{ marginTop: 12 }}>
            <div className="tl-sub">Forgot password? They ask on the sign-in page and their request shows here in red. Lost phone? Reset their sign-in completely:</div>
            {(team.data?.members ?? []).map((m) => (
              <div key={m.id} className="tl-inline" style={{ justifyContent: 'space-between' }}>
                <span>
                  {m.name} <span className="tl-sub">· {roleLabel(m.role)}</span>
                </span>
                <span className="tl-actions">
                  <NewTempPasswordButton id={m.id} name={m.name} />
                  <ResetSignInButton id={m.id} name={m.name} />
                </span>
              </div>
            ))}
          </div>
        </Card>
      </div>
      <div className="tl-note">You sign in with your own authenticator app · nobody can see their own code</div>
    </div>
  );
}

function CodeCard({ request, waited }: { request: Pending; waited: string }) {
  const t = useT();
  const [code, setCode] = useState<string | null>(null);
  const toast = useToast();
  const qc = useQueryClient();
  const reveal = useMutation({
    mutationFn: () => api.post<{ code: string }>(`/login-codes/${request.id}/reveal`),
    onSuccess: (res) => {
      setCode(res.code);
      void qc.invalidateQueries({ queryKey: ['team-lead', 'access'] });
    },
    onError: (e) => toast.error(e instanceof ApiError ? e.message : 'Could not show the code. Try again.'),
  });
  return (
    <Card>
      <div className="ceo-req">
        <StaffAvatar name={request.staff.name} photoUrl={request.staff.photoUrl} size="lg" noPhotoLabel="No photo" />
        <div>
          <StatusPill tone="blue">{t('access.card.loginKind')}</StatusPill>
          <div className="tl-strong" style={{ marginTop: 6 }}>{request.staff.name}</div>
          <div className="tl-sub">
            {request.staff.code} · {roleLabel(request.staff.role)}
          </div>
          <div className="kv" style={{ marginTop: 10 }}>
            <span>Device</span>
            <span>
              {request.staffDevice.label}
              {request.staffDevice.status === 'approved' ? ' (approved)' : ''}
            </span>
            <span>Asked</span>
            <span>{waited === '0 min' ? 'Just now' : `${waited} ago`}</span>
          </div>
          {code && (
            <div style={{ marginTop: 12 }}>
              <div className="tl-sub">Read this out to {firstName(request.staff.name)}</div>
              <div className="tl-code" aria-live="polite">
                {code.split('').join(' ')}
              </div>
              <StatusPill tone="good">Works once until {formatTimeIST(request.expiresAt)}</StatusPill>
            </div>
          )}
          <div className="tl-actions" style={{ marginTop: 12 }}>
            {!code && (
              <Button variant="primary" onClick={() => reveal.mutate()} loading={reveal.isPending}>
                Show code
              </Button>
            )}
            <ActionButton label="Refuse" variant="danger" title={`Refuse ${request.staff.name}'s login`} description="They cannot sign in with this request. Say why." reason run={({ reason }) => api.post(`/login-codes/${request.id}/refuse`, { reason })} success="Login refused" />
          </div>
        </div>
      </div>
    </Card>
  );
}
