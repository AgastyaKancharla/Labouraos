import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../../../auth/AuthProvider';
import { ButtonLink } from '../../../components/Button';
import { Card } from '../../../components/Card';
import { ErrorState } from '../../../components/ErrorState';
import { StatGrid, StatTile } from '../../../components/StatTile';
import { StatusPill } from '../../../components/Badge';
import { HomeNotifications } from '../../../components/HomeNotifications';
import { TopBar } from '../../../components/TopBar';
import { useT } from '../../../i18n/I18nProvider';
import { istPartOfDay } from '../../../lib/format/date';
import { periodFor, type Period } from '../../../lib/period';
import { useNow } from '../../../lib/useNow';
import { useScreenPath } from '../../../portals/PortalContext';
import { hm } from '../../ceo/_kit/format';
import { PlanTable, Verdict, monthLong, monthShort, roleTeam, teamShort } from '../_kit/kit';
import { headlineGap, headlineTitle, planSourceText, useOverview } from '../_kit/overview';
import { WaitingCard } from './WaitingCard';
import { useWaiting } from '../_kit/requests';

/**
 * Manager Command Center — design MG-Home.dc.html, on GET /manager/overview.
 * The numbers that make Laboura money, in counts not rupees (guide, "Manager
 * home — Key numbers"): plan vs actual, conversion, teams, attendance today
 * and a watch list. The bell (top bar) holds the Manager's notifications.
 */
