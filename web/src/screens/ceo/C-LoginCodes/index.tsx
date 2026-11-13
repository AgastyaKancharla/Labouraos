import { useState } from 'react';
import { StaffAvatar } from '../../../components/StaffAvatar';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Button } from '../../../components/Button';
import { Card } from '../../../components/Card';
import { DataTable, type Column } from '../../../components/DataTable';
import { EmptyState, ErrorState } from '../../../components/ErrorState';
import { StatGrid, StatTile } from '../../../components/StatTile';
import { StatusPill } from '../../../components/Badge';
import { TopBar } from '../../../components/TopBar';
import { useToast } from '../../../components/Toast';
import { api } from '../../../lib/api/client';
import { ApiError } from '../../../lib/api/errors';
import { formatDateTimeIST, formatTimeIST } from '../../../lib/format/date';
import { periodFor, periodToUtcRange, type Period } from '../../../lib/period';
import { useNow } from '../../../lib/useNow';
import { useScreenPath } from '../../../portals/PortalContext';
import { ActionButton } from '../_kit/actions';
import { PasswordResetButton } from '../_kit/passwordReset';
import { roleLabel } from '../_kit/format';

/** Login codes — design C-LoginCodes.dc.html. The same requests Managers and Team Leads see for their people. */
interface Pending {
  id: string;
  createdAt: string;
  expiresAt: string;
  onOfficeNetwork: boolean;
  status: string;
  staff: { id: string; name: string; code: string; role: string; photoUrl?: string | null };
  staffDevice: { id: string; label: string; platform: string };
}
interface Access {
  summary: { waiting: number; codesToday: number; locked: number; invitesPending: number };
  locked: { id: string; code: string; name: string; role: string; lockedUntil: string; reason: string; byManager: boolean }[];
  invites: { id: string; code: string; name: string; role: string; invitedAt: string; expired: boolean }[];
  codes: { id: string; at: string; givenBy: { id: string; name: string; role: string } | null; to: { id: string; name: string; code: string }; device: string; used: boolean }[];
}

