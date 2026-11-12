import './manager.css';
import '../../ceo/_kit/ceo.css';
import type { ReactNode } from 'react';
import { ButtonLink } from '../../../components/Button';
import { Card } from '../../../components/Card';
import { StatusPill, type StatusTone } from '../../../components/Badge';
import { TopBar } from '../../../components/TopBar';
import { useScreenPath } from '../../../portals/PortalContext';

/**
 * Shared pieces of the Manager portal screens (MG-* designs). The Manager
 * sees counts, rates, targets and trends — never a rupee figure (guide,
 * reconfirmed 11 Nov) — so nothing here formats money.
 */

export interface Forecast {
  target: number | null;
  done: number;
  stillToDo: number | null;
  needPerDay: number | null;
  doingPerDay: number;
  atThisSpeed: number;
  extra: number | null;
  verdict: 'yes' | 'short' | 'no_target';
}

export interface PlanRow extends Forecast {
  metric: string;
  label: string;
  hint: string;
  lowerIsBetter: boolean;
}

/** "Yes · 13 extra", "Short by 8", "Yes · under the limit". */
export function verdictText(f: Pick<Forecast, 'verdict' | 'extra'>, lowerIsBetter = false): string {
  if (f.verdict === 'no_target') return 'No target set';
  if (lowerIsBetter) return f.verdict === 'yes' ? 'Yes · under the limit' : `Over the limit by ${Math.abs(f.extra ?? 0)}`;
  if (f.verdict === 'short') return `Short by ${Math.abs(f.extra ?? 0)}`;
  if (!f.extra) return 'Yes · right on target';
  return `Yes · ${f.extra} extra`;
}

export function Verdict({ f, lowerIsBetter = false }: { f: Pick<Forecast, 'verdict' | 'extra'>; lowerIsBetter?: boolean }) {
  const tone: StatusTone = f.verdict === 'no_target' ? 'muted' : f.verdict === 'yes' ? 'good' : 'danger';
  return <StatusPill tone={tone}>{verdictText(f, lowerIsBetter)}</StatusPill>;
}

export function SpeedBar({ f, lowerIsBetter = false }: { f: Forecast; lowerIsBetter?: boolean }) {
  const max = Math.max(1, f.target ?? f.atThisSpeed);
  const width = Math.min(100, Math.round((f.atThisSpeed * 100) / max));
  const tone = f.verdict === 'no_target' ? '' : f.verdict === 'yes' ? 'good' : 'short';
  return (
    <div className="mg-speed">
      <span className="mg-speed-num">{f.atThisSpeed}</span>
      {f.target !== null && <span className="mg-speed-of">{lowerIsBetter ? `limit ${f.target}` : `of ${f.target}`}</span>}
      <div className="track" aria-hidden="true">
        <div className={`fill ${tone}`} style={{ width: `${width}%` }} />
      </div>
    </div>
  );
}

