import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';

/**
 * The `.stat` tile used across the portal screens: a short coloured bar, a
 * big number and a label. `tone` colours the bar (and the number for
 * warning tones) exactly like the designs.
 */
export type StatTone = 'royal' | 'good' | 'gold' | 'orange' | 'red' | 'cyan' | 'navy';

const TONE: Record<StatTone, { bar: string; value?: string; border?: string }> = {
  royal: { bar: 'var(--royal)' },
  navy: { bar: 'var(--navy)' },
  cyan: { bar: 'var(--cyan-raw)' },
  good: { bar: 'var(--good)', value: 'var(--good)', border: 'rgba(28,154,108,0.40)' },
  gold: { bar: 'var(--gold-raw)', value: 'var(--amber)', border: 'rgba(252,206,0,0.70)' },
  orange: { bar: 'var(--orange-raw)', value: 'var(--critical)', border: 'rgba(251,104,0,0.45)' },
  red: { bar: 'var(--red-raw)', value: 'var(--tomato)', border: 'rgba(254,41,1,0.40)' },
};

export interface StatTileProps {
  label: ReactNode;
  value: ReactNode;
  tone?: StatTone;
  /** Extra line under the label ("team avg 21"). */
  detail?: ReactNode;
  /** Makes the whole tile a link to the list behind the number. */
  to?: string;
  loading?: boolean;
}

export function StatTile({ label, value, tone = 'royal', detail, to, loading }: StatTileProps) {
  const t = TONE[tone];
  const body = (
    <>
      <span className="bar-top" style={{ background: t.bar }} />
      {loading ? (
        <span className="lb-skeleton" style={{ height: 26, width: '60%' }} aria-hidden="true" />
      ) : (
        <b style={t.value ? { color: t.value } : undefined}>{value}</b>
      )}
      <span className="lb-stat__label">{label}</span>
      {detail && <span className="lb-stat__detail">{detail}</span>}
    </>
  );
  const style = t.border ? { borderColor: t.border } : undefined;
  if (to) {
    return (
      <Link to={to} className="stat lb-stat lb-stat--link" style={style} aria-busy={loading || undefined}>
        {body}
      </Link>
    );
  }
  return (
    <div className="stat lb-stat" style={style} aria-busy={loading || undefined}>
      {body}
    </div>
  );
}

/** Responsive grid for a row of StatTiles (auto-fit, 150 px minimum like the designs). */
export function StatGrid({ children }: { children: ReactNode }) {
  return <div className="lb-stat-grid">{children}</div>;
}
