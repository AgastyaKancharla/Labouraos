import './manager.css';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { LinkTabs } from '../../../components/Tabs';
import { api } from '../../../lib/api/client';
import { useScreenPath } from '../../../portals/PortalContext';
import { ActionButton } from '../../ceo/_kit/actions';
import type { RequestDetail, RequestView } from '../../team-lead/_kit/api';
import { roleTeam } from './kit';

export type { RequestDetail, RequestView };

/**
 * Shared pieces of the Manager's Requests screens (MG-Requests, MG-Decided,
 * MG-Req-*), on the shared requests backend (GET /requests/*). Requests
 * carry no money: the backend never puts any in, and the PII interceptor
 * masks phone numbers for a Manager.
 */

/** Someone in the Manager's tree, from GET /manager/staff (for the team name). */
export interface TreeRow {
  id: string;
  code: string;
  name: string;
  role: string;
  isIntern: boolean;
  team: string | null;
  teamLeadId: string | null;
}
export interface StaffBoard {
  manager: { id: string; code: string; name: string };
  rows: TreeRow[];
}

export const useWaiting = () => useQuery({ queryKey: ['requests', 'waiting'], queryFn: () => api.get<RequestView[]>('/requests/waiting'), refetchInterval: 60_000 });
export const useOpenRequests = () => useQuery({ queryKey: ['requests', 'open'], queryFn: () => api.get<RequestView[]>('/requests/open'), refetchInterval: 60_000 });
export const useTree = () => useQuery({ queryKey: ['manager', 'staff'], queryFn: () => api.get<StaffBoard>('/manager/staff'), staleTime: 60_000 });

/** The types the Type filter offers, in the design's order. */
export const TYPE_OPTIONS: { value: string; label: string; kinds: RequestView['kind'][]; leaveKind?: string }[] = [
  { value: 'leave', label: 'Leave', kinds: ['leave'] },
  { value: 'day_change', label: 'Change a day', kinds: ['day_change'] },
  { value: 'correction', label: 'Attendance correction', kinds: ['correction'] },
  { value: 'claim', label: 'Replacement claim', kinds: ['claim'] },
  { value: 'hit_removal', label: 'Remove a hit', kinds: ['hit_removal'] },
  { value: 'target_change', label: 'Target change', kinds: ['target_change'] },
  { value: 'device', label: 'New device', kinds: ['device'] },
  { value: 'written_warning', label: 'Written warning', kinds: ['written_warning'] },
];

export function firstName(name: string | null | undefined): string {
  return (name ?? '').split(' ')[0] || '—';
}

/** "26 h", "3 h", "40 min", "2 d" since an instant. */
export function waitedFor(iso: string, now: Date): string {
  const mins = Math.max(0, Math.floor((now.getTime() - new Date(iso).getTime()) / 60000));
  if (mins < 60) return `${mins} min`;
  const h = Math.floor(mins / 60);
  if (h < 48) return `${h} h`;
  return `${Math.floor(h / 24)} d`;
}

/** Look up people in the tree: team per person, and each team's Team Lead. */
export function treeIndex(board: StaffBoard | undefined) {
  const byId = new Map((board?.rows ?? []).map((r) => [r.id, r]));
  const teamOf = (id: string | null | undefined) => (id ? (byId.get(id)?.team ?? null) : null);
  const leadOf = (id: string | null | undefined) => {
    const person = id ? byId.get(id) : undefined;
    if (!person || person.role === 'team_lead' || !person.teamLeadId) return null;
    return byId.get(person.teamLeadId) ?? null;
  };
  const teams = [...new Set((board?.rows ?? []).map((r) => r.team).filter((t): t is string => Boolean(t)))].sort();
  return { byId, teamOf, leadOf, teams };
}

/** The team a request belongs to: the person's (the account agent's for a claim). */
export function requestTeam(r: RequestView, tree: ReturnType<typeof treeIndex>): string | null {
  return tree.teamOf(r.person?.id) ?? tree.teamOf(r.requestedBy?.id);
}

/** Who: the person (or the job seeker / placement) and a small line under it. */
export function RequestWho({ request, tree }: { request: RequestView; tree: ReturnType<typeof treeIndex> }) {
  const r = request;
  if (r.about && r.about.type !== 'staff') {
    const asker = r.requestedBy && r.requestedBy.id !== r.person?.id ? r.requestedBy : null;
    const sub =
      r.kind === 'claim'
        ? `Replacement claim${r.summary ? ` · ${r.summary}` : ''}`
        : asker
          ? `Asked by ${firstName(asker.name)}${asker.role === 'team_lead' ? ' (TL)' : ''}`
          : r.person
            ? `Asked by ${firstName(r.person.name)}`
            : '';
    return (
      <div className="mg-what">
        <b>
          {r.about.code} · {r.about.name}
        </b>
        <span>{sub}</span>
      </div>
    );
  }
  const person = r.person ? tree.byId.get(r.person.id) : undefined;
  return (
    <div className="mg-what">
      <b>{r.person?.name ?? '—'}</b>
      <span>{r.person ? roleWords(r.person.role, requestTeam(r, tree), person?.isIntern) : ''}</span>
    </div>
  );
}

