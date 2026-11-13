import { useState } from 'react';
import { StaffAvatar } from '../../../components/StaffAvatar';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useParams } from 'react-router-dom';
import { Button } from '../../../components/Button';
import { Card } from '../../../components/Card';
import { ErrorState } from '../../../components/ErrorState';
import { SkeletonCard } from '../../../components/Skeleton';
import { StatGrid, StatTile } from '../../../components/StatTile';
import { TopBar } from '../../../components/TopBar';
import { useToast } from '../../../components/Toast';
import { api } from '../../../lib/api/client';
import { ApiError } from '../../../lib/api/errors';
import { formatDateIST, formatDateTimeIST, formatTimeIST } from '../../../lib/format/date';
import { useScreenPath } from '../../../portals/PortalContext';
import { ActionButton } from '../../ceo/_kit/actions';
import { hm, ms, roleLabel } from '../../ceo/_kit/format';
import { firstName, useTeam, type Brief, type PaceRow } from '../_kit/api';
import { Verdict } from '../_kit/targets';

/** One agent — design T-Agent.dc.html. Phone numbers stay hidden. */
interface AgentDetail {
  staff: Brief & { photoUrl?: string | null };
  main: { label: string; target: number | null; done: number; projection: number; verdict: string | null };
  lateLogins: { count: number; minutes: number };
  leaveLeft: { casual: number; emergency: number; total: number };
  callQuality: number | null;
  targets: Array<PaceRow & { metric: string; label: string }>;
  pendingTargetChanges: Array<{ ref: string; details: { metricLabel?: string; from?: number | null; to?: number } }>;
  attendance: Array<{ id: string; date: string; dayType: string; loginAt: string | null; lateMinutes: number; productionSeconds: number; changed: boolean; leaveKind: string | null }>;
  scoredCalls: Array<{ callId: string; at: string; with: string | null; durationSec: number | null; score: number; note: string | null }>;
  notes: Array<{ id: string; kind: string; text: string; at: string; author: Brief | null; byYou: boolean }>;
}

const DAY_TYPE: Record<string, string> = { full: 'Full day', half: 'Half day', absent: 'Absent', leave: 'Leave', off: 'Day off', open: 'Today' };
const NOTE_KIND: Record<string, string> = { note: '', one_to_one: '1:1 · ', verbal_warning: 'Verbal reminder · ', written_warning: 'Written warning · ' };

