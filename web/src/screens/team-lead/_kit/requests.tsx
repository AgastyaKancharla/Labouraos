import { Link } from 'react-router-dom';
import { LinkTabs } from '../../../components/Tabs';
import { api } from '../../../lib/api/client';
import { useScreenPath } from '../../../portals/PortalContext';
import { ActionButton } from '../../ceo/_kit/actions';
import { roleLabel } from '../../ceo/_kit/format';
import type { RequestView } from './api';
import { firstName } from './api';
import './tl.css';

/** "Waiting for you (6) | Decided this week" — the two Requests tabs. */
export function RequestTabs({ waiting }: { waiting?: number }) {
  const to = useScreenPath();
  return (
    <LinkTabs
      label="Requests"
      items={[
        { to: to('T-Requests'), label: `Waiting for you${waiting === undefined ? '' : ` (${waiting})`}`, end: true },
        { to: to('T-Decided'), label: 'Decided this week' },
      ]}
    />
  );
}

/** Who: the person (or the job seeker / placement) and a small line under it. */
export function RequestWho({ request }: { request: RequestView }) {
  if (request.about && request.about.type !== 'staff') {
    const sub =
      request.kind === 'hit_removal'
        ? `Hit recorded by ${String(request.details.hitRecordedBy ?? 'the phone system')}`
        : request.kind === 'claim'
          ? `Account agent ${request.person?.name ?? '—'}`
          : '';
    return (
      <div>
        <div className="tl-strong">
          {request.about.code} · {request.about.name}
        </div>
        <div className="tl-sub">{sub}</div>
      </div>
    );
  }
  return (
    <div>
      <div className="tl-strong">{request.person?.name ?? '—'}</div>
      <div className="tl-sub">{roleLabel(request.person?.role)}</div>
    </div>
  );
}

export function RequestWants({ request }: { request: RequestView }) {
  return (
    <div>
      <div className="tl-strong">{request.title}</div>
      <div className="tl-sub">
        {request.summary}
        {request.reason && request.kind !== 'hit_removal' && request.kind !== 'claim' ? ` · ${request.reason}` : ''}
      </div>
    </div>
  );
}

/** Approve · Reject (reason needed) · Send to Manager (note needed), each with a confirm step. */
export function RequestActions({ request, managerName, compact }: { request: RequestView; managerName?: string; compact?: boolean }) {
  const to = useScreenPath();
  if (!request.canDecide) return null;
  const who = request.about && request.about.type !== 'staff' ? `${request.about.code}` : (request.person?.name ?? '');
  return (
    <div className="tl-actions">
      <ActionButton
        label="Approve"
        variant="success"
        title={`Approve: ${request.title.toLowerCase()} · ${who}`}
        description={request.summary}
        reason={{ label: 'Note (optional)', required: false }}
        confirmLabel="Approve"
        run={({ reason }) => api.post(`/requests/${request.ref}/decide`, { decision: 'approved', reason: reason || undefined })}
        success="Approved · the request is closed for everyone"
      />
      <ActionButton
        label="Reject"
        variant="danger"
        title={`Reject: ${request.title.toLowerCase()} · ${who}`}
        description="Say why — they see it with the decision."
        reason
        confirmLabel="Reject"
        run={({ reason }) => api.post(`/requests/${request.ref}/decide`, { decision: 'rejected', reason })}
        success="Rejected"
      />
      {request.canForward && (
        <ActionButton
          label="Send to Manager"
          title={`Send to ${managerName ? `${managerName} (Manager)` : 'the Manager'}`}
          description="It moves to the Manager's list with your note."
          reason={{ label: 'Note for the Manager', required: true }}
          confirmLabel="Send"
          run={({ reason }) => api.post(`/requests/${request.ref}/forward`, { note: reason })}
          success="Sent to the Manager"
        />
      )}
      {!compact && (request.kind === 'leave' || request.kind === 'correction' || request.kind.includes('_')) && (
        <Link to={to('T-Req-Sneha', { id: request.ref })} className="tl-open">
          Open
        </Link>
      )}
    </div>
  );
}

/** The plain line under "You can decide" / "Waiting 26 h — now also with Priya". */
export function requestNote(request: RequestView, managerName: string | undefined, waited: string): string {
  const mgr = managerName ? `${firstName(managerName)} (Manager)` : 'the Manager';
  if (request.kind === 'claim') return `Decide within 48 hours · ${String(request.details.hoursLeft ?? '')} h left`;
  if (request.withTeamLead && request.withManager) return `Waiting ${waited} — now also with ${mgr}. Whoever decides first closes it for both`;
  if (request.kind === 'leave' && request.details.leaveKind === 'casual') {
    const taken = Number(request.details.casualDaysTakenThisMonth ?? 0) + Number(request.details.casualDaysPendingThisMonth ?? 0) + Number(request.details.days ?? 0);
    return `You can decide: ${taken} of 3 planned days this month with this`;
  }
  if (request.kind === 'device') return "Agents' devices are approved by you";
  if (request.kind === 'hit_removal') return `You can decide · ${request.alert ?? ''}`;
  return 'You can decide';
}
