import type { MessageKey } from '../i18n/en';
import type { NavIconName } from './navIcons';

/** Nav badge colours used by the designs. */
export type BadgeTone = 'tomato' | 'gold' | 'cyan';

/**
 * Where a nav badge's number comes from. Fetchers live in portals/badges.ts;
 * a source without a fetcher shows no badge until a screen agent adds one.
 */
export type BadgeSource =
  | 'login-codes'
  | 'review-flags'
  | 'refunds-due'
  | 'interviews-today'
  | 'callbacks-waiting'
  | 'requests-open'
  | 'calls-to-review'
  | 'registrations-to-check'
  | 'visit-proof-to-check'
  | 'bank-credits-unmatched'
  | 'invoices-unpaid'
  | 'payouts-due'
  | 'expenses-to-approve';

export interface NavItemDef {
  /** Design id of the screen the item opens (a ScreenDef id in the same portal). */
  screen: string;
  label: MessageKey;
  icon: NavIconName;
  badge?: { tone: BadgeTone; source: BadgeSource };
}

export interface NavSectionDef {
  label: MessageKey;
  items: NavItemDef[];
}

export interface SidebarConfig {
  subtitle: MessageKey;
  sections: NavSectionDef[];
}

export interface ScreenDef {
  /** Design file name without .dc.html — also the screen's folder name. */
  id: string;
  /** Route path relative to the portal root ('' = the portal home). */
  path: string;
  title: MessageKey;
  /** Other designs of the same screen in other states. */
  variants?: readonly string[];
}
