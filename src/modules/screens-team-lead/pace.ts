/**
 * The Manager's plain month format, used on the Team Lead's home and targets
 * (guide, Manager portal Home): target, done, still to do, needed each day
 * for the days left, doing each day now, where we end at this speed, and
 * "Will we make it?" — "Yes, N extra" or "Short by N".
 */
export interface PaceRow {
  target: number | null;
  done: number;
  stillToDo: number | null;
  needPerDay: number | null;
  doingPerDay: number;
  daysLeft: number;
  /** Where it ends on the last day at today's speed. */
  projection: number;
  /** "Yes · 13 extra", "Yes · right on target", "Short by 2", or null with no target. */
  verdict: string | null;
  onTrack: boolean | null;
}

const round1 = (n: number) => Math.round(n * 10) / 10;

export function paceRow(target: number | null, done: number, dayOfMonth: number, daysInMonth: number): PaceRow {
  const daysGone = Math.max(1, dayOfMonth);
  const daysLeft = Math.max(0, daysInMonth - dayOfMonth);
  const doingPerDay = done / daysGone;
  const projection = Math.round(done + doingPerDay * daysLeft);
  if (target === null) {
    return { target: null, done, stillToDo: null, needPerDay: null, doingPerDay: round1(doingPerDay), daysLeft, projection, verdict: null, onTrack: null };
  }
  const stillToDo = Math.max(0, target - done);
  const needPerDay = daysLeft > 0 ? stillToDo / daysLeft : stillToDo;
  const diff = projection - target;
  const verdict = diff > 0 ? `Yes · ${diff} extra` : diff === 0 ? 'Yes · right on target' : `Short by ${-diff}`;
  return { target, done, stillToDo, needPerDay: round1(needPerDay), doingPerDay: round1(doingPerDay), daysLeft, projection, verdict, onTrack: diff >= 0 };
}
