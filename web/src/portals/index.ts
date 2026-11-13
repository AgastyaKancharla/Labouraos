import type { StaffRole } from '../auth/roles';
import type { DesignFamily } from '../components/family';
import type { MessageKey } from '../i18n/en';
import { callAgentScreens, ceoScreens, financeScreens, managerScreens, publicScreens, teamLeadScreens } from './screens';
import { ceoSidebar, financeSidebar, managerSidebar, teamLeadSidebar } from './sidebars';
import type { ScreenDef, SidebarConfig } from './types';

/**
 * The six parts of the app. Each has a URL root at the site root (app.laboura.com/ceo …), the roles that
 * may open it, its screens (portals/screens.ts) and its navigation.
 */
export type PortalKey = 'ceo' | 'manager' | 'team-lead' | 'finance' | 'call-agent' | 'public';

export interface PortalDef {
  key: PortalKey;
  /** Route root, also the browser URL (app.laboura.com + root). Keep the server's WEB_APP_ROOTS in step. */
  root: string;
  family: DesignFamily;
  /** Empty for the public pages (no sign-in). */
  roles: readonly StaffRole[];
  screens: readonly ScreenDef[];
  sidebar?: SidebarConfig;
  /** Header links of the call agent console (CA03-Home design). */
  topNav?: readonly { screen: string; label: MessageKey }[];
}

export const PORTALS: readonly PortalDef[] = [
  { key: 'ceo', root: '/ceo', family: 'portal', roles: ['ceo'], screens: ceoScreens, sidebar: ceoSidebar },
  { key: 'manager', root: '/manager', family: 'portal', roles: ['manager'], screens: managerScreens, sidebar: managerSidebar },
  { key: 'team-lead', root: '/team-lead', family: 'portal', roles: ['team_lead'], screens: teamLeadScreens, sidebar: teamLeadSidebar },
  { key: 'finance', root: '/finance', family: 'portal', roles: ['finance'], screens: financeScreens, sidebar: financeSidebar },
  {
    key: 'call-agent',
    root: '/call-agent',
    family: 'console',
    roles: ['call_agent'],
    screens: callAgentScreens,
    topNav: [
      { screen: 'CA03-Home', label: 'screen.CA03-Home' },
      { screen: 'CA10-FollowUps', label: 'screen.CA10-FollowUps' },
      { screen: 'CA11-Targets', label: 'screen.CA11-Targets' },
      { screen: 'CA14b-AttendanceActive', label: 'screen.CA14b-AttendanceActive' },
    ],
  },
  { key: 'public', root: '/p', family: 'console', roles: [], screens: publicScreens },
];

export function portalByKey(key: PortalKey): PortalDef {
  const portal = PORTALS.find((p) => p.key === key);
  if (!portal) throw new Error(`Unknown portal ${key}`);
  return portal;
}

/** Absolute in-app path of a screen: screenPath(ceo, 'C-Reports') → '/ceo/reports'. */
export function screenPath(portal: PortalDef, screenId: string, params: Record<string, string> = {}): string {
  const screen = portal.screens.find((s) => s.id === screenId);
  if (!screen) throw new Error(`Screen ${screenId} is not in the ${portal.key} portal`);
  const filled = screen.path.replace(/:(\w+)/g, (_, name: string) => {
    const value = params[name];
    if (value === undefined) throw new Error(`screenPath(${screenId}) needs the "${name}" parameter`);
    return encodeURIComponent(value);
  });
  return filled ? `${portal.root}/${filled}` : portal.root;
}