export default function TeamLeadAgent() {
  const { id = '' } = useParams();
  const to = useScreenPath();
  const toast = useToast();
  const qc = useQueryClient();
  const team = useTeam();
  const [note, setNote] = useState('');
  const agent = useQuery({ queryKey: ['team-lead', 'agent', id], queryFn: () => api.get<AgentDetail>(`/team-lead/agents/${id}`) });
  const save = useMutation({
    mutationFn: () => api.post(`/team-lead/agents/${id}/notes`, { text: note }),
    onSuccess: () => {
      toast.success('Note saved');
      setNote('');
      void qc.invalidateQueries({ queryKey: ['team-lead', 'agent', id] });
    },
    onError: (e) => toast.error(e instanceof ApiError ? e.message : 'Could not save the note'),
  });
  const a = agent.data;
  const mgrName = team.data?.manager?.name;
  const mgr = mgrName ? firstName(mgrName) : 'the Manager';
  if (agent.error) return <div className="lb-page"><TopBar showSearch={false} back={{ to: to('T-Agents'), label: 'Agents' }} title="Agent" /><ErrorState error={agent.error} onRetry={() => void agent.refetch()} /></div>;
  if (!a) return <div className="lb-page"><TopBar showSearch={false} back={{ to: to('T-Agents'), label: 'Agents' }} title="Agent" /><SkeletonCard /><SkeletonCard /></div>;
  const he = firstName(a.staff.name);
  const metricOptions = a.targets.map((t) => ({ value: t.metric, label: t.label }));
  return (
    <div className="lb-page">
      <TopBar showSearch={false} back={{ to: to('T-Agents'), label: 'Agents' }} title={`${a.staff.name} · ${roleLabel(a.staff.role).toLowerCase()}`} titleBadge={<StaffAvatar name={a.staff.name} photoUrl={a.staff.photoUrl} size="md" />} subtitle="One agent: targets, attendance, call quality and coaching. Phone numbers stay hidden." />
      <StatGrid>
        <StatTile label={a.main.label} value={a.main.target === null ? a.main.done : `${a.main.done} of ${a.main.target}`} tone="royal" />
        <StatTile label="At this speed by month end" value={a.main.projection} tone={a.main.verdict?.startsWith('Short') ? 'red' : 'good'} />
        <StatTile label="Late logins" value={a.lateLogins.count ? `${a.lateLogins.count} · ${a.lateLogins.minutes} min` : '0'} tone="orange" />
        <StatTile label="Leave left" value={`${a.leaveLeft.total} days`} tone="cyan" />
        <StatTile label="Call quality" value={a.callQuality === null ? '—' : `${a.callQuality} / 100`} tone="gold" />
      </StatGrid>
      <Card
        title="Targets · this month"
        aside={
          <ActionButton
            label={`Ask ${mgr} to change a target`}
            title={`Ask ${mgr} to change a target`}
            description={`${mgr} decides; you'll see the answer in Decided this week.`}
            choice={{ label: 'Target', options: metricOptions }}
            reason={{ label: 'New number and why (e.g. "15 — he is ahead")', required: true }}
            confirmLabel="Send to the Manager"
            run={({ reason, choice }) => {
              const number = Number((reason.match(/\d+/) ?? [''])[0]);
              if (!Number.isInteger(number) || !/\d/.test(reason)) throw new ApiError({ status: 400, messages: ['Start with the new number, e.g. "15 — he is ahead"'] });
              return api.post('/requests', { kind: 'target_change', staffId: a.staff.id, metric: choice, to: number, reason });
            }}
            success={`Sent to ${mgr}`}
          />
        }
      >
        <div className="scrollx">
          <table>
            <caption className="sr-only">Targets this month</caption>
            <thead>
              <tr>
                <th>What</th>
                <th>Target</th>
                <th>Done</th>
                <th>At this speed</th>
                <th>Will {he} make it?</th>
              </tr>
            </thead>
            <tbody>
              {a.targets.map((t) => (
                <tr key={t.metric}>
                  <td>{t.label}</td>
                  <td>{t.target ?? '—'}</td>
                  <td>{t.done}</td>
                  <td>{t.projection}</td>
                  <td>
                    <Verdict row={t} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {a.pendingTargetChanges.length > 0 && (
          <p className="tl-sub">
            Waiting with {mgr}: {a.pendingTargetChanges.map((p) => `${p.details.metricLabel} ${p.details.from ?? '—'} → ${p.details.to}`).join(' · ')}
          </p>
        )}
      </Card>
      <div className="two-col">
        <Card title="Attendance · this month" aside={<Link to={to('T-Attendance')}>Full report</Link>}>
          <div className="scrollx">
            <table>
              <caption className="sr-only">Attendance this month</caption>
              <thead>
                <tr>
                  <th>Day</th>
                  <th>Login</th>
                  <th>Work time</th>
                  <th>Counts as</th>
                </tr>
              </thead>
              <tbody>
                {a.attendance.filter((d) => d.dayType !== 'off').map((d) => (
                  <tr key={d.id ?? d.date}>
                    <td>{formatDateIST(`${d.date}T06:00:00Z`)}</td>
                    <td>
                      {d.loginAt ? formatTimeIST(d.loginAt) : '—'}
                      {d.lateMinutes > 0 && <span className="tl-alert"> · {d.lateMinutes} late</span>}
                    </td>
                    <td>{d.loginAt ? hm(d.productionSeconds) : '—'}</td>
                    <td>
                      {DAY_TYPE[d.dayType] ?? d.dayType}
                      {d.changed ? ' · changed' : ''}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
        <Card title="Calls you listened to" aside={<Link to={to('T-Quality')}>Listen to another</Link>}>
          {a.scoredCalls.length === 0 ? (
            <p className="tl-sub">You haven't scored any of {he}'s calls yet.</p>
          ) : (
            <div className="scrollx">
              <table>
                <caption className="sr-only">Calls you listened to</caption>
                <thead>
                  <tr>
                    <th>When</th>
                    <th>Call with</th>
                    <th>Length</th>
                    <th>Score</th>
                    <th>What you noted</th>
                  </tr>
                </thead>
                <tbody>
                  {a.scoredCalls.map((c) => (
                    <tr key={c.callId}>
                      <td>{formatDateTimeIST(c.at)}</td>
                      <td>{c.with ?? '—'}</td>
                      <td>{ms(c.durationSec)}</td>
                      <td>{c.score} / 100</td>
                      <td className="tl-sub">{c.note ?? '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      </div>
      <Card title="Coaching notes">
        {a.notes.length === 0 ? (
          <p className="tl-sub">No notes yet.</p>
        ) : (
          <div className="tl-chain">
            {a.notes.map((n) => (
              <div key={n.id} className="tl-attn" style={{ gridTemplateColumns: '90px 1fr auto' }}>
                <span className="tl-sub">{formatDateIST(n.at)}</span>
                <span>
                  {NOTE_KIND[n.kind] ?? ''}
                  {n.text}
                </span>
                <span className="tl-sub">{n.byYou ? 'You' : (n.author?.name ?? '—')}</span>
              </div>
            ))}
          </div>
        )}
        <label className="field" style={{ marginTop: 12 }}>
          Add a note ({he}, {mgr} and the CEO can see it)
          <textarea value={note} onChange={(e) => setNote(e.target.value)} placeholder="What you agreed" rows={3} />
        </label>
        <div className="tl-actions" style={{ marginTop: 10 }}>
          <Button variant="primary" onClick={() => save.mutate()} disabled={!note.trim()} loading={save.isPending}>
            Save note
          </Button>
          <ActionButton
            label={`Ask ${mgr} for a written warning`}
            title={`Ask ${mgr} for a written warning`}
            description={`A Team Lead can't give a written warning — ${mgr} decides.`}
            reason={{ label: 'What happened', required: true }}
            confirmLabel="Send to the Manager"
            run={({ reason }) => api.post('/requests', { kind: 'written_warning', staffId: a.staff.id, reason, text: reason })}
            success={`Sent to ${mgr}`}
          />
        </div>
      </Card>
    </div>
  );
}
