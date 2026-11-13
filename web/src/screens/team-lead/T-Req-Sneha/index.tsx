import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate, useParams } from 'react-router-dom';
import { Button } from '../../../components/Button';
import { Card } from '../../../components/Card';
import { ErrorState } from '../../../components/ErrorState';
import { SkeletonCard } from '../../../components/Skeleton';
import { StatusPill } from '../../../components/Badge';
import { TopBar } from '../../../components/TopBar';
import { useToast } from '../../../components/Toast';
import { api } from '../../../lib/api/client';
import { ApiError } from '../../../lib/api/errors';
import { formatDateTimeIST } from '../../../lib/format/date';
import { useNow } from '../../../lib/useNow';
import { useScreenPath } from '../../../portals/PortalContext';
import { Kv, Timeline } from '../../ceo/_kit/kit';
import { roleLabel } from '../../ceo/_kit/format';
import { firstName, useTeam, waitedFor, type RequestDetail } from '../_kit/api';

/** One request with everything needed to decide — design T-Req-Sneha.dc.html (any kind of request). */
interface Balance {
  casual: { left: number };
  emergency: { left: number };
}
interface LeaveBoard {
  schedule: Array<{ staff: { id: string; name: string }; fromDate: string; toDate: string; status: string }>;
}
interface AgentsBoard {
  rows: Array<{ staff: { id: string }; attendance: { present: number; workingDays: number }; lateLogins: { count: number } }>;
}

