import { CEO_OWNED_FLAG_KINDS } from './review-flag.constants';

export type FlagOwner = 'team_lead' | 'manager' | 'ceo';
const AGENT_ROLES = ['call_agent', 'field_agent'];

/**
 * Who decides a flag now. Money and bypass flags: always the CEO. Otherwise
 * the stored owner (set by "Send to Manager" / "Send to CEO"), else the level
 * above the person it is about: an agent's Team Lead, a Team Lead's Manager,
 * a Manager's or Finance's CEO. A flag about nobody goes to the Managers.
 */
export function effectiveOwner(flag: { kind: string; ownerRole: string | null }, personRole: string | null): FlagOwner {
  if (CEO_OWNED_FLAG_KINDS.includes(flag.kind)) return 'ceo';
  if (flag.ownerRole === 'ceo' || flag.ownerRole === 'manager' || flag.ownerRole === 'team_lead') return flag.ownerRole;
  if (personRole && AGENT_ROLES.includes(personRole)) return 'team_lead';
  if (personRole === 'team_lead' || !personRole) return 'manager';
  return 'ceo';
}

export const OWNER_LEVEL: Record<FlagOwner, number> = { team_lead: 1, manager: 2, ceo: 3 };
export const ACTOR_LEVEL: Record<string, number> = { team_lead: 1, manager: 2, ceo: 3 };
