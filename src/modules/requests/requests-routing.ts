/**
 * Who decides a request, worked out from the reporting line, the guide's
 * limits and the clock. Pure functions so every rule is unit-tested.
 */
import { Placement, placementOf, RoutedRequest } from '../attendance/request-routing';
import {
  CLAIM_MANAGER_AFTER_HOURS,
  DAY_CHANGE_TO_MANAGER_FROM,
  HIT_REMOVAL_TO_MANAGER_FROM,
  StaffRequestKind,
} from './requests.constants';

export interface Brief {
  id: string;
  code: string;
  name: string;
  role: string;
}

export interface Chain {
  teamLead: Brief | null;
  manager: Brief | null;
  ceo: Brief | null;
}

export interface Route {
  routedToRole: 'team_lead' | 'manager' | 'ceo';
  routedToStaffId: string | null;
  routeReason: string;
}

const AGENT_ROLES = ['call_agent', 'field_agent'];
const HOUR_MS = 3600 * 1000;

function toManagerOrCeo(chain: Chain, reason: string, ceoId: string | null): Route {
  return chain.manager
    ? { routedToRole: 'manager', routedToStaffId: chain.manager.id, routeReason: reason }
    : { routedToRole: 'ceo', routedToStaffId: ceoId, routeReason: 'no_line' };
}

/**
 * Where a new StaffRequest goes.
 * - hit_removal: the job seeker's Team Lead; the 3rd removal on one job seeker → the Manager.
 * - day_change: the person's Team Lead; their 3rd change in a month → the Manager;
 *   a Team Lead's own day → the Manager.
 * - target_change and written_warning: only a Manager decides.
 * Nobody with a line above them → the CEO ("No reporting line yet").
 */
export function routeStaffRequest(input: {
  kind: StaffRequestKind;
  personRole: string;
  chain: Chain;
  ceoId: string | null;
  /** How many earlier removals (hit_removal) or day changes this month (day_change). */
  earlier: number;
}): Route {
  const { kind, personRole, chain, ceoId, earlier } = input;
  if (kind === 'target_change') return toManagerOrCeo(chain, 'target_change', ceoId);
  if (kind === 'written_warning') return toManagerOrCeo(chain, 'written_warning', ceoId);
  const overLimit =
    kind === 'hit_removal'
      ? earlier + 1 >= HIT_REMOVAL_TO_MANAGER_FROM
      : earlier + 1 >= DAY_CHANGE_TO_MANAGER_FROM;
  if (overLimit) return toManagerOrCeo(chain, kind === 'hit_removal' ? 'third_hit' : 'third_day_change', ceoId);
  if (personRole === 'team_lead') return toManagerOrCeo(chain, 'team_lead_own', ceoId);
  if (AGENT_ROLES.includes(personRole) && chain.teamLead) {
    return { routedToRole: 'team_lead', routedToStaffId: chain.teamLead.id, routeReason: 'team_lead' };
  }
  if (AGENT_ROLES.includes(personRole)) return toManagerOrCeo(chain, 'no_line', ceoId);
  return { routedToRole: 'ceo', routedToStaffId: ceoId, routeReason: personRole === 'manager' ? 'manager_own' : 'finance_own' };
}

/** Same placement rules as leave (24 h → Manager too, 48 h with the Manager → CEO too). */
export function staffRequestPlacement(request: RoutedRequest, now: Date): Placement {
  return placementOf(request, now);
}

/**
 * A device waiting for approval, as a routed request: an agent's device is
 * with their Team Lead (and the Manager after 24 hours, the CEO after 48 more);
 * a Team Lead's device is with the Manager; a Manager's or Finance's with the CEO.
 */
export function deviceRoute(ownerRole: string, chain: Chain, ceoId: string | null): Route {
  if (ownerRole === 'manager' || ownerRole === 'finance') {
    return { routedToRole: 'ceo', routedToStaffId: ceoId, routeReason: 'device_ceo' };
  }
  if (ownerRole === 'team_lead') {
    return chain.manager
      ? { routedToRole: 'manager', routedToStaffId: chain.manager.id, routeReason: 'device_team_lead' }
      : { routedToRole: 'ceo', routedToStaffId: ceoId, routeReason: 'no_line' };
  }
  if (chain.teamLead) {
    return { routedToRole: 'team_lead', routedToStaffId: chain.teamLead.id, routeReason: 'device_agent' };
  }
  return toManagerOrCeo(chain, 'no_line', ceoId);
}

/**
 * A replacement claim not yet decided: with the account agent's Team Lead for
 * the first 24 hours, then also with the Manager (still inside the 48-hour
 * limit), and past the limit also with the CEO.
 */
export function claimPlacement(input: {
  reportedAt: Date;
  decisionDueAt: Date;
  hasTeamLead: boolean;
  now: Date;
}): Placement & { managerReasonCode: string | null } {
  const { reportedAt, decisionDueAt, hasTeamLead, now } = input;
  const managerAt = new Date(reportedAt.getTime() + CLAIM_MANAGER_AFTER_HOURS * HOUR_MS);
  const placement = {
    withTeamLead: hasTeamLead,
    withManager: !hasTeamLead || now.getTime() >= managerAt.getTime(),
    withCeo: now.getTime() >= decisionDueAt.getTime(),
    managerReason: null as string | null,
    ceoReason: null as string | null,
    managerSince: null as Date | null,
    managerReasonCode: null as string | null,
  };
  if (placement.withManager) {
    placement.managerReason = hasTeamLead ? 'claim_24h' : 'claim_no_team';
    placement.managerReasonCode = placement.managerReason;
    placement.managerSince = hasTeamLead ? managerAt : reportedAt;
  }
  if (placement.withCeo) placement.ceoReason = 'claim_48h';
  return placement;
}

/** The lowest level that can decide right now, or null once decided. */
export function deciderOf(placement: Placement, status: string): 'team_lead' | 'manager' | 'ceo' | null {
  if (status !== 'pending') return null;
  if (placement.withTeamLead) return 'team_lead';
  if (placement.withManager) return 'manager';
  if (placement.withCeo) return 'ceo';
  return null;
}

/**
 * Overturn goes one level up only: a Manager over the person overturns a Team
 * Lead's decision; the CEO overturns a Manager's. Never your own decision.
 */
export function canOverturnLevel(actorRole: string, decidedByRole: string | null): boolean {
  if (actorRole === 'manager') return decidedByRole === 'team_lead';
  if (actorRole === 'ceo') return decidedByRole === 'manager';
  return false;
}

/** Monday 00:00 IST of the week `now` falls in, as a UTC instant. */
export function startOfWeekIst(now: Date): Date {
  const ist = new Date(now.getTime() + 5.5 * HOUR_MS);
  const day = new Date(Date.UTC(ist.getUTCFullYear(), ist.getUTCMonth(), ist.getUTCDate()));
  const weekday = (day.getUTCDay() + 6) % 7;
  return new Date(day.getTime() - weekday * 24 * HOUR_MS - 5.5 * HOUR_MS);
}
