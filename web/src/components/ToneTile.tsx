import type { NavIconName } from '../portals/navIcons';
import { NavIcon } from './Icon';

/**
 * The Command Center's coloured icon tile (`.tile.t-<tone>` in design.css):
 * a drawn icon on one of the brand colours. Decorative only — the text next
 * to it carries the meaning — so it is hidden from screen readers.
 *
 * Screens mix the tones (royal, navy, cyan, gold, orange, red, good) so a
 * page reads like the Command Center rather than one blue.
 */
export type TileTone = 'royal' | 'navy' | 'cyan' | 'gold' | 'orange' | 'red' | 'good';

export function ToneTile({ icon, tone = 'royal', size = 'md', className }: { icon: NavIconName; tone?: TileTone; size?: 'sm' | 'md'; className?: string }) {
  const classes = ['tile', `t-${tone}`, size === 'sm' ? 'lb-tile--sm' : '', className ?? ''].filter(Boolean).join(' ');
  return (
    <span className={classes} aria-hidden="true" data-tone={tone}>
      <NavIcon name={icon} size={size === 'sm' ? 15 : 17} />
    </span>
  );
}

/** A friendly emoji picture next to a heading or an empty state. Never the only meaning. */
export function Emoji({ children, className }: { children: string; className?: string }) {
  return (
    <span className={className ? `lb-emoji ${className}` : 'lb-emoji'} aria-hidden="true">
      {children}
    </span>
  );
}
