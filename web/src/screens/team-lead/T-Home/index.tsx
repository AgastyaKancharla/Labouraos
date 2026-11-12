import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { ButtonLink } from '../../../components/Button';
import { Card } from '../../../components/Card';
import { ErrorState } from '../../../components/ErrorState';
import { StatusPill } from '../../../components/Badge';
import { SkeletonCard } from '../../../components/Skeleton';
import { StatGrid, StatTile } from '../../../components/StatTile';
import { TopBar } from '../../../components/TopBar';
import { useAuth } from '../../../auth/AuthProvider';
import { api } from '../../../lib/api/client';
import { istPartOfDay } from '../../../lib/format/date';
import { useNow } from '../../../lib/useNow';
import { useScreenPath } from '../../../portals/PortalContext';
import { firstName, liveText, statusTone, useLive, useTargets, useTeam, useToday, useWaiting, waitedFor } from '../_kit/api';
import { RequestActions, RequestWants, RequestWho } from '../_kit/requests';
import { heroLine, monthName, TeamTargetsTable } from '../_kit/targets';

/** Team Lead home — design T-Home.dc.html: my team today. */
interface N2 {
  total: number;
  rows: Array<{ jobSeekerId: string; code: string; firstName: string; trade: string | null; daysSincePaid: number; daysLeftOnGuarantee: number; registeredBy: { name: string } | null }>;
}
interface ShortageTask {
  id: string;
  trade?: string;
  tradeName?: string;
  area?: string;
  areaName?: string;
  openPositions: number;
}
interface WorkSummary {
  summary: { stuck: number; followUpsOverdue: number; interviewsToday: number; resultsOverdue: number };
  stuck: Array<{ agent: { name: string } | null }>;
}
interface VisitsSummary {
  summary: { toCheck: number };
  rows: Array<{ agent: { name: string } | null; shop: string; durationSeconds: number | null; flags: unknown[]; check: unknown }>;
}

