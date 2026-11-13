import { useMemo, useState } from 'react';
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
import { useScreenPath } from '../../../portals/PortalContext';
import { ActionButton } from '../../ceo/_kit/actions';
import { Kv, Timeline, type TimelineEvent } from '../../ceo/_kit/kit';
import { teamShort } from '../_kit/kit';
import { firstName, requestTeam, roleWords, treeIndex, useTree, whyLine, type RequestDetail, type RequestView } from '../_kit/requests';
import { useNow } from '../../../lib/useNow';

interface LeaveBoard {
  month: string;
  off: Array<{ id: string; staff: { id: string; name: string; role: string }; team: string | null; from: string; to: string; status: string }>;
  balances: Array<{ staff: { id: string }; plannedLeft: number; emergencyLeft: number; plannedUsedThisMonth: number; emergencyUsedThisMonth: number }>;
}
interface AgentsBoard {
  rows: Array<{ staff: { id: string }; attendancePercent: number | null; lateLogins: number }>;
}

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

/** "Wed 25 Nov" for a yyyy-mm-dd day. */
function dayLabel(ymd: string): string {
  const d = new Date(`${ymd}T00:00:00.000Z`);
  return Number.isNaN(d.getTime()) ? ymd : `${WEEKDAYS[d.getUTCDay()]} ${d.getUTCDate()} ${MONTHS[d.getUTCMonth()].slice(0, 3)}`;
}

/** Every calendar day from..to (yyyy-mm-dd), inclusive. */
function daysBetween(from: string, to: string): string[] {
  const out: string[] = [];
  const start = new Date(`${from}T00:00:00.000Z`);
  const end = new Date(`${to}T00:00:00.000Z`);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return out;
  for (let t = start.getTime(); t <= end.getTime() && out.length < 100; t += 86_400_000) out.push(new Date(t).toISOString().slice(0, 10));
  return out;
}

/** The "Why it is with you" banner, in the design's longer words. */
function whyBanner(r: RequestView, tree: ReturnType<typeof treeIndex>, now: Date): string {
  const lead = tree.leadOf(r.person?.id);
  const tl = lead ? firstName(lead.name) : 'The Team Lead';
  if (r.whyWithYou === 'team_lead_own' && r.kind === 'leave') return "Team Leads' leave goes straight to a Manager.";
  if (r.whyWithYou === 'team_lead_24h' || r.whyWithYou === 'device_24h') {
    const hours = Math.max(24, Math.floor((now.getTime() - new Date(r.createdAt).getTime()) / 3_600_000));
    return `${tl}${lead ? ' (TL)' : ''} hasn't answered for ${hours} hours, so it came to you as well. It is still in ${lead ? `${tl}'s` : 'their'} list — whoever decides first closes it for both, and both see who decided.`;
  }
  if (r.whyWithYou === 'over_limit') return `More than 3 planned leave days in a month come to a Manager automatically. ${lead ? `${tl} (TL)` : 'The Team Lead'} can see it but can't decide it.`;
  return `${whyLine(r, tree, now)}.`;
}

/**
 * One request with everything the Manager needs to decide — designs
 * MG-Req-Ravi (a Team Lead's own leave), MG-Req-Sneha (not answered by the
 * Team Lead in 24 hours) and MG-Req-Vikram (more than 3 planned days), and
 * every other kind of request in the same layout. On GET /requests/:ref;
 * the decision is POST /requests/:ref/decide (for leave, with fromDate/toDate
 * to approve only some of the days — the rest is rejected with the note),
 * "Send back to the Team Lead" is POST /requests/:ref/send-back, and a
 * decided one can be overturned with POST /requests/:ref/overturn.
 */