/** "Call agent · South", "Team Lead · North", "Field agent · North (intern)". */
export function roleWords(role: string, team: string | null | undefined, isIntern = false): string {
  const short = roleTeam(role, team, isIntern);
  return short.replace(/^Call\b/, 'Call agent').replace(/^Field\b/, 'Field agent');
}

/** What was asked: the kind, and one line of what (with the reason when there is one). */
export function RequestWants({ request }: { request: RequestView }) {
  const r = request;
  const extra = r.reason && r.kind !== 'hit_removal' && r.kind !== 'claim' ? ` · ${r.reason}` : r.kind === 'hit_removal' && r.reason ? ` · ${r.reason}` : '';
  return (
    <div className="mg-what">
      <b>{r.title}</b>
      <span>
        {r.kind === 'target_change' ? targetChangeLine(r) : r.summary}
        {extra}
      </span>
    </div>
  );
}

function targetChangeLine(r: RequestView): string {
  const d = r.details;
  if (d.metricLabel === undefined) return r.summary;
  return `${String(d.metricLabel)} ${d.from ?? '—'} → ${String(d.to ?? '—')}`;
}

/**
 * Why it is with the Manager, in the design's words ("A Team Lead's own leave
 * — only a Manager decides", "Ravi (TL) hasn't answered for 26 h…").
 */
export function whyLine(r: RequestView, tree: ReturnType<typeof treeIndex>, now: Date): string {
  const lead = tree.leadOf(r.person?.id);
  const tl = lead ? `${firstName(lead.name)} (TL)` : 'The Team Lead';
  const waited = waitedFor(r.createdAt, now);
  switch (r.whyWithYou) {
    case 'team_lead_own':
      return r.kind === 'leave' ? "A Team Lead's own leave — only a Manager decides" : "A Team Lead's own request — only a Manager decides";
    case 'device_team_lead':
      return "A Team Lead's device — only a Manager approves";
    case 'over_limit':
      return 'More than 3 planned days in a month — comes to a Manager automatically';
    case 'third_correction':
      return '3rd correction this month — over 2 needs a Manager';
    case 'third_hit':
      return '3rd hit on this job seeker — needs a Manager';
    case 'third_day_change':
      return '3rd day change this month — needs a Manager';
    case 'forwarded': {
      const by = r.forwarded?.by ? `${firstName(r.forwarded.by.name)} (TL)` : tl;
      return `Forwarded by ${by}${r.forwarded?.note ? ` — "${r.forwarded.note}"` : ''}`;
    }
    case 'team_lead_24h':
    case 'device_24h':
      return `${tl} hasn't answered for ${waited}. It is still in ${lead ? `${firstName(lead.name)}'s` : 'their'} list too — whoever decides first closes it for both`;
    case 'claim_24h': {
      const left = r.details.hoursLeft;
      return `${tl} hasn't decided for ${waited}${left !== undefined && left !== null ? ` · ${String(left)} h left of the 48-hour limit` : ''}`;
    }
    case 'target_change':
    case 'written_warning': {
      const asker = r.requestedBy && r.requestedBy.id !== r.person?.id ? r.requestedBy : null;
      return asker ? `Asked by ${firstName(asker.name)}${asker.role === 'team_lead' ? ' (TL)' : ''}` : (r.whyWithYouText ?? r.routeReasonText);
    }
    default:
      return r.whyWithYouText ?? r.routeReasonText;
  }
}

/** Approve · Reject (reason needed) · Open, each decision with a confirm step. */
export function RequestActions({ request, tree, open = true }: { request: RequestView; tree: ReturnType<typeof treeIndex>; open?: boolean }) {
  const to = useScreenPath();
  const r = request;
  const who = r.about && r.about.type !== 'staff' ? r.about.code : (r.person?.name ?? '');
  return (
    <div className="mg-actions">
      {r.canDecide && (
        <>
          <ActionButton
            label="Approve"
            variant="success"
            title={`Approve: ${r.title.toLowerCase()} · ${who}`}
            description={`${r.summary}${requestTeam(r, tree) ? ` · ${requestTeam(r, tree)}` : ''}. The Team Lead's list updates too and the person is told.`}
            reason={{ label: 'Note (optional)', required: false }}
            confirmLabel="Approve"
            run={({ reason }) => api.post(`/requests/${encodeURIComponent(r.ref)}/decide`, { decision: 'approved', reason: reason || undefined })}
            success="Approved · the request is closed for everyone"
          />
          <ActionButton
            label="Reject"
            variant="danger"
            title={`Reject: ${r.title.toLowerCase()} · ${who}`}
            description="Say why — they see it with the decision."
            reason
            confirmLabel="Reject"
            run={({ reason }) => api.post(`/requests/${encodeURIComponent(r.ref)}/decide`, { decision: 'rejected', reason })}
            success="Rejected"
          />
        </>
      )}
      {open && (
        <Link to={to('MG-Req-Ravi', { id: r.ref })} className="mg-open">
          Open
        </Link>
      )}
    </div>
  );
}

/** "Waiting for you (9) | Decided this week" — the two Requests tabs. */
export function RequestTabs({ waiting }: { waiting?: number }) {
  const to = useScreenPath();
  return (
    <LinkTabs
      label="Requests"
      items={[
        { to: to('MG-Requests'), label: `Waiting for you${waiting === undefined ? '' : ` (${waiting})`}`, end: true },
        { to: to('MG-Decided'), label: 'Decided this week' },
      ]}
    />
  );
}