export default function RequestDetailScreen() {
  const { id = '' } = useParams();
  const to = useScreenPath();
  const now = useNow();
  const navigate = useNavigate();
  const toast = useToast();
  const qc = useQueryClient();
  const team = useTeam();
  const [note, setNote] = useState('');
  // "Her follow-ups that day go to": share | <teammate id> | keep (empty = the first offered choice).
  const [handover, setHandover] = useState('');
  const detail = useQuery({ queryKey: ['requests', 'one', id], queryFn: () => api.get<RequestDetail>(`/requests/${encodeURIComponent(id)}`) });
  const r = detail.data;
  const personId = r?.person?.id;
  const isLeave = r?.kind === 'leave';
  const balance = useQuery({ queryKey: ['attendance', 'balance', personId], queryFn: () => api.get<Balance>('/attendance/leave/balance', { query: { staffId: personId } }), enabled: Boolean(isLeave && personId) });
  const leave = useQuery({ queryKey: ['team-lead', 'leave'], queryFn: () => api.get<LeaveBoard>('/team-lead/leave'), enabled: Boolean(isLeave) });
  const agents = useQuery({ queryKey: ['team-lead', 'agents'], queryFn: () => api.get<AgentsBoard>('/team-lead/agents'), enabled: Boolean(personId) });
  const manager = team.data?.manager;
  const mgr = manager ? `${firstName(manager.name)} (Manager)` : 'the Manager';

  const fu = r?.followUps;
  const mates = fu?.teammates ?? [];
  // A half day keeps its follow-ups (the server says when a handover is not needed).
  const offerHandover = Boolean(isLeave && fu && fu.planned > 0 && fu.handoverNeeded !== false && r?.status === 'pending');
  const handoverChoice = handover || (mates.length > 1 ? 'share' : mates.length === 1 ? mates[0].id : 'keep');
  const followUpsBody =
    handoverChoice === 'keep' ? { mode: 'keep' } : handoverChoice === 'share' ? { mode: 'share' } : { mode: 'teammate', staffId: handoverChoice };
  const act = useMutation({
    mutationFn: (action: 'approved' | 'rejected' | 'forward') =>
      action === 'forward'
        ? api.post(`/requests/${encodeURIComponent(id)}/forward`, { note })
        : api.post(`/requests/${encodeURIComponent(id)}/decide`, {
            decision: action,
            reason: note.trim() || undefined,
            ...(action === 'approved' && offerHandover ? { followUps: followUpsBody } : {}),
          }),
    onSuccess: (_res, action) => {
      toast.success(action === 'forward' ? `Sent to ${mgr}` : action === 'approved' ? 'Approved · closed for everyone' : 'Rejected');
      void qc.invalidateQueries();
      navigate(to('T-Requests'));
    },
    onError: (e) => toast.error(e instanceof ApiError ? e.message : 'Something went wrong. Try again.'),
  });

  if (detail.error) return <div className="lb-page"><TopBar showSearch={false} back={{ to: to('T-Requests'), label: 'Requests' }} title="Request" /><ErrorState error={detail.error} onRetry={() => void detail.refetch()} /></div>;
  if (!r) return <div className="lb-page"><TopBar showSearch={false} back={{ to: to('T-Requests'), label: 'Requests' }} title="Request" /><SkeletonCard /><SkeletonCard /></div>;

  const name = r.about && r.about.type !== 'staff' ? `${r.about.code} · ${r.about.name}` : (r.person?.name ?? '—');
  const who = firstName(r.person?.name);
  const d = r.details;
  const where = (() => {
    if (r.status !== 'pending') return `${r.status === 'approved' ? 'Approved' : 'Rejected'} by ${r.decided?.by?.name ?? 'someone'}${r.overturned ? ' · then overturned' : ''}.`;
    if (r.withTeamLead && r.withManager) return `${who} asked you ${waitedFor(r.createdAt, now)} ago. Because it wasn't answered in 24 hours, ${mgr} can now decide it too. Whoever decides first closes it for both.`;
    if (r.withTeamLead) return `${who} asked you ${waitedFor(r.createdAt, now)} ago. If you don't answer within 24 hours, ${mgr} can decide it too.`;
    if (r.withCeo) return 'It is with the CEO now.';
    return `It is with ${mgr}: ${r.routeReasonText}.`;
  })();
  const days = Number(d.days ?? 0);
  const othersOff = isLeave
    ? (leave.data?.schedule ?? []).filter((s) => s.staff.id !== personId && s.status === 'approved' && s.fromDate <= String(d.toDate) && s.toDate >= String(d.fromDate)).map((s) => s.staff.name)
    : [];
  const agentRow = agents.data?.rows.find((row) => row.staff.id === personId);

  const requestRows: [string, string][] = [
    ['From', r.about && r.about.type !== 'staff' ? `${name}` : `${r.person?.name ?? '—'} · ${roleLabel(r.person?.role).toLowerCase()}`],
    ['Type', r.title],
    ['What', r.summary],
  ];
  if (r.reason) requestRows.push(['Reason', r.reason]);
  if (r.requestedBy && r.requestedBy.id !== r.person?.id) requestRows.push(['Asked by', r.requestedBy.name]);
  requestRows.push(['Asked', formatDateTimeIST(r.createdAt)]);

  const before: [string, string][] = [];
  if (isLeave) {
    before.push(['Leave left', balance.data ? `Planned ${balance.data.casual.left} · emergency ${balance.data.emergency.left}` : '…']);
    if (d.leaveKind === 'casual') before.push(['Planned leave this month', `${Number(d.casualDaysTakenThisMonth ?? 0)} taken · with this ${Number(d.casualDaysTakenThisMonth ?? 0) + Number(d.casualDaysPendingThisMonth ?? 0) + days} (you decide up to 3)`]);
    else before.push(['Emergency leave', 'Not counted against the 3-day limit']);
    before.push([`Others off on these days`, othersOff.length ? othersOff.join(', ') : 'Nobody']);
    if (fu) {
      const planned = `${fu.planned} follow-up${fu.planned === 1 ? '' : 's'}`;
      const moved = fu.handedOver.count
        ? ` · ${fu.handedOver.count} moved to ${fu.handedOver.to.map((m) => firstName(m.name)).join(' and ')}${fu.handedOver.returned ? ` · ${fu.handedOver.returned} back with ${who}` : ''}`
        : '';
      before.push([`Calls planned for ${who} ${days === 1 ? 'that day' : 'on these days'}`, `${planned}${moved}`]);
    }
  }
  if (r.kind === 'hit_removal') {
    before.push(['The hit', `${String(d.hitReason ?? '').replace(/_/g, ' ')} · recorded ${d.hitRecordedAt ? formatDateTimeIST(String(d.hitRecordedAt)) : ''} by ${String(d.hitRecordedBy ?? 'the phone system')}`]);
    before.push(['Hit number', `${Number(d.hitNumber ?? 1)} on this job seeker · ${Number(d.earlierRemovals ?? 0)} removed before`]);
  }
  if (r.kind === 'day_change') before.push(['Work time that day', `${Math.floor(Number(d.productionSeconds ?? 0) / 3600)}h ${String(Math.round((Number(d.productionSeconds ?? 0) % 3600) / 60)).padStart(2, '0')}m`]);
  if (r.kind === 'claim') {
    before.push(['Worker left on', String(d.workerLeftOn ?? '—')]);
    before.push(['Reported in time', d.reportedWithinDeadline ? 'Yes · within 7 days' : 'No']);
    before.push(['Fee paid in full', d.feePaidInFull ? 'Yes' : 'No']);
    before.push(['Exit call', d.exitCallRecorded ? 'Recorded' : 'Not recorded yet']);
  }
  if (r.kind === 'target_change') before.push(['Change', `${String(d.metricLabel)}: ${d.from ?? '—'} → ${String(d.to)}`]);
  if (agentRow) before.push([`${who}'s attendance this month`, `${agentRow.attendance.present} of ${agentRow.attendance.workingDays} days · ${agentRow.lateLogins.count} late login${agentRow.lateLogins.count === 1 ? '' : 's'}`]);

  return (
    <div className="lb-page">
      <TopBar showSearch={false} back={{ to: to('T-Requests'), label: 'Requests' }} title={`${r.title} · ${name}`} subtitle="Everything you need to decide, and where the work goes while they are away." />
      <div className="panel" style={{ padding: '14px 18px' }} role="status">
        <b>Where it is:</b> {where}
      </div>
      <div className="two-col">
        <Card title="Request">
          <Kv rows={requestRows} />
        </Card>
        <Card title="Before you decide">{before.length ? <Kv rows={before} /> : <p className="tl-sub">Nothing else to check.</p>}</Card>
      </div>
      {r.canDecide ? (
        <Card title="Your decision">
          <label className="field">
            Note to {who} (needed if you reject)
            <textarea value={note} onChange={(e) => setNote(e.target.value)} placeholder="Optional when approving" rows={3} />
          </label>
          {offerHandover && (
            <label className="field" style={{ marginTop: 12 }}>
              Her follow-ups that day go to
              <select value={handoverChoice} onChange={(e) => setHandover(e.target.value)}>
                {mates.length > 1 && <option value="share">{`Share between ${mates.map((m) => firstName(m.name)).join(' and ')}`}</option>}
                {mates.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.name}
                  </option>
                ))}
                <option value="keep">Keep for her return</option>
              </select>
              <span className="tl-sub">They move back to {who} after the leave if still not done.</span>
            </label>
          )}
          <div className="tl-actions" style={{ marginTop: 12 }}>
            <Button variant="success" onClick={() => act.mutate('approved')} loading={act.isPending && act.variables === 'approved'}>
              Approve{isLeave ? ' leave' : ''}
            </Button>
            <Button variant="danger" onClick={() => act.mutate('rejected')} disabled={!note.trim()} loading={act.isPending && act.variables === 'rejected'}>
              Reject
            </Button>
            {r.canForward && (
              <Button onClick={() => act.mutate('forward')} disabled={!note.trim()} loading={act.isPending && act.variables === 'forward'}>
                Send to Manager
              </Button>
            )}
          </div>
          {!note.trim() && <p className="tl-sub">Write a note to reject or to send it to the Manager.</p>}
        </Card>
      ) : (
        <Card title="Decision">
          <StatusPill tone={r.status === 'pending' ? 'info' : r.status === 'approved' ? 'good' : 'danger'}>
            {r.status === 'pending' ? (r.withCeo ? 'With the CEO' : `With ${mgr}`) : r.status === 'approved' ? 'Approved' : 'Rejected'}
          </StatusPill>
          {r.decided?.reason && r.decided.reason !== 'Approved' && <p className="tl-sub">"{r.decided.reason}"</p>}
        </Card>
      )}
      <Card title="Where this request has been">
        <Timeline events={r.history.map((h) => ({ at: h.at, text: h.text }))} />
      </Card>
    </div>
  );
}
