import { useSearchParams } from 'react-router-dom';
import { usePortal, useScreenPath } from '../../../portals/PortalContext';
import { customPeriod, type Period } from '../../../lib/period';

/**
 * The CEO's pipeline lists and profiles (job seekers, businesses, vacancies,
 * interviews, placements, referral partners) are also the Manager's: the
 * Manager portal registers the same screens, and they read the Manager's own
 * endpoints (/manager/...), which keep to the Manager's reporting tree and
 * leave every rupee out (src/modules/screens-manager/manager-records.service.ts).
 *
 * The Team Lead portal reuses them the same way (rev 194, 17 Nov): its own
 * endpoints (/team-lead/...), the Manager's rules (no money, masked phones).
 *
 * `api` is the endpoint prefix; `ceo` is false for the Manager and the Team
 * Lead (no money, no CEO-only actions); `sections` is true where the lists have
 * "My team" / "Not assigned" and the Assign button (Team Lead, Manager);
 * `link(id, params)` is a link to another screen of the same portal, or null
 * when that portal has no such screen.
 */
export function useRecordsPortal() {
  const portal = usePortal();
  const to = useScreenPath();
  const api = portal.key === 'manager' ? '/manager' : portal.key === 'team-lead' ? '/team-lead' : '/ceo';
  const ceo = api === '/ceo';
  const has = (screenId: string) => portal.screens.some((s) => s.id === screenId);
  const link = (screenId: string, params?: Record<string, string>): string | null => (has(screenId) ? to(screenId, params) : null);
  return { api, ceo, sections: !ceo, teamLead: portal.key === 'team-lead', has, link, to };
}

/** The back link of a list: the CEO's Command Center, or the Manager's or Team Lead's home. */
export function homeBack(link: (screenId: string) => string | null): { to: string; label: string } | undefined {
  const main = link('Main');
  if (main) return { to: main, label: 'Command Center' };
  const home = link('MG-Home') ?? link('T-Home');
  return home ? { to: home, label: 'Home' } : undefined;
}

/**
 * A list filter's starting value from the address (`?status=not_paid`), so a
 * number on the Team Lead's home opens the list already filtered. Read once.
 */
export function useInitialParam(name: string, fallback = ''): string {
  const [params] = useSearchParams();
  return params.get(name) ?? fallback;
}

/**
 * A list's starting period from the address (`?from=2026-11-01&to=2026-11-17`,
 * IST days), so a number on the Team Lead's home opens the list for the same
 * period it counted. Null when the address has none.
 */
export function useInitialPeriod(): Period | null {
  const [params] = useSearchParams();
  const from = params.get('from');
  const to = params.get('to');
  const day = /^\d{4}-\d{2}-\d{2}$/;
  return from && to && day.test(from) && day.test(to) ? customPeriod(from, to) : null;
}