export default function ManagerRequestDetail() {
  const { id = '' } = useParams();
  const to = useScreenPath();
  const now = useNow();
  const navigate = useNavigate();
  const toast = useToast();
  const qc = useQueryClient();
  const [note, setNote] = useState('');
  const [part, setPart] = useState(false);
  const [partFrom, setPartFrom] = useState('');
  const [partTo, setPartTo] = useState('');
  // "Their follow-ups go to" (same as T-Req-Sneha): share | <teammate id> | keep (empty = the first offered choice).
  const [handover, setHandover] = useState('');
  const staff = useTree();
  const tree = useMemo(() => treeIndex(staff.data), [staff.data]);
  const detail = useQuery({ queryKey: ['requests', 'one', id], queryFn: () => api.get<RequestDetail>(`/requests/${encodeURIComponent(id)}`) });
  const r = detail.data;
  const personId = r?.person?.id;
  const isLeave = r?.kind === 'leave';
  const leave = useQuery({ queryKey: ['manager', 'leave'], queryFn: () => api.get<LeaveBoard>('/manager/leave'), enabled: Boolean(isLeave) });
  const agents = useQuery({ queryKey: ['manager', 'agents'], queryFn: () => api.get<AgentsBoard>('/manager/agents'), enabled: Boolean(personId) });

  const fu = r?.followUps;
  const mates = fu?.teammates ?? [];
  // A half day keeps its follow-ups (the server says when a handover is not needed).
  const offerHandover = Boolean(isLeave && fu && fu.planned > 0 && fu.handoverNeeded !== false && r?.status === 'pending');
  const handoverChoice = handover || (mates.length > 1 ? 'share' : mates.length === 1 ? mates[0].id : 'keep');
  const followUpsBody =
    handoverChoice === 'keep' ? { mode: 'keep' } : handoverChoice === 'share' ? { mode: 'share' } : { mode: 'teammate', staffId: handoverChoice };
  const act = useMutation({
    mutationFn: (decision: 'approved' | 'rejected' | 'part') =>
      api.post(
        `/requests/${encodeURIComponent(id)}/decide`,
        decision === 'part'
          ? { decision: 'approved', reason: note.trim(), fromDate: partFrom, toDate: partTo, ...(offerHandover ? { followUps: followUpsBody } : {}) }
          : { decision, reason: note.trim() || undefined, ...(decision === 'approved' && offerHandover ? { followUps: followUpsBody } : {}) },
      ),
    onSuccess: (_res, decision) => {
      toast.success(decision === 'approved' ? 'Approved · closed for everyone' : decision === 'part' ? 'Those days approved · the rest rejected' : 'Rejected');
      void qc.invalidateQueries();
      navigate(to('MG-Requests'));
    },
    onError: (e) => toast.error(e instanceof ApiError ? e.message : 'Something went wrong. Try again.'),
  });

  const back = { to: to('MG-Requests'), label: 'Requests' };
  if (detail.error) {
    return (
      <div className="lb-page">
        <TopBar back={back} title="Request" />
        <ErrorState error={detail.error} onRetry={() => void detail.refetch()} />
      </div>
    );
  }
  if (!r) {
    return (
      <div className="lb-page">
        <TopBar back={back} title="Request" />
        <SkeletonCard />
        <SkeletonCard />
      </div>
    );
  }

  const d = r.details;
  const team = requestTeam(r, tree);
  const person = personId ? tree.byId.get(personId) : undefined;
  const isTeamLead = r.person?.role === 'team_lead';
  const name = r.about && r.about.type !== 'staff' ? `${r.about.code} · ${r.about.name}` : `${r.person?.name ?? '—'}${isTeamLead ? ' (Team Lead)' : ''}`;
  const who = r.about && r.about.type !== 'staff' ? r.about.code : firstName(r.person?.name);
  const title = isLeave ? `Leave request · ${name}` : `${r.title} · ${name}`;
  const days = Number(d.days ?? 0);
  const monthName = typeof d.fromDate === 'string' ? (MONTHS[Number(d.fromDate.slice(5, 7)) - 1] ?? '') : '';
  const planned = d.leaveKind === 'casual';
  const taken = Number(d.casualDaysTakenThisMonth ?? 0);
  const pendingOthers = Number(d.casualDaysPendingThisMonth ?? 0);
  const balance = leave.data?.balances.find((b) => b.staff.id === personId);
  const overlapping = (leave.data?.off ?? []).filter(
    (o) => o.staff.id !== personId && o.status === 'approved' && o.from <= String(d.toDate ?? '') && o.to >= String(d.fromDate ?? ''),
  );
  const agentRow = agents.data?.rows.find((row) => row.staff.id === personId);

  const roleLine = roleWords(r.person?.role ?? '', team, person?.isIntern);
  const requestRows: [string, string][] = [
    ['From', r.about && r.about.type !== 'staff' ? name : `${r.person?.name ?? '—'} · ${isTeamLead ? roleLine : roleLine.charAt(0).toLowerCase() + roleLine.slice(1)}`],
    ['Type', isLeave ? (planned ? 'Planned (casual) leave' : 'Emergency leave') : r.title],
    [isLeave ? 'Dates' : 'What', r.summary],
  ];
  if (r.reason) requestRows.push(['Reason', r.reason]);
  if (r.requestedBy && r.requestedBy.id !== r.person?.id) requestRows.push(['Asked by', `${r.requestedBy.name}${r.requestedBy.role === 'team_lead' ? ' (TL)' : ''}`]);
  requestRows.push(['Asked', formatDateTimeIST(r.createdAt)]);

  const before: [string, string][] = [];
  if (isLeave) {
    before.push(['Leave left', balance ? `Planned ${balance.plannedLeft} · emergency ${balance.emergencyLeft}` : leave.isPending ? '…' : '—']);
    if (planned) {
      before.push([`Planned leave days in ${monthName}`, taken || pendingOthers ? `${taken} taken${pendingOthers ? ` · ${pendingOthers} asked` : ''} · with this, ${taken + pendingOthers + days}` : '0 so far']);
    } else {
      before.push([`Emergency leave in ${monthName}`, `${balance?.emergencyUsedThisMonth ?? 0} so far (emergency leave isn't counted against the limit)`]);
    }
    if (isTeamLead) {
      const leads = overlapping.filter((o) => o.staff.role === 'team_lead');
      before.push(['Other Team Leads off', leads.length ? leads.map((o) => o.staff.name).join(', ') : 'None']);
    } else {
      const sameTeam = overlapping.filter((o) => o.team === team);
      before.push([`Others off in ${team ? teamShort(team) : 'the team'} ${days > 1 ? 'those days' : 'that day'}`, sameTeam.length ? sameTeam.map((o) => o.staff.name).join(', ') : leave.isPending ? '…' : 'Nobody']);
    }
    if (fu) {
      const plannedCalls = `${fu.planned} follow-up${fu.planned === 1 ? '' : 's'}`;
      const moved = fu.handedOver.count
        ? ` · ${fu.handedOver.count} moved to ${fu.handedOver.to.map((m) => firstName(m.name)).join(' and ')}${fu.handedOver.returned ? ` · ${fu.handedOver.returned} back with ${who}` : ''}`
        : '';
      before.push([`Calls planned for ${who} ${days === 1 ? 'that day' : 'on these days'}`, `${plannedCalls}${moved}`]);
    }
  }
  if (r.kind === 'correction') before.push(['Correction this month', `${String(d.monthNumber ?? 1)} of the month`]);
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
    if (d.hoursLeft !== undefined && d.hoursLeft !== null) before.push(['48-hour limit', `${String(d.hoursLeft)} h left`]);
  }
  if (r.kind === 'target_change') before.push(['Change', `${String(d.metricLabel ?? '')}: ${d.from ?? '—'} → ${String(d.to ?? '—')}`]);
  if (r.kind === 'device') before.push(['Device', r.summary]);
  if (agentRow) {
    const pron = isTeamLead ? 'Their' : `${who}'s`;
    before.push([`${pron} attendance this month`, `${agentRow.attendancePercent === null ? '—' : `${agentRow.attendancePercent}%`} · ${agentRow.lateLogins} late login${agentRow.lateLogins === 1 ? '' : 's'}`]);
  }

  const events: TimelineEvent[] = r.history.map((h) => ({ at: h.at, text: h.text }));
  if (r.status === 'pending' && r.canDecide) {
    events.push({ at: now.toISOString(), text: `Now · waiting for you${r.dueAt && !r.withCeo ? ` · goes to the CEO if not answered by ${formatDateTimeIST(r.dueAt)}` : ''}` });
  }

  const showOverLimit = isLeave && planned && r.whyWithYou === 'over_limit' && r.status === 'pending';
  const range = r.canApprovePart && typeof d.fromDate === 'string' && typeof d.toDate === 'string' ? daysBetween(d.fromDate, d.toDate) : [];
  const from = partFrom || range[0] || '';
  const until = partTo && partTo >= from ? partTo : range[range.length - 1] || '';
  const partIsAll = from === range[0] && until === range[range.length - 1];
  const lead = tree.leadOf(personId);

  return (
    <div className="lb-page">
      <TopBar back={back} title={title} subtitle={`${who === '—' ? 'This' : `${who}'s`} request, with everything you need to decide.`} />
      {showOverLimit && (
        <div className="panel mg-banner mg-banner--warn" role="note">
          ⚠ {who} has already taken {taken} planned leave day{taken === 1 ? '' : 's'} in {monthName}. With {days === 1 ? 'this day' : `these ${days} days`} it becomes {taken + pendingOthers + days} — more than 3, so you decide. You can approve
          all of it, part of it (for example 3 days), or reject it with a reason.
        </div>
      )}
      {r.status === 'pending' && (
        <div className="panel mg-banner" role="status">
          <b>Why it is with you:</b> {r.canDecide ? whyBanner(r, tree, now) : r.withCeo ? 'It is with the CEO now.' : `It is with ${r.deciderStaff?.name ?? 'the Team Lead'}.`}
        </div>
      )}
      <div className="two-col">
        <Card title="Request">
          <Kv rows={requestRows} />
        </Card>
        <Card title="Before you decide">{before.length ? <Kv rows={before} /> : <p className="ceo-sub">Nothing else to check.</p>}</Card>
      </div>
      {r.canDecide ? (
        <Card title="Your decision">
          <label className="field">
            Note to them (needed if you reject)
            <textarea value={note} onChange={(e) => setNote(e.target.value)} placeholder="Optional when approving" rows={3} />
          </label>
          {offerHandover && (
            <label className="field" style={{ marginTop: 12 }}>
              Their follow-ups {days === 1 ? 'that day' : 'on those days'} go to
              <select value={handoverChoice} onChange={(e) => setHandover(e.target.value)}>
                {mates.length > 1 && <option value="share">{`Share between ${mates.map((m) => firstName(m.name)).join(' and ')}`}</option>}
                {mates.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.name}
                  </option>
                ))}
                <option value="keep">Keep for their return</option>
              </select>
              <span className="ceo-sub">They move back to {who} after the leave if still not done.</span>
            </label>
          )}
          {range.length > 1 && (
            <div className="mg-part" style={{ marginTop: 12 }}>
              <label className="mg-check">
                <input type="checkbox" checked={part} onChange={(e) => setPart(e.target.checked)} /> Approve only some of the days
              </label>
              {part && (
                <div className="mg-part__row">
                  <label className="field">
                    From
                    <select
                      value={from}
                      onChange={(e) => {
                        setPartFrom(e.target.value);
                        if (partTo && partTo < e.target.value) setPartTo('');
                      }}
                    >
                      {range.map((k) => (
                        <option key={k} value={k}>
                          {dayLabel(k)}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="field">
                    To
                    <select value={until} onChange={(e) => setPartTo(e.target.value)}>
                      {range
                        .filter((k) => k >= from)
                        .map((k) => (
                          <option key={k} value={k}>
                            {dayLabel(k)}
                          </option>
                        ))}
                    </select>
                  </label>
                </div>
              )}
              {part && <p className="ceo-sub">The other days are rejected with your note. Weekly days off and holidays are not counted as leave.</p>}
            </div>
          )}
          <div className="mg-actions" style={{ marginTop: 12 }}>
            {part && range.length > 1 ? (
              <Button
                variant="success"
                onClick={() => {
                  setPartFrom(from);
                  setPartTo(until);
                  act.mutate('part');
                }}
                disabled={!note.trim() || partIsAll}
                loading={act.isPending && act.variables === 'part'}
              >
                Approve {from === until ? dayLabel(from) : `${dayLabel(from)} – ${dayLabel(until)}`}
              </Button>
            ) : (
              <Button variant="success" onClick={() => act.mutate('approved')} loading={act.isPending && act.variables === 'approved'}>
                {isLeave ? 'Approve leave' : 'Approve'}
              </Button>
            )}
            <Button variant="danger" onClick={() => act.mutate('rejected')} disabled={!note.trim()} loading={act.isPending && act.variables === 'rejected'}>
              Reject
            </Button>
            {r.canSendBack && (
              <ActionButton
                label="Send back to the Team Lead"
                title={`Send back to ${lead ? `${lead.name} (TL)` : 'the Team Lead'}`}
                description={`It stays pending and goes back to ${lead ? `${firstName(lead.name)}'s` : 'their'} list to decide. If it is still not answered in 24 hours it comes back to you. More than 3 planned days in a month still need you.`}
                reason={{ label: 'Note to the Team Lead', required: true }}
                confirmLabel="Send back"
                run={({ reason }) => api.post(`/requests/${encodeURIComponent(r.ref)}/send-back`, { note: reason })}
                success="Sent back to the Team Lead"
              />
            )}
          </div>
          {!note.trim() && <p className="ceo-sub">{part ? 'Write a note: the days you do not approve are rejected with it.' : 'Write a note to reject.'}</p>}
        </Card>
      ) : (
        <Card title="Decision">
          <div className="mg-actions">
            <StatusPill tone={r.status === 'pending' ? 'info' : r.status === 'approved' ? 'good' : 'danger'}>
              {r.status === 'pending' ? (r.withCeo ? 'With the CEO' : r.withTeamLead ? 'With the Team Lead' : 'Pending') : r.status === 'approved' ? 'Approved' : 'Rejected'}
              {r.overturned ? ' · overturned' : ''}
            </StatusPill>
            {r.decided?.by && (
              <span className="ceo-sub">
                by {r.decided.by.name} · {formatDateTimeIST(r.decided.at)}
              </span>
            )}
            {r.canOverturn && (
              <ActionButton
                label="Overturn"
                title={`Overturn: ${r.title.toLowerCase()} · ${name}`}
                description="The Team Lead, the person and the CEO see your reason in the history."
                reason={{ label: 'Why you are overturning it', required: true }}
                confirmLabel="Overturn"
                run={({ reason }) => api.post(`/requests/${encodeURIComponent(r.ref)}/overturn`, { reason })}
                success="Decision overturned"
              />
            )}
          </div>
          {r.decided?.reason && r.decided.reason !== 'Approved' && <p className="ceo-sub">"{r.decided.reason}"</p>}
        </Card>
      )}
      <Card title="Where this request has been">
        <Timeline events={events} />
      </Card>
    </div>
  );
}
