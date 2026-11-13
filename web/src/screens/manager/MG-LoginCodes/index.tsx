import { useState } from 'react';
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
import { ActionButton } from '../../ceo/_kit/actions';
import { initials } from '../../ceo/_kit/format';
import { roleWord } from '../_kit/kit';

interface Pending {
  id: string;
  createdAt: string;
  expiresAt: string;
  staff: { id: string; name: string; code: string; role: string };
  staffDevice: { id: string; label: string; platform: string };
}
interface Codes {
  summary: { waiting: number; codesToday: number; locked: number };
  codes: { id: string; at: string; to: { id: string; name: string; code: string }; givenBy: { id: string; name: string; role: string; isYou: boolean } | null; device: string; used: boolean }[];
}

function ago(iso: string, now: Date): string {
  const m = Math.max(0, Math.floor((now.getTime() - new Date(iso).getTime()) / 60000));
  return m < 1 ? 'Just now' : `${m} min ago`;
}

function givenBy(c: Codes['codes'][number]): string {
  if (!c.givenBy) return '—';
  if (c.givenBy.isYou) return `${c.givenBy.name.split(/\s+/)[0]} (you)`;
  const r = c.givenBy.role === 'team_lead' ? 'TL' : c.givenBy.role === 'manager' ? 'Manager' : c.givenBy.role === 'ceo' ? 'CEO' : c.givenBy.role;
  return `${c.givenBy.name.split(/\s+/)[0]} (${r})`;
}

function RequestCard({ request }: { request: Pending }) {
  const now = useNow();
  const toast = useToast();
  const qc = useQueryClient();
  const [code, setCode] = useState<string | null>(null);
  const reveal = useMutation({
    mutationFn: () => api.post<{ code: string }>(`/login-codes/${request.id}/reveal`),
    onSuccess: (res) => {
      setCode(res.code);
      void qc.invalidateQueries({ queryKey: ['manager', 'login-codes'] });
    },
    onError: (e) => toast.error(e instanceof ApiError ? e.message : 'Could not show the code. Try again.'),
  });
  return (
    <Card>
      <div className="ceo-req">
        <span className="avatar av-royal">{initials(request.staff.name)}</span>
        <div className="mg-code-card">
          <div>
            <div style={{ fontWeight: 700 }}>{request.staff.name}</div>
            <div className="ceo-cell-sub">
              {request.staff.code} · {roleWord(request.staff.role)}
            </div>
          </div>
          <div className="mg-code-row">
            <span>
              Device <b>{request.staffDevice.label}</b>
            </span>
            <span>
              Asked <b>{ago(request.createdAt, now)}</b>
            </span>
          </div>
          {code ? (
            <div>
              <div className="ceo-sub">Read this out over the phone</div>
              <div className="ceo-code-big" aria-live="polite">
                {code.split('').join(' ')}
              </div>
              <StatusPill tone="good">{`Code given · works once until ${formatTimeIST(request.expiresAt)}`}</StatusPill>
            </div>
          ) : null}
          <div className="ceo-actions">
            {!code && (
              <Button variant="primary" onClick={() => reveal.mutate()} loading={reveal.isPending}>
                Show code
              </Button>
            )}
            <ActionButton label="Refuse" variant="danger" title={`Refuse ${request.staff.name}'s login`} description="They cannot sign in with this request. Say why — they see it." reason run={({ reason }) => api.post(`/login-codes/${request.id}/refuse`, { reason })} success="Login refused" />
          </div>
        </div>
      </div>
    </Card>
  );
}

/**
 * Login codes — design MG-LoginCodes.dc.html: code requests from the Manager's
 * Team Leads, and from agents when their Team Lead is away (GET
 * /login-codes/pending, already scoped to the Manager's tree), and every code
 * given in the period (GET /manager/login-codes). Nobody sees their own code.
 */
export default function ManagerLoginCodes() {
  const to = useScreenPath();
  const now = useNow();
  const [period, setPeriod] = useState<Period>(() => periodFor('today', now));
  const range = periodToUtcRange(period);
  const pending = useQuery({ queryKey: ['login-codes', 'pending'], queryFn: () => api.get<Pending[]>('/login-codes/pending'), refetchInterval: 10_000 });
  const codes = useQuery({ queryKey: ['manager', 'login-codes', range], queryFn: () => api.get<Codes>('/manager/login-codes', { query: range }), refetchInterval: 30_000 });
  const c = codes.data;

  const columns: Column<Codes['codes'][number]>[] = [
    { key: 'time', header: 'Time', cell: (r) => (period.preset === 'today' ? formatTimeIST(r.at) : formatDateTimeIST(r.at)), sortValue: (r) => r.at, csv: (r) => r.at },
    { key: 'who', header: 'Who', cell: (r) => r.to.name, filter: 'text', filterValue: (r) => `${r.to.name} ${r.to.code}`, csv: (r) => r.to.name },
    { key: 'by', header: 'Code given by', cell: givenBy, filter: 'select', filterValue: givenBy, csv: givenBy },
    { key: 'device', header: 'Device', cell: (r) => r.device, csv: (r) => r.device, hideOnPhone: true },
  ];

  return (
    <div className="lb-page">
      <TopBar back={{ to: to('MG-Home'), label: 'Command Center' }} title="Login codes" subtitle="Code requests from your Team Leads, and from agents when their Team Lead is away." period={period} onPeriodChange={setPeriod} />
      <StatGrid>
        <StatTile label="Waiting for a code" value={pending.data?.length ?? c?.summary.waiting ?? '—'} tone="gold" loading={pending.isPending} />
        <StatTile label="Codes given today" value={c?.summary.codesToday ?? '—'} tone="royal" loading={codes.isPending} />
        <StatTile label="Accounts locked" value={c?.summary.locked ?? '—'} tone="red" loading={codes.isPending} to={to('MG-Staff')} />
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
      <div className="panel" style={{ padding: '6px 18px 14px' }}>
        <DataTable columns={columns} rows={c?.codes} rowKey={(r) => r.id} caption="Codes given" loading={codes.isPending} error={codes.error} onRetry={() => void codes.refetch()} download="login-codes" emptyTitle="No codes given in this period." />
        <div className="ceo-note">You give codes to Team Leads and to anyone below Manager when their Team Lead is away · nobody sees their own code</div>
      </div>
    </div>
  );
}