/** The plan tables on Home and Plan vs actual ("These bring in money", "These lead to money"). */
export function PlanTable({ title, rows, monthShort, daysLeft, footnote, loading }: { title: string; rows: PlanRow[] | undefined; monthShort: string; daysLeft: number; footnote?: ReactNode; loading?: boolean }) {
  return (
    <Card title={title}>
      <div className="panel lb-card--flush" style={{ boxShadow: 'none' }}>
        <div className="scrollx">
          <table>
            <caption className="sr-only">{title}</caption>
            <thead>
              <tr>
                <th>What</th>
                <th>{monthShort} target</th>
                <th>Done</th>
                <th className="hide-phone">Still to do</th>
                <th className="hide-phone">Per day</th>
                <th>At this speed by month end</th>
                <th>Will we make it?</th>
              </tr>
            </thead>
            <tbody>
              {loading && (
                <tr>
                  <td colSpan={7}>
                    <span className="lb-skeleton" style={{ height: 18, width: '40%', display: 'block' }} aria-hidden="true" />
                  </td>
                </tr>
              )}
              {rows?.map((r) => (
                <tr key={r.metric}>
                  <td className="mg-what">
                    <b>{r.label}</b>
                    <span>{r.hint}</span>
                  </td>
                  <td>{r.target === null ? '—' : r.lowerIsBetter ? `${r.target} or fewer` : r.target}</td>
                  <td>
                    <b>{r.done}</b>
                  </td>
                  <td className="hide-phone">{r.stillToDo ?? '—'}</td>
                  <td className="mg-need hide-phone">
                    {r.needPerDay !== null ? (
                      <>
                        <b>Need {r.needPerDay}</b>
                        <span>
                          doing {r.doingPerDay} · {daysLeft} days left
                        </span>
                      </>
                    ) : (
                      <span>doing {r.doingPerDay} a day</span>
                    )}
                  </td>
                  <td>
                    <SpeedBar f={r} lowerIsBetter={r.lowerIsBetter} />
                  </td>
                  <td>
                    <Verdict f={r} lowerIsBetter={r.lowerIsBetter} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {footnote && <div className="mg-note">{footnote}</div>}
      </div>
    </Card>
  );
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const MONTHS_LONG = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
export function monthShort(month: number): string {
  return MONTHS[month - 1] ?? '';
}
export function monthLong(month: number): string {
  return MONTHS_LONG[month - 1] ?? '';
}

/** "Call · South", "Field · North (intern)", "Team Lead · South". */
export function roleTeam(role: string, team: string | null | undefined, isIntern = false): string {
  const r = role === 'call_agent' ? 'Call' : role === 'field_agent' ? 'Field' : role === 'team_lead' ? 'Team Lead' : role === 'manager' ? 'Manager' : role;
  const t = team ? team.replace(/^Team\s+/i, '') : null;
  return `${r}${t ? ` · ${t}` : ''}${isIntern ? ' (intern)' : ''}`;
}

/** The role word on Staff & access: "Field agent (intern)". */
export function roleWord(role: string, isIntern = false): string {
  const r = role === 'call_agent' ? 'Call agent' : role === 'field_agent' ? 'Field agent' : role === 'team_lead' ? 'Team Lead' : role === 'manager' ? 'Manager' : role;
  return isIntern ? `${r} (intern)` : r;
}

export function teamShort(team: string | null | undefined): string {
  return team ? team.replace(/^Team\s+/i, '') : '—';
}

/** 19 → "19 h", null → "—". */
export function hoursText(h: number | null | undefined): string {
  return h === null || h === undefined ? '—' : `${h} h`;
}

export function paceTone(pace: string): StatusTone {
  return pace === 'behind' ? 'danger' : pace === 'on_pace' ? 'good' : 'muted';
}
export function paceText(pace: string): string {
  return pace === 'behind' ? 'Behind' : pace === 'on_pace' ? 'On track' : pace === 'early' ? 'Too early to tell' : 'No target';
}

/**
 * The Requests screens (MG-Requests, MG-Decided, MG-Req-*) come with the shared
 * requests and escalation backend being built on branch
 * `build/team-lead-portal`. Until it merges they show this.
 */
export function ComingNext({ title, subtitle }: { title: string; subtitle: string }) {
  const to = useScreenPath();
  return (
    <div className="lb-page">
      <TopBar back={{ to: to('MG-Home'), label: 'Command Center' }} title={title} subtitle={subtitle} />
      <section className="panel mg-coming" aria-live="polite">
        <StatusPill tone="info">Coming next</StatusPill>
        <h2 className="h2">Requests are being built</h2>
        <p>
          Leave, day changes, corrections, replacement claims and hit removals that wait for a Manager — with why each one is with you — arrive here
          with the shared requests system. Until then, leave requests in your teams are on the Leave page.
        </p>
        <div className="ceo-actions" style={{ justifyContent: 'center' }}>
          <ButtonLink to={to('MG-Leave')} variant="primary">
            Open Leave
          </ButtonLink>
          <ButtonLink to={to('MG-Home')}>Back to Command Center</ButtonLink>
        </div>
      </section>
    </div>
  );
}