export default function LoginCodes() {
  const to = useScreenPath();
  const now = useNow();
  const [period, setPeriod] = useState<Period>(() => periodFor('today', now));
  const range = periodToUtcRange(period);
  const pending = useQuery({ queryKey: ['login-codes', 'pending'], queryFn: () => api.get<Pending[]>('/login-codes/pending'), refetchInterval: 10_000 });
  const access = useQuery({ queryKey: ['ceo', 'access', range], queryFn: () => api.get<Access>('/ceo/access', { query: range }), refetchInterval: 30_000 });
  const a = access.data;

  const codeColumns: Column<Access['codes'][number]>[] = [
    { key: 'time', header: 'Time', cell: (r) => (period.preset === 'today' ? formatTimeIST(r.at) : formatDateTimeIST(r.at)), sortValue: (r) => r.at, csv: (r) => r.at },
    { key: 'by', header: 'Given by', cell: (r) => (r.givenBy ? `${r.givenBy.name}${r.givenBy.role === 'ceo' ? ' (CEO)' : ''}` : 'Authenticator'), filter: 'select', filterValue: (r) => r.givenBy?.name ?? 'Authenticator', csv: (r) => r.givenBy?.name },
    { key: 'to', header: 'To', cell: (r) => r.to.name, filter: 'text', filterValue: (r) => `${r.to.name} ${r.to.code}`, csv: (r) => `${r.to.code} ${r.to.name}` },
    { key: 'device', header: 'Device', cell: (r) => r.device, csv: (r) => r.device, hideOnPhone: true },
    { key: 'used', header: 'Used', cell: (r) => (r.used ? 'Signed in' : 'Not used'), csv: (r) => (r.used ? 'yes' : 'no'), hideOnPhone: true },
  ];

  return (
    <div className="lb-page">
      <TopBar
        back={{ to: to('Main'), label: 'Command Center' }}
        title="Login codes"
        subtitle="Every staff login needs a one-time code from someone above them. Requests appear here live — the same screen Managers and Team Leads use for their own people."
        period={period}
        onPeriodChange={setPeriod}
      />
      <StatGrid>
        <StatTile label="Waiting for a code" value={pending.data?.length ?? a?.summary.waiting ?? '—'} tone="gold" loading={pending.isPending} />
        <StatTile label="Codes given today" value={a?.summary.codesToday ?? '—'} tone="royal" loading={access.isPending} />
        <StatTile label="Accounts locked" value={a?.summary.locked ?? '—'} tone="red" loading={access.isPending} />
        <StatTile label="Invites not accepted" value={a?.summary.invitesPending ?? '—'} tone="orange" loading={access.isPending} />
      </StatGrid>
      {pending.error ? (
        <ErrorState error={pending.error} onRetry={() => void pending.refetch()} />
      ) : pending.data && pending.data.length === 0 ? (
        <Card>
          <EmptyState title="Nobody is waiting for a login code right now." />
        </Card>
      ) : (
        <div className="two-col">
          {(pending.data ?? []).map((p) => (
            <RequestCard key={p.id} request={p} />
          ))}
        </div>
      )}
      <div className="two-col">
        <Card title="Who can give codes">
          <div className="kv">
            <span>CEO, founder, co-founder</span>
            <span>Anyone</span>
            <span>Manager</span>
            <span>Anyone below Manager in their teams</span>
            <span>Team Lead</span>
            <span>Their own team</span>
            <span>CEO, Managers, Finance themselves</span>
            <span>Use an authenticator app — nobody above them</span>
            <span>Rule</span>
            <span>Nobody can see their own code; every code is recorded</span>
          </div>
        </Card>
        <Card title="Locks and resets">
          {access.error ? (
            <ErrorState error={access.error} onRetry={() => void access.refetch()} compact />
          ) : a && !a.locked.length && !a.invites.length ? (
            <p className="ceo-sub">No locked accounts and no invites waiting.</p>
          ) : (
            <div className="scrollx">
              <table>
                <thead>
                  <tr>
                    <th>Who</th>
                    <th>What</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {a?.locked.map((l) => (
                    <tr key={`l-${l.id}`}>
                      <td>{l.name}</td>
                      <td>
                        Locked · {l.reason} · until {formatTimeIST(l.lockedUntil)}
                      </td>
                      <td>
                        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                          <ActionButton label="Unlock" title={`Unlock ${l.name}`} run={() => api.post(`/staff/${l.id}/unlock`)} success={`${l.name} is unlocked`} />
                          <PasswordResetButton id={l.id} name={l.name} label="Reset" />
                        </div>
                      </td>
                    </tr>
                  ))}
                  {a?.invites.map((i) => (
                    <tr key={`i-${i.id}`}>
                      <td>{i.name}</td>
                      <td>{i.expired ? 'Invite ran out' : 'Has not set a password yet'} · {roleLabel(i.role)}</td>
                      <td>
                        <NewInviteButton id={i.id} name={i.name} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      </div>
      <Card title={period.preset === 'today' ? 'Codes given today' : 'Codes given'}>
        <DataTable columns={codeColumns} rows={a?.codes} rowKey={(r) => r.id} caption="Codes given" loading={access.isPending} error={access.error} onRetry={() => void access.refetch()} download="login-codes-given" emptyTitle="No codes given in this period." />
      </Card>
    </div>
  );
}

function RequestCard({ request }: { request: Pending }) {
  const [code, setCode] = useState<string | null>(null);
  const toast = useToast();
  const qc = useQueryClient();
  const reveal = useMutation({
    mutationFn: () => api.post<{ code: string }>(`/login-codes/${request.id}/reveal`),
    onSuccess: (res) => {
      setCode(res.code);
      void qc.invalidateQueries({ queryKey: ['ceo', 'access'] });
    },
    onError: (e) => toast.error(e instanceof ApiError ? e.message : 'Could not show the code. Try again.'),
  });
  const pretty = code ? `${code.slice(0, 3)} ${code.slice(3)}` : null;
  return (
    <Card>
      <div className="ceo-req">
        <StaffAvatar name={request.staff.name} photoUrl={request.staff.photoUrl} size="lg" noPhotoLabel="No photo" />
        <div>
          <div style={{ fontWeight: 700 }}>{request.staff.name}</div>
          <div className="ceo-cell-sub">
            {request.staff.code} · {roleLabel(request.staff.role)}
          </div>
          <div className="kv" style={{ marginTop: 10 }}>
            <span>Device</span>
            <span>{request.staffDevice.label}</span>
            <span>Office network</span>
            <span>{request.onOfficeNetwork ? 'Yes' : request.staff.role === 'field_agent' ? 'No · mobile data (allowed for field)' : 'No'}</span>
            <span>Asked</span>
            <span>{formatTimeIST(request.createdAt)}</span>
          </div>
          {pretty ? (
            <div style={{ marginTop: 12 }}>
              <div className="ceo-sub">Read this out over the phone</div>
              <div className="ceo-code-big" aria-live="polite">
                {pretty}
              </div>
              <StatusPill tone="good">Code given · works once until {formatTimeIST(request.expiresAt)}</StatusPill>
            </div>
          ) : null}
          <div className="ceo-actions" style={{ marginTop: 12 }}>
            {!pretty && (
              <Button variant="primary" onClick={() => reveal.mutate()} loading={reveal.isPending}>
                Show code to read out
              </Button>
            )}
            <ActionButton
              label="Refuse"
              variant="danger"
              title={`Refuse ${request.staff.name}'s login`}
              description="They cannot sign in with this request. Say why — they see it."
              reason
              run={({ reason }) => api.post(`/login-codes/${request.id}/refuse`, { reason })}
              success="Login refused"
            />
          </div>
        </div>
      </div>
    </Card>
  );
}

/** Someone who never set a password gets a fresh invite (a password reset needs a password to replace). */
function NewInviteButton({ id, name }: { id: string; name: string }) {
  const [token, setToken] = useState<{ code: string; token: string } | null>(null);
  return (
    <>
      <ActionButton
        label="New invite"
        title={`New invite for ${name}`}
        description="They have not set a password yet. A fresh one-time invite replaces the old one; they set their password with it."
        run={async () => {
          const res = await api.post<{ staff: { code: string }; inviteToken: string }>(`/staff/${id}/reissue-invite`);
          setToken({ code: res.staff.code, token: res.inviteToken });
          return res;
        }}
        success="New invite ready"
      />
      {token && (
        <p className="ceo-sub" role="status">
          Give {name}: staff code <span className="code">{token.code}</span> · invite <span className="code" style={{ wordBreak: 'break-all' }}>{token.token}</span> (shown once)
        </p>
      )}
    </>
  );
}
