import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Card } from '../../../components/Card';
import { DataTable, type Column } from '../../../components/DataTable';
import { StatusPill } from '../../../components/Badge';
import { TopBar } from '../../../components/TopBar';
import { api } from '../../../lib/api/client';
import { formatDateTimeIST, formatTimeIST, istDateKey } from '../../../lib/format/date';
import { useNow } from '../../../lib/useNow';
import { useScreenPath } from '../../../portals/PortalContext';
import { ActionButton } from '../_kit/actions';
import { roleLabel } from '../_kit/format';
import { TeamTabs } from '../_kit/tabs';

/** Devices & logins — design C-Team-Devices.dc.html. */
interface DeviceRow {
  id: string;
  staff: { id: string; code: string; name: string; role: string };
  label: string;
  platform: string;
  status: 'pending' | 'approved' | 'revoked';
  lastLoginAt: string | null;
  oddHour: boolean;
  approvedBy: string | null;
}
interface CodeGiven {
  id: string;
  at: string;
  givenBy: { id: string; name: string; role: string } | null;
  to: { id: string; name: string; code: string };
  device: string;
}
interface DevicesResponse {
  rows: DeviceRow[];
  summary: { approved: number; pending: number; revoked: number; oddHour: number };
  codesToday: CodeGiven[];
}

export default function Devices() {
  const to = useScreenPath();
  const now = useNow();
  const devices = useQuery({ queryKey: ['ceo', 'devices'], queryFn: () => api.get<DevicesResponse>('/ceo/devices') });
  const today = istDateKey(now);

  const lastLogin = (r: DeviceRow) => {
    if (!r.lastLoginAt) return '—';
    const label = istDateKey(r.lastLoginAt) === today ? `Today ${formatTimeIST(r.lastLoginAt)}` : formatDateTimeIST(r.lastLoginAt);
    return r.oddHour ? `${label} · odd hour` : label;
  };

  const columns: Column<DeviceRow>[] = [
    { key: 'who', header: 'Who', cell: (r) => <div><div style={{ fontWeight: 600 }}>{r.staff.name}</div><div className="ceo-cell-sub">{r.staff.code} · {roleLabel(r.staff.role)}</div></div>, filter: 'text', filterValue: (r) => `${r.staff.name} ${r.staff.code}`, sortValue: (r) => r.staff.name, csv: (r) => `${r.staff.code} ${r.staff.name}` },
    { key: 'device', header: 'Device', cell: (r) => `${r.label}${r.platform ? ` (${r.platform})` : ''}`, csv: (r) => r.label },
    { key: 'last', header: 'Last login', cell: lastLogin, sortValue: (r) => r.lastLoginAt ?? '', csv: (r) => r.lastLoginAt },
    {
      key: 'status',
      header: 'Status',
      cell: (r) =>
        r.status === 'pending' ? <StatusPill tone="warn">Waiting for approval</StatusPill> : r.status === 'revoked' ? <StatusPill tone="muted">Removed</StatusPill> : r.oddHour ? <StatusPill tone="danger">Flagged</StatusPill> : <StatusPill tone="good">Approved</StatusPill>,
      filter: 'select',
      filterValue: (r) => (r.status === 'pending' ? 'Waiting' : r.status === 'revoked' ? 'Removed' : r.oddHour ? 'Flagged' : 'Approved'),
      csv: (r) => r.status,
    },
    {
      key: 'actions',
      header: '',
      cell: (r) => (
        <div className="ceo-actions" onClick={(e) => e.stopPropagation()}>
          {r.status === 'pending' && <ActionButton label="Approve" variant="success" title={`Approve ${r.staff.name}'s ${r.label}`} description="First login on a new device needs someone above them to approve it." run={() => api.post(`/staff/devices/${r.id}/approve`)} success="Device approved" />}
          {r.status !== 'revoked' && (
            <ActionButton
              label={r.platform && /android|ios|phone/i.test(`${r.platform} ${r.label}`) ? 'Remove lost phone' : 'Remove'}
              variant="danger"
              title={`Remove ${r.label}`}
              description="Signs them out on it straight away. Using it again needs a fresh approval."
              run={() => api.post(`/staff/devices/${r.id}/revoke`)}
              success="Device removed"
            />
          )}
        </div>
      ),
    },
  ];

  const codes = devices.data?.codesToday ?? [];
  return (
    <div className="lb-page">
      <TopBar back={{ to: to('C-Team'), label: 'Team & access' }} title="Devices & logins" subtitle="Approved devices and every login code given." />
      <TeamTabs />
      <div className="panel" style={{ padding: '6px 18px 14px' }}>
        <DataTable columns={columns} rows={devices.data?.rows} rowKey={(r) => r.id} caption="Devices" loading={devices.isPending} error={devices.error} onRetry={() => void devices.refetch()} download="devices" emptyTitle="No devices yet." />
        <div className="ceo-note">First login on a new device needs a Team Lead or Manager to approve · staff log in from any network: every login needs a one-time code from a senior or the authenticator code</div>
      </div>
      <div>
        <Card title="Login codes given today" aside={<Link to={to('C-LoginCodes')}>All login codes →</Link>}>
          {devices.isPending ? (
            <p className="ceo-sub">Loading…</p>
          ) : codes.length ? (
            <div className="kv">
              {codes.map((c) => (
                <FragmentRow key={c.id} k={`${c.givenBy?.name ?? 'Authenticator'} → ${c.to.name}`} v={`${formatTimeIST(c.at)} · ${c.device}`} />
              ))}
            </div>
          ) : (
            <p className="ceo-sub">No login codes given today.</p>
          )}
        </Card>
      </div>
    </div>
  );
}

function FragmentRow({ k, v }: { k: string; v: string }) {
  return (
    <>
      <span>{k}</span>
      <span>{v}</span>
    </>
  );
}