export default function TeamLeadHome() {
  const to = useScreenPath();
  const now = useNow();
  const { session } = useAuth();
  const team = useTeam();
  const targets = useTargets();
  const live = useLive();
  const today = useToday();
  const waiting = useWaiting();
  const n2 = useQuery({ queryKey: ['growth', 'days-to-first-interview'], queryFn: () => api.get<N2>('/growth/days-to-first-interview') });
  const n3 = useQuery({ queryKey: ['growth', 'shortage-tasks'], queryFn: () => api.get<ShortageTask[] | { rows: ShortageTask[] }>('/growth/shortage-tasks') });
  const work = useQuery({ queryKey: ['team-lead', 'work'], queryFn: () => api.get<WorkSummary>('/team-lead/work') });
  const visits = useQuery({ queryKey: ['team-lead', 'visits', 'today'], queryFn: () => api.get<VisitsSummary>('/team-lead/visits') });
  const quality = useQuery({ queryKey: ['team-lead', 'quality'], queryFn: () => api.get<{ summary: { toListen: number }; picked: Array<{ agent: { name: string } | null }> }>('/team-lead/quality') });

  const info = team.data;
  const teamName = info?.teamName ?? 'Your team';
  const manager = info?.manager;
  const t = targets.data;
  const behind = t?.agents.filter((a) => a.target !== null).sort((a, b) => (a.projection / (a.target || 1)) - (b.projection / (b.target || 1)))[0];
  const hero = t ? heroLine(t.team, behind ? { name: behind.staff.name, done: behind.done, target: behind.target, label: behind.mainLabel } : null) : null;
  const part = istPartOfDay(now);
  const greeting = `Good ${part}, ${firstName(session?.staff.name)}`;
  const waitingRows = waiting.data ?? [];
  const todayFor = (id: string) => today.data?.agents.find((a) => a.staff.id === id);
  const shortage = Array.isArray(n3.data) ? n3.data : (n3.data?.rows ?? []);

  const overBreak = live.data?.people.filter((p) => p.overBreak) ?? [];
  const shortVisits = visits.data?.rows.filter((v) => v.flags.length && !v.check) ?? [];
  const stuckByAgent = Object.entries(
    (work.data?.stuck ?? []).reduce<Record<string, number>>((acc, row) => {
      const name = firstName(row.agent?.name);
      acc[name] = (acc[name] ?? 0) + 1;
      return acc;
    }, {}),
  )
    .map(([name, n]) => `${name} ${n}`)
    .join(', ');
  const attention: Array<{ label: string; color: string; text: string; link: string; linkLabel: string }> = [];
  for (const p of overBreak) attention.push({ label: 'Break', color: 'var(--red-raw)', text: `${p.staff.name} is over the break`, link: to('T-Attendance-Live'), linkLabel: 'Live board' });
  if (work.data?.summary.stuck) attention.push({ label: 'Stuck', color: 'var(--orange-raw)', text: `${work.data.summary.stuck} registration links not finished for over 24 hours (${stuckByAgent})`, link: to('T-Work'), linkLabel: 'Work list' });
  if (work.data?.summary.resultsOverdue) attention.push({ label: 'Owners', color: 'var(--gold-raw)', text: `${work.data.summary.resultsOverdue} interview results overdue from owners`, link: to('T-Work'), linkLabel: 'Work list' });
  if (n2.data?.total) attention.push({ label: 'Interviews', color: 'var(--orange-raw)', text: `${n2.data.total} paid job seekers with no interview booked 10+ days after paying`, link: to('T-Work'), linkLabel: 'Work list' });
  for (const s of shortage.slice(0, 3)) attention.push({ label: 'Shortage', color: 'var(--orange-raw)', text: `${s.tradeName ?? s.trade ?? 'Trade'}, ${s.areaName ?? s.area ?? 'area'}: ${s.openPositions} open, no job seeker nearby · send agents to register this trade`, link: to('T-Work'), linkLabel: 'Work list' });
  for (const v of shortVisits.slice(0, 3)) attention.push({ label: 'Visits', color: 'var(--red-raw)', text: `${v.agent?.name ?? 'An agent'}: one visit at ${v.shop}${v.durationSeconds !== null ? ` lasted ${Math.max(1, Math.round(v.durationSeconds / 60))} minutes` : ' needs a check'}`, link: to('T-Visits'), linkLabel: 'Visit proof' });
  if (quality.data?.summary.toListen) attention.push({ label: 'Quality', color: 'var(--royal)', text: `${quality.data.summary.toListen} calls waiting for you to listen and score`, link: to('T-Quality'), linkLabel: 'Listen' });

  return (
    <div className="lb-page">
      <TopBar
        eyebrow={`Team Lead · ${teamName}${manager ? ` · reports to ${manager.name} (Manager)` : ''}`}
        title={greeting}
        subtitle={`${teamName} today: who is working, what got done, and whether the month's targets will be reached.`}
        showSearch={false}
        actions={
          <>
            <ButtonLink to={to('T-Reports')}>Daily report</ButtonLink>
            <ButtonLink to={to('T-Requests')} variant="primary">
              Requests ({waitingRows.length})
            </ButtonLink>
          </>
        }
      />

      {targets.error ? (
        <ErrorState error={targets.error} onRetry={() => void targets.refetch()} />
      ) : !t || !hero ? (
        <SkeletonCard height={90} />
      ) : (
        <div className="panel tl-hero">
          <div>
            <div className="eyebrow">
              {teamName} · {monthName(t.month)} · day {t.dayOfMonth} of {t.daysInMonth} · {t.daysLeft} days left
            </div>
            <h2>{hero.title}</h2>
            <p>{hero.sub}</p>
          </div>
          <div className="tl-pills">
            <StatusPill tone="good">{hero.reached} will be reached</StatusPill>
            {hero.short > 0 && <StatusPill tone="danger">{hero.short} will fall short</StatusPill>}
          </div>
        </div>
      )}

      <Card title="Right now" aside={<ButtonLink to={to('T-Attendance-Live')}>Live board</ButtonLink>}>
        {live.error ? (
          <ErrorState error={live.error} onRetry={() => void live.refetch()} compact />
        ) : (
          <div className="scrollx">
            <table>
              <caption className="sr-only">Who is working right now</caption>
              <thead>
                <tr>
                  <th>Agent</th>
                  <th>Role</th>
                  <th>Status</th>
                  <th>Today so far</th>
                </tr>
              </thead>
              <tbody>
                {(live.data?.people ?? []).map((p) => {
                  const c = todayFor(p.staff.id);
                  const field = p.staff.role === 'field_agent';
                  return (
                    <tr key={p.staff.id}>
                      <td>
                        <Link to={to('T-Agent', { id: p.staff.id })}>{p.staff.name}</Link>
                      </td>
                      <td>{field ? 'Field' : 'Call'}</td>
                      <td>
                        <StatusPill tone={statusTone(p)}>{liveText(p, now)}</StatusPill>
                      </td>
                      <td className="tl-sub">
                        {c ? (field ? `${c.visits} visits · ${c.businesses} businesses · ${c.interviews} interviews` : `${c.calls} calls · ${c.registered} registered · ${c.paid} paid`) : '…'}
                      </td>
                    </tr>
                  );
                })}
                {live.data && live.data.people.length === 0 && (
                  <tr>
                    <td colSpan={4} className="tl-sub">
                      Nobody in your team yet. New people are added by your Manager or the CEO.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <StatGrid>
        <StatTile label="Calls today" value={today.data?.totals.calls ?? '—'} tone="royal" loading={today.isPending} />
        <StatTile label="Registered today" value={today.data?.totals.registered ?? '—'} tone="cyan" loading={today.isPending} />
        <StatTile label="Paid the ₹499 fee today" value={today.data?.totals.paid ?? '—'} tone="good" loading={today.isPending} />
        <StatTile label="Shop visits today" value={today.data?.totals.visits ?? '—'} tone="orange" loading={today.isPending} />
        <StatTile label="Interviews today" value={today.data?.totals.interviews ?? '—'} tone="gold" loading={today.isPending} />
      </StatGrid>

      <Card title={`Team targets · ${t ? monthName(t.month) : ''}`} aside={<ButtonLink to={to('T-Targets')}>Each agent</ButtonLink>}>
        {targets.error ? <ErrorState error={targets.error} compact /> : t ? <TeamTargetsTable rows={t.team} month={t.month} daysInMonth={t.daysInMonth} /> : <SkeletonCard />}
        <div className="tl-note">
          At this speed = where the team ends on {t?.daysInMonth ?? 30} {t ? monthName(t.month).slice(0, 3) : ''} if it keeps doing the same amount every day
        </div>
      </Card>

      <Card title="Waiting for you" aside={<ButtonLink to={to('T-Requests')}>All requests ({waitingRows.length})</ButtonLink>}>
        {waiting.error ? (
          <ErrorState error={waiting.error} onRetry={() => void waiting.refetch()} compact />
        ) : (
          <div className="scrollx">
            <table>
              <caption className="sr-only">Requests waiting for you</caption>
              <thead>
                <tr>
                  <th>Who</th>
                  <th>Wants</th>
                  <th>Waiting</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {waitingRows.slice(0, 5).map((r) => (
                  <tr key={r.ref}>
                    <td>
                      <RequestWho request={r} />
                    </td>
                    <td>
                      <RequestWants request={r} />
                    </td>
                    <td>{waitedFor(r.createdAt, now)}</td>
                    <td>
                      <RequestActions request={r} managerName={manager?.name} />
                    </td>
                  </tr>
                ))}
                {waiting.data && waitingRows.length === 0 && (
                  <tr>
                    <td colSpan={4} className="tl-sub">
                      Nothing is waiting for you.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        )}
        <div className="tl-note">Requests you don't answer in 24 hours also go to {manager ? `${firstName(manager.name)} (Manager)` : 'the Manager'}</div>
      </Card>

      <Card title="Needs your attention">
        {attention.length === 0 ? (
          <p className="tl-sub">Nothing needs you right now.</p>
        ) : (
          <div>
            {attention.map((a, i) => (
              <div className="tl-attn" key={i}>
                <span className="tl-sub">{a.label}</span>
                <span className="dot" style={{ background: a.color }} />
                <span>{a.text}</span>
                <Link to={a.link}>{a.linkLabel}</Link>
              </div>
            ))}
          </div>
        )}
      </Card>

      {n2.data && n2.data.rows.length > 0 && (
        <Card title="Paid, no interview after 10+ days" aside={<span className="tl-sub">Book an interview before the refund comes close</span>}>
          <div className="scrollx">
            <table>
              <caption className="sr-only">Paid job seekers with no interview booked 10 or more days after paying</caption>
              <thead>
                <tr>
                  <th>Job seeker</th>
                  <th>Trade</th>
                  <th>Days since paying</th>
                  <th>Guarantee left</th>
                  <th>Agent</th>
                </tr>
              </thead>
              <tbody>
                {n2.data.rows.slice(0, 10).map((row) => (
                  <tr key={row.jobSeekerId}>
                    <td>
                      {row.code} · {row.firstName}
                    </td>
                    <td>{row.trade ?? '—'}</td>
                    <td>{row.daysSincePaid} days</td>
                    <td>{row.daysLeftOnGuarantee} days</td>
                    <td>{row.registeredBy?.name ?? '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}
    </div>
  );
}
