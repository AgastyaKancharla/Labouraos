import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Button, ButtonLink } from '../../../components/Button';
import { Card } from '../../../components/Card';
import { ErrorState } from '../../../components/ErrorState';
import { StatusPill } from '../../../components/Badge';
import { useToast } from '../../../components/Toast';
import { TopBar } from '../../../components/TopBar';
import { downloadTextFile, toCsv } from '../../../lib/csv';
import { periodFor, type Period } from '../../../lib/period';
import { useNow } from '../../../lib/useNow';
import { useScreenPath } from '../../../portals/PortalContext';
import { PlanTable, Verdict, monthLong, monthShort, teamShort, verdictText } from '../_kit/kit';
import { headlineGap, headlineTitle, planSourceText, useOverview, type Overview } from '../_kit/overview';

/** "8 (10)" — done, then the week's share of the month target in brackets. */
function doneTarget(c: { done: number; target: number | null }): string {
  return c.target === null ? String(c.done) : `${c.done} (${c.target})`;
}

function downloadPlan(o: Overview): number {
  const rows = [...o.bringMoney, ...o.leadToMoney].map((r) => ({ section: o.bringMoney.includes(r) ? 'These bring in money' : 'These lead to money', ...r }));
  downloadTextFile(
    `plan-vs-actual-${o.month.key}.csv`,
    toCsv(rows, [
      { header: 'Section', value: (r) => r.section },
      { header: 'What', value: (r) => r.label },
      { header: `${monthShort(o.month.month)} target`, value: (r) => r.target },
      { header: 'Done', value: (r) => r.done },
      { header: 'Still to do', value: (r) => r.stillToDo },
      { header: 'Need per day', value: (r) => r.needPerDay },
      { header: 'Doing per day', value: (r) => r.doingPerDay },
      { header: 'At this speed by month end', value: (r) => r.atThisSpeed },
      { header: 'Will we make it?', value: (r) => verdictText(r, r.lowerIsBetter) },
    ]),
  );
  return rows.length;
}

/**
 * Plan vs actual — design MG-Plan.dc.html, on GET /manager/overview: the
 * month's targets, done so far and where we end at today's speed, for the
 * whole tree, each team and each week, and where people are lost. Counts
 * only; the plan is the CEO's plan as the Manager split it into teams, or
 * the sum of the agents' monthly targets where it isn't set.
 */
export default function PlanVsActual() {
  const to = useScreenPath();
  const now = useNow();
  const toast = useToast();
  const [period, setPeriod] = useState<Period>(() => periodFor('month', now));
  const ov = useOverview(period);
  const o = ov.data;
  const mShort = o ? monthShort(o.month.month) : '';
  const shortTeams = o ? o.byTeam.flatMap((team) => team.rows.filter((r) => r.verdict === 'short').map((r) => ({ team: team.team, teamLeadId: team.teamLeadId, row: r }))) : [];

  return (
    <div className="lb-page">
      <TopBar
        back={{ to: to('MG-Home'), label: 'Command Center' }}
        title="Plan vs actual"
        subtitle="This month's targets, how far we've got, and where we'll end at today's speed — for the whole team, each team and each week."
        period={period}
        onPeriodChange={setPeriod}
        actions={
          <Button
            disabled={!o}
            onClick={() => {
              if (!o) return;
              toast.success(`Downloaded ${downloadPlan(o)} rows`);
            }}
          >
            Download (Excel)
          </Button>
        }
      />
      {ov.error ? (
        <ErrorState error={ov.error} onRetry={() => void ov.refetch()} />
      ) : (
        <>
          <section className="panel mg-headline" aria-live="polite">
            <div className="eyebrow">{o ? `${monthLong(o.month.month)} · day ${o.month.dayOfMonth} of ${o.month.daysInMonth} · ${o.month.daysLeft} days left` : '…'}</div>
            <h2>{o ? headlineTitle(o) : '…'}</h2>
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

          <Card title="By team">
            <div className="scrollx">
              <table>
                <thead>
                  <tr>
                    <th>Team</th>
                    <th>What</th>
                    <th>Target</th>
                    <th>Done so far</th>
                    <th className="hide-phone">Still to do</th>
                    <th>At this speed by month end</th>
                    <th>Will they make it?</th>
                  </tr>
                </thead>
                <tbody>
                  {o?.byTeam.flatMap((team) =>
                    team.rows.map((r) => (
                      <tr key={`${team.teamLeadId}-${r.metric}`}>
                        <td>
                          <b>{teamShort(team.team)}</b>
                        </td>
                        <td>{r.label}</td>
                        <td>{r.target ?? '—'}</td>
                        <td>
                          <b>{r.done}</b>
                        </td>
                        <td className="hide-phone">{r.stillToDo ?? '—'}</td>
                        <td>{r.atThisSpeed}</td>
                        <td>
                          <Verdict f={r} />
                        </td>
                      </tr>
                    )),
                  )}
                  {o && !o.byTeam.length && (
                    <tr>
                      <td colSpan={7}>No teams yet.</td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
            <div className="mg-note">Team targets are the CEO's plan split by you on the Targets page · a team without a split shows the sum of its agents' targets</div>
          </Card>

          <Card title="By week · done (target)">
            <div className="scrollx">
              <table>
                <thead>
                  <tr>
                    <th>Week</th>
                    <th>Registered</th>
                    <th>Paid the fee</th>
                    <th>Businesses signed up</th>
                    <th>People placed</th>
                  </tr>
                </thead>
                <tbody>
                  {o?.byWeek.map((w) => (
                    <tr key={w.label}>
                      <td>{w.label}</td>
                      <td>{doneTarget(w.registered)}</td>
                      <td>{doneTarget(w.paid)}</td>
                      <td>{doneTarget(w.businessesSignedUp)}</td>
                      <td>{doneTarget(w.placed)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>

          <Card title="Where we lose people" aside={<ButtonLink to={to('MG-Pipeline')}>Stuck work</ButtonLink>}>
            <div className="scrollx">
              <table>
                <thead>
                  <tr>
                    <th>Step</th>
                    <th>Now</th>
                    <th>Why</th>
                  </tr>
                </thead>
                <tbody>
                  {o?.losses.map((l) => (
                    <tr key={l.step}>
                      <td>{l.step}</td>
                      <td>{l.now === null ? '—' : `${l.now} in 100`}</td>
                      <td style={{ whiteSpace: 'normal' }}>{l.why ?? '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="mg-note">For the period picked above · every step we fix gives more placements from the same registrations</div>
          </Card>

          <Card title="What to do about the gap">
            <div className="mg-watch">
              {shortTeams.map((s) => (
                <div key={`${s.teamLeadId}-${s.row.metric}`}>
                  <span className="ceo-sub">{teamShort(s.team)}</span>
                  <span style={{ background: 'var(--tomato)', width: 8, height: 8, borderRadius: '50%', marginTop: 5, display: 'inline-block' }} />
                  <span>
                    {s.row.label}: {s.row.done} of {s.row.target}, at this speed {s.row.atThisSpeed}
                    {s.row.needPerDay !== null ? ` → need ${s.row.needPerDay} a day instead of ${s.row.doingPerDay}` : ''}
                  </span>
                  <Link to={s.row.metric === 'placed' ? to('MG-Pipeline') : to('MG-TL', { id: s.teamLeadId })}>{s.row.metric === 'placed' ? 'Pipeline' : 'Team'}</Link>
                </div>
              ))}
              {o && !shortTeams.length && <p className="ceo-sub">No team is short on a target right now.</p>}
            </div>
          </Card>
        </>
      )}
    </div>
  );
}
