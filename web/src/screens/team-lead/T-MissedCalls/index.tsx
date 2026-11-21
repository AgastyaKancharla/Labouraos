import '../_kit/tl.css';
import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Button } from '../../../components/Button';
import { Card } from '../../../components/Card';
import { DataTable, type Column } from '../../../components/DataTable';
import { StatGrid, StatTile } from '../../../components/StatTile';
import { StatusPill } from '../../../components/Badge';
import { TopBar } from '../../../components/TopBar';
import { useToast } from '../../../components/Toast';
import { api } from '../../../lib/api/client';
import { ApiError } from '../../../lib/api/errors';
import { formatDateTimeIST, formatTimeIST, istDateKey } from '../../../lib/format/date';
import { useNow } from '../../../lib/useNow';
import { useScreenPath } from '../../../portals/PortalContext';

export interface MissedCallRow {
  id: string;
  ids: string[];
  count: number;
  firstCalledAt: string;
  lastCalledAt: string;
  maskedPhone: string;
  caller: { type: 'job_seeker' | 'business' | 'referral'; id: string; code: string; name: string } | null;
  holder: { id: string; code: string; name: string } | null;
  assignedAt: string | null;
  assignmentReason: string | null;
  waitingMinutes: number;
}
interface Agent {
  id: string;
  code: string;
  name: string;
  role: string;
  openItems: number;
  onShift: boolean;
}
interface MissedCalls {
  now: string;
  targetMinutes: number;
  rows: MissedCallRow[];
  agents: Agent[];
}

const KEY = ['telephony', 'missed-calls'];

const REASON: Record<string, string> = {
  inbound_routed: 'rang them',
  own_agent: 'their own person',
  fewest_open: 'fewest open items',
  same_caller: 'same caller',
  taken: 'took it',
  manual: 'given by hand',
  handover: 'leave handover',
  no_show: 'not logged in',
};

const CALLER_KIND: Record<string, string> = { job_seeker: 'Job seeker', business: 'Business', referral: 'Partner' };

/**
 * T-MissedCalls (21 Nov fixes, Master Guide rev 202): every missed call of
 * the team, and the ones nobody holds yet, grouped by number. The software
 * hands them out by itself (own agent on shift, else fewest open items) and
 * the bell rings after 15 minutes without a first call back; here the Team
 * Lead sees how long each has waited and gives one to an agent of the team
 * (POST /telephony/callbacks/:id/assign). Phone numbers show the last 4 digits only.
 */
export default function TeamLeadMissedCalls() {
  const to = useScreenPath();
  const now = useNow(30_000);
  const q = useQuery({ queryKey: KEY, queryFn: () => api.get<MissedCalls>('/telephony/missed-calls'), refetchInterval: 30_000 });
  const d = q.data;
  const target = d?.targetMinutes ?? 30;
  const unassigned = d?.rows.filter((r) => !r.holder).length ?? 0;
  const late = d?.rows.filter((r) => r.waitingMinutes >= target).length ?? 0;

  const columns: Column<MissedCallRow>[] = [
    {
      key: 'when',
      header: 'Called',
      cell: (r) => (
        <span>
          {istDateKey(r.lastCalledAt) === istDateKey(now) ? formatTimeIST(r.lastCalledAt) : formatDateTimeIST(r.lastCalledAt)}
          {r.count > 1 && <span className="sub" style={{ display: 'block' }}>{r.count} calls from this number</span>}
        </span>
      ),
      sortValue: (r) => r.firstCalledAt,
    },
    {
      key: 'caller',
      header: 'Caller',
      cell: (r) => (r.caller ? <span>{r.caller.name} · {r.caller.code}<span className="sub" style={{ display: 'block' }}>{CALLER_KIND[r.caller.type]} · {r.maskedPhone}</span></span> : <span>New caller<span className="sub" style={{ display: 'block' }}>{r.maskedPhone}</span></span>),
      filter: 'text',
      filterValue: (r) => `${r.caller?.name ?? 'New caller'} ${r.caller?.code ?? ''} ${r.maskedPhone}`,
    },
    {
      key: 'waiting',
      header: 'Waiting',
      cell: (r) => <StatusPill tone={r.waitingMinutes >= target ? 'danger' : r.waitingMinutes >= 15 ? 'warn' : 'info'}>{waitLabel(r.waitingMinutes)}</StatusPill>,
      sortValue: (r) => r.waitingMinutes,
      align: 'right',
    },
    {
      key: 'holder',
      header: 'With',
      cell: (r) => (r.holder ? <span>{r.holder.name}<span className="sub" style={{ display: 'block' }}>{REASON[r.assignmentReason ?? ''] ?? ''}</span></span> : 'Nobody yet'),
      filter: 'select',
      filterValue: (r) => r.holder?.name ?? 'Nobody yet',
    },
    { key: 'give', header: '', cell: (r) => <Give row={r} agents={d?.agents ?? []} /> },
  ];

  return (
    <div className="lb-page">
      <TopBar
        showSearch={false}
        back={{ to: to('T-Home'), label: 'My team' }}
        title="Missed calls"
        subtitle={`Calls nobody answered. The software gives each one out; aim for the first call back within ${target} minutes.`}
      />
      <StatGrid>
        <StatTile label="Waiting" value={d?.rows.length ?? '—'} tone="royal" loading={q.isPending} />
        <StatTile label="Nobody holds it" value={d ? unassigned : '—'} tone="orange" loading={q.isPending} />
        <StatTile label={`Over ${target} minutes`} value={d ? late : '—'} tone="red" loading={q.isPending} />
      </StatGrid>
      <Card title="Missed calls to return" flush>
        <DataTable
          columns={columns}
          rows={d?.rows}
          rowKey={(r) => r.id}
          caption="Missed calls of your team and ones nobody holds"
          loading={q.isPending}
          error={q.error}
          onRetry={() => void q.refetch()}
          emptyTitle="No missed calls waiting."
        />
      </Card>
    </div>
  );
}

function waitLabel(minutes: number): string {
  if (minutes < 60) return `${minutes} min`;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m ? `${h} h ${m} min` : `${h} h`;
}

function Give({ row, agents }: { row: MissedCallRow; agents: Agent[] }) {
  const [agent, setAgent] = useState('');
  const toast = useToast();
  const qc = useQueryClient();
  const give = useMutation({
    mutationFn: () => api.post(`/telephony/callbacks/${encodeURIComponent(row.id)}/assign`, { staffId: agent }),
    onSuccess: () => {
      toast.success('Missed call given');
      setAgent('');
      void qc.invalidateQueries({ queryKey: KEY });
    },
    onError: (e) => toast.error(e instanceof ApiError ? e.message : 'Could not give the missed call'),
  });
  const choices = agents.filter((a) => a.id !== row.holder?.id);
  if (choices.length === 0) return null;
  return (
    <div className="tl-inline">
      <select aria-label={`Give the missed call from ${row.maskedPhone} to`} value={agent} onChange={(e) => setAgent(e.target.value)}>
        <option value="">{row.holder ? 'Move to…' : 'Give to…'}</option>
        {choices.map((a) => (
          <option key={a.id} value={a.id}>
            {a.name} · {a.openItems} open{a.onShift ? '' : ' · not on shift'}
          </option>
        ))}
      </select>
      <Button size="compact" variant="primary" onClick={() => give.mutate()} disabled={!agent} loading={give.isPending}>
        {row.holder ? 'Move' : 'Give'}
      </Button>
    </div>
  );
}
