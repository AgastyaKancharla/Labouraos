import { StatusPill } from '../../../components/Badge';
import type { PaceRow } from './api';
import './tl.css';

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export const monthName = (m: number) => MONTHS[m - 1] ?? '';
export const monthShort = (m: number) => SHORT[m - 1] ?? '';

export function Verdict({ row }: { row: PaceRow }) {
  if (!row.verdict) return <span className="tl-sub">No target set</span>;
  return <StatusPill tone={row.onTrack ? 'good' : 'danger'}>{row.verdict}</StatusPill>;
}

/** "23 of 25" with the bar under it. */
export function Projection({ row }: { row: PaceRow }) {
  const pct = row.target ? Math.min(100, Math.round((row.projection / row.target) * 100)) : 0;
  return (
    <div className="tl-proj">
      <b>{row.projection}</b> {row.target !== null && <span className="tl-sub">of {row.target}</span>}
      {row.target !== null && (
        <div className="track">
          <div className={row.onTrack ? 'fill' : 'fill short'} style={{ width: `${pct}%`, background: row.onTrack ? 'var(--good)' : undefined }} />
        </div>
      )}
    </div>
  );
}

export function PerDay({ row }: { row: PaceRow }) {
  return (
    <div className="tl-need">
      {row.needPerDay !== null ? (
        <>
          Need <b>{row.needPerDay.toFixed(1)}</b>
        </>
      ) : (
        <span className="tl-sub">—</span>
      )}
      <div className="tl-sub">
        doing {row.doingPerDay.toFixed(1)} · {row.daysLeft} days left
      </div>
    </div>
  );
}

/** The team's month in the Manager's plain format (T-Home, T-Targets). */
export function TeamTargetsTable({ rows, month, daysInMonth }: { rows: Array<PaceRow & { key: string; label: string; hint: string }>; month: number; daysInMonth: number }) {
  return (
    <div className="scrollx">
      <table>
        <caption className="sr-only">Team targets</caption>
        <thead>
          <tr>
            <th>What</th>
            <th>{monthShort(month)} target</th>
            <th>Done</th>
            <th>Still to do</th>
            <th>Per day</th>
            <th>
              At this speed by {daysInMonth} {monthShort(month)}
            </th>
            <th>Will we make it?</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.key}>
              <td>
                <div className="tl-strong">{row.label}</div>
                <div className="tl-sub">{row.hint}</div>
              </td>
              <td>{row.target ?? '—'}</td>
              <td>
                <b>{row.done}</b>
              </td>
              <td>{row.stillToDo ?? '—'}</td>
              <td>
                <PerDay row={row} />
              </td>
              <td>
                <Projection row={row} />
              </td>
              <td>
                <Verdict row={row} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** "At today's speed the team reaches 4 of 5 targets" — counts only rows with a target. */
export function heroLine(rows: Array<PaceRow & { label: string }>, furthestBehind: { name: string; done: number; target: number | null; label: string } | null) {
  const withTarget = rows.filter((row) => row.target !== null);
  const reached = withTarget.filter((row) => row.onTrack).length;
  const short = withTarget.filter((row) => !row.onTrack);
  const title = withTarget.length ? `At today's speed the team reaches ${reached} of ${withTarget.length} targets` : 'No team targets set for this month yet';
  const parts: string[] = [];
  if (short.length === 1) parts.push(`Only ${short[0].label.toLowerCase()} will fall short — ${short[0].projection} of ${short[0].target}.`);
  else if (short.length > 1) parts.push(`${short.length} will fall short: ${short.map((row) => row.label.toLowerCase()).join(', ')}.`);
  if (furthestBehind && furthestBehind.target) parts.push(`Furthest behind: ${furthestBehind.name} (${furthestBehind.done} of ${furthestBehind.target} ${furthestBehind.label.toLowerCase()}).`);
  return { title, sub: parts.join(' ') || 'Targets are set by the Manager.', reached, short: short.length };
}
