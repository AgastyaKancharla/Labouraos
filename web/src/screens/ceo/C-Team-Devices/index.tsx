import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Button } from '../../../components/Button';
import { Card } from '../../../components/Card';
import { DataTable, type Column } from '../../../components/DataTable';
import { StatusPill } from '../../../components/Badge';
import { TextField } from '../../../components/fields';
import { TopBar } from '../../../components/TopBar';
import { useToast } from '../../../components/Toast';
import { api } from '../../../lib/api/client';
import { ApiError } from '../../../lib/api/errors';
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
  network: 'office' | 'mobile' | null;
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
interface OfficeNetwork {
  id: string;
  label: string;
  cidr: string;
  active: boolean;
}

export default function Devices() {
  const to = useScreenPath();
  const now = useNow();
  const devices = useQuery({ queryKey: ['ceo', 'devices'], queryFn: () => api.get<DevicesResponse>('/ceo/devices') });
  const networks = useQuery({ queryKey: ['office-networks'], queryFn: () => api.get<OfficeNetwork[]>('/office-networks') });
  const today = istDateKey(now);

  const lastLogin = (r: DeviceRow) => {
    if (!r.lastLoginAt) return '—';
    const label = istDateKey(r.lastLoginAt) === today ? `Today ${formatTimeIST(r.lastLoginAt)}` : formatDateTimeIST(r.lastLoginAt);
    return r.oddHour ? `${label} · odd hour` : label;
  };

  const columns: Column<DeviceRow>[] = [
    { key: 'who', header: 'Who', cell: (r) => <div><div style={{ fontWeight: 600 }}>{r.staff.name}</div><div className="ceo-cell-sub">{r.staff.code} · {roleLabel(r.staff.role)}</div></div>, filter: 'text', filterValue: (r) => `${r.staff.name} ${r.staff.code}`, sortValue: (r) => r.staff.name, csv: (r) => `${r.staff.code} ${r.staff.name}` },
    { key: 'device', header: 'Device', cell: (r) => `${r.label}${r.platform ? ` (${r.platform})` : ''}`, csv: (r) => r.label },
    { key: 'network', header: 'Network', cell: (r) => (r.network === 'office' ? 'Office network' : r.network === 'mobile' ? 'Mobile' : '—'), filter: 'select', filterValue: (r) => (r.network === 'office' ? 'Office network' : r.network === 'mobile' ? 'Mobile' : 'Unknown'), csv: (r) => r.network, hideOnPhone: true },
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
      <TopBar back={{ to: to('C-Team'), label: 'Team & access' }} title="Devices & logins" subtitle="Approved devices, office networks and every login code given." />
      <TeamTabs />
      <div className="panel" style={{ padding: '6px 18px 14px' }}>
        <DataTable columns={columns} rows={devices.data?.rows} rowKey={(r) => r.id} caption="Devices" loading={devices.isPending} error={devices.error} onRetry={() => void devices.refetch()} download="devices" emptyTitle="No devices yet." />
        <div className="ceo-note">First login on a new device needs a Team Lead or Manager to approve · office staff can log in only from office networks</div>
      </div>
      <div className="two-col">
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
        <OfficeNetworks networks={networks.data} loading={networks.isPending} />
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

function OfficeNetworks({ networks, loading }: { networks: OfficeNetwork[] | undefined; loading: boolean }) {
  const [label, setLabel] = useState('');
  const [cidr, setCidr] = useState('');
  const toast = useToast();
  const qc = useQueryClient();
  const add = useMutation({
    mutationFn: () => api.post('/office-networks', { label: label.trim(), cidr: cidr.trim() }),
    onSuccess: () => {
      toast.success('Office network added');
      setLabel('');
      setCidr('');
      void qc.invalidateQueries({ queryKey: ['office-networks'] });
    },
    onError: (e) => toast.error(e instanceof ApiError ? e.message : 'Could not add. Try again.'),
  });
  const active = (networks ?? []).filter((n) => n.active);
  return (
    <Card title="Office networks">
      {loading ? (
        <p className="ceo-sub">Loading…</p>
      ) : active.length ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {active.map((n) => (
            <div key={n.id} className="ceo-rule-row">
              <span>
                <strong>{n.label}</strong> <span className="ceo-sub">{n.cidr}</span>
              </span>
              <span />
              <ActionButton label="Remove" variant="danger" title={`Remove ${n.label}`} description="Office staff will no longer be able to log in from it." run={() => api.post(`/office-networks/${n.id}/deactivate`)} success="Office network removed" />
            </div>
          ))}
        </div>
      ) : (
        <p className="ceo-sub">No office networks yet — office staff cannot log in until one is added.</p>
      )}
      <form
        className="ceo-inline-form"
        style={{ marginTop: 12 }}
        onSubmit={(e) => {
          e.preventDefault();
          if (label.trim() && cidr.trim()) add.mutate();
        }}
      >
        <TextField label="Name" value={label} onChange={setLabel} placeholder="JP Nagar office" />
        <TextField label="Network address" value={cidr} onChange={setCidr} placeholder="103.21.58.0/24" hint="The office internet address, from your internet provider" />
        <Button type="submit" loading={add.isPending} disabled={!label.trim() || !cidr.trim()}>
          + Add network
        </Button>
      </form>
    </Card>
  );
}