export default function ManagerHome() {
  const t = useT();
  const to = useScreenPath();
  const now = useNow();
  const { session } = useAuth();
  const [period, setPeriod] = useState<Period>(() => periodFor('month', now));
  const ov = useOverview(period);
  const waiting = useWaiting();
  const o = ov.data;
  const firstName = session?.staff.name.split(/\s+/)[0] ?? '';
  const teams = o?.teams.length ? o.teams.map(teamShort).join(' and ') : null;
  const mShort = o ? monthShort(o.month.month) : '';

  return (
    <div className="lb-page">
      <TopBar
        eyebrow={<span style={{ color: 'var(--royal)' }}>Manager{teams ? ` · Teams ${teams}` : ''}</span>}
        title={t(`greeting.${istPartOfDay(now)}`, { name: firstName })}
        subtitle="Your teams today, and whether this month's targets will be reached."
        period={period}
        onPeriodChange={setPeriod}
        actions={
          <>
            <ButtonLink to={to('MG-Reports')}>Weekly report</ButtonLink>
            <ButtonLink to={to('MG-Requests')} variant="primary">
              {`Requests${waiting.data ? ` (${waiting.data.length})` : ''}`}
            </ButtonLink>
          </>
        }
      />
      <HomeNotifications />
      {ov.error ? (
        <ErrorState error={ov.error} onRetry={() => void ov.refetch()} />
      ) : (
        <>
          <section className="panel mg-headline" aria-live="polite">
            <div className="eyebrow">{o ? `${monthLong(o.month.month)} · day ${o.month.dayOfMonth} of ${o.month.daysInMonth} · ${o.month.daysLeft} days left` : '…'}</div>
            <h2>{o ? headlineTitle(o) : <span className="lb-skeleton" style={{ height: 22, width: 320, display: 'inline-block' }} aria-hidden="true" />}</h2>
            <p>{o ? headlineGap(o) : ''}</p>
            {o && o.headline.withTarget > 0 && (
              <div className="mg-pills">
                <StatusPill tone="good">{`${o.headline.reached} will be reached`}</StatusPill>
                <StatusPill tone="danger">{`${o.headline.short} will fall short`}</StatusPill>
              </div>
            )}
          </section>

          <PlanTable title="These bring in money" rows={o?.bringMoney} monthShort={mShort} daysLeft={o?.month.daysLeft ?? 0} loading={ov.isPending} />
          <PlanTable
            title="These lead to money"
            rows={o?.leadToMoney}
            monthShort={mShort}
            daysLeft={o?.month.daysLeft ?? 0}
            loading={ov.isPending}
            footnote={`At this speed = where we end on the last day of the month if we keep doing the same amount every day. ${planSourceText(o)}`}
          />

          <Card title="How well we turn one step into the next">
            <div className="scrollx">
              <table>
                <thead>
                  <tr>
                    <th>What</th>
                    <th>Now</th>
                  </tr>
                </thead>
                <tbody>
                  {o?.rates.map((r) => (
                    <tr key={r.key}>
                      <td style={{ whiteSpace: 'normal' }}>{r.label}</td>
                      <td>
                        <b>{r.now ?? '—'}</b>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="mg-note">For the period picked above · fixing the weakest step brings more placements without needing more registrations</div>
          </Card>

          <WaitingCard />

          <Card title="Teams · people placed" aside={<ButtonLink to={to('MG-Teams')}>Teams</ButtonLink>}>
            <div className="scrollx">
              <table>
                <thead>
                  <tr>
                    <th>Team</th>
                    <th>Placed</th>
                    <th>At this speed</th>
                    <th>Will they make it?</th>
                  </tr>
                </thead>
                <tbody>
                  {o?.byTeam.map((team) => {
                    const placed = team.rows.find((r) => r.metric === 'placed');
                    return (
                      <tr key={team.teamLeadId}>
                        <td className="mg-what">
                          <b>
                            <Link to={to('MG-TL', { id: team.teamLeadId })}>{teamShort(team.team)}</Link>
                          </b>
                          <span>
                            {team.teamLead} · {team.atWork} of {team.people} at work
                          </span>
                        </td>
                        <td>{placed ? `${placed.done}${placed.target !== null ? ` of ${placed.target}` : ''}` : '—'}</td>
                        <td>{placed ? `${placed.atThisSpeed}${placed.target !== null ? ` of ${placed.target}` : ''}` : '—'}</td>
                        <td>{placed && <Verdict f={placed} />}</td>
                      </tr>
                    );
                  })}
                  {o && !o.byTeam.length && (
                    <tr>
                      <td colSpan={4}>No Team Leads report to you yet. The CEO gives you teams.</td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </Card>

          <div className="two-col">
            <Card title="Attendance today">
              <StatGrid>
                <StatTile label="At work now" value={o ? `${o.attendanceToday.atWork} / ${o.attendanceToday.people}` : '—'} tone="good" loading={ov.isPending} to={to('MG-Attendance-Live')} />
                <StatTile label="Late logins today" value={o?.attendanceToday.lateLogins ?? '—'} tone="gold" loading={ov.isPending} />
                <StatTile label="On leave" value={o?.attendanceToday.onLeave ?? '—'} tone="cyan" loading={ov.isPending} to={to('MG-Leave')} />
                <StatTile label="Missing · no leave" value={o?.attendanceToday.missing ?? '—'} tone="red" loading={ov.isPending} />
                <StatTile label="Work time lost today" value={o ? hm(o.attendanceToday.lostSeconds) : '—'} tone="orange" loading={ov.isPending} />
              </StatGrid>
              <div className="ceo-actions" style={{ marginTop: 12 }}>
                <ButtonLink to={to('MG-Attendance-Live')}>Live board</ButtonLink>
                <ButtonLink to={to('MG-Attendance')}>Today's attendance</ButtonLink>
              </div>
            </Card>
            <Card title="Watch list">
              <div className="mg-watch">
                {o?.watch.agentsBehind.map((a) => (
                  <div key={a.staff.id}>
                    <span className="ceo-sub">Agents</span>
                    <span className="dot" style={{ background: 'var(--tomato)', width: 8, height: 8, borderRadius: '50%', marginTop: 5 }} />
                    <span>
                      {a.staff.name} ({roleTeam(a.staff.role, a.team, a.staff.isIntern)}) — {a.done} of {a.target} {a.staff.role === 'field_agent' ? 'placed' : 'paid'} · behind pace
                    </span>
                    <Link to={to('MG-Agent', { id: a.staff.id })}>Open</Link>
                  </div>
                ))}
                {o && o.watch.openFlags > 0 && (
                  <div>
                    <span className="ceo-sub">Quality</span>
                    <span className="dot" style={{ background: 'var(--orange-raw)', width: 8, height: 8, borderRadius: '50%', marginTop: 5 }} />
                    <span>
                      {o.watch.openFlags} open flag{o.watch.openFlags === 1 ? '' : 's'} about your teams
                    </span>
                    <Link to={to('MG-Flags')}>Open</Link>
                  </div>
                )}
                {o && !o.watch.agentsBehind.length && !o.watch.openFlags && <p className="ceo-sub">Nothing to watch right now — nobody is behind pace and there are no open flags.</p>}
              </div>
            </Card>
          </div>
        </>
      )}
    </div>
  );
}
