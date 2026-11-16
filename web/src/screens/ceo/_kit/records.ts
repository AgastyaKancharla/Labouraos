import { usePortal, useScreenPath } from '../../../portals/PortalContext';

/**
 * The CEO's pipeline lists and profiles (job seekers, businesses, vacancies,
 * interviews, placements, referral partners) are also the Manager's: the
 * Manager portal registers the same screens, and they read the Manager's own
 * endpoints (/manager/...), which keep to the Manager's reporting tree and
 * leave every rupee out (src/modules/screens-manager/manager-records.service.ts).
 *
 * `api` is the endpoint prefix; `ceo` is false for the Manager (no money, no
 * CEO-only actions); `link(id, params)` is a link to another screen of the
 * same portal, or null when that portal has no such screen.
 */
export function useRecordsPortal() {
  const portal = usePortal();
  const to = useScreenPath();
  const ceo = portal.key !== 'manager';
  const has = (screenId: string) => portal.screens.some((s) => s.id === screenId);
  const link = (screenId: string, params?: Record<string, string>): string | null => (has(screenId) ? to(screenId, params) : null);
  return { api: ceo ? '/ceo' : '/manager', ceo, has, link, to };
}

/** The back link of a list: the CEO's Command Center, or the Manager's home. */
export function homeBack(link: (screenId: string) => string | null): { to: string; label: string } | undefined {
  const main = link('Main');
  if (main) return { to: main, label: 'Command Center' };
  const home = link('MG-Home');
  return home ? { to: home, label: 'Home' } : undefined;
}
