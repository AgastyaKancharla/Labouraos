import type { ReactNode } from 'react';
import { useFamily } from './family';
import type { BadgeTone } from '../portals/types';

/**
 * Status pill. Portal screens render the designs' `.pill.<tone>`; console and
 * phone screens render `.tag.<t?>`. Pick the tone by meaning, not colour:
 *
 *   good    done, paid, verified, on target       (green)
 *   warn    needs attention soon, waiting          (amber)
 *   crit    act now, overdue, money at risk        (orange)
 *   danger  failed, refused, rejected              (red)
 *   info    neutral information, in progress       (cyan)
 *   blue    selected / brand                       (royal blue)
 *   muted   inactive, not applicable               (grey)
 */
export type StatusTone = 'good' | 'warn' | 'crit' | 'danger' | 'info' | 'blue' | 'muted';

const PORTAL: Record<StatusTone, string> = {
  good: 'pill good',
  warn: 'pill warn',
  crit: 'pill crit',
  danger: 'pill danger',
  info: 'pill info',
  blue: 'pill lb-pill-blue',
  muted: 'pill muted',
};
const CONSOLE: Record<StatusTone, string> = {
  good: 'tag tg',
  warn: 'tag ta',
  crit: 'tag tr',
  danger: 'tag tt',
  info: 'tag tc',
  blue: 'tag tb',
  muted: 'tag tn',
};

export function StatusPill({ tone, children, title }: { tone: StatusTone; children: ReactNode; title?: string }) {
  const family = useFamily();
  return (
    <span className={(family === 'portal' ? PORTAL : CONSOLE)[tone]} title={title}>
      {children}
    </span>
  );
}

/** The small count bubble on sidebar items (`.nbadge`). */
export function NavBadge({ tone, count, label }: { tone: BadgeTone; count: number; label?: string }) {
  return (
    <span className={`nbadge lb-nbadge--${tone}`} aria-label={label}>
      {count}
    </span>
  );
}
