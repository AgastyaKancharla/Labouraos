/**
 * Where a leave or correction request sits right now (Master Guide, Leave
 * routing and the Manager portal's Requests). Worked out from the stored
 * route and the clock, so escalation needs no job: a request the Team Lead
 * has not decided in 24 hours also appears for the Manager while staying with
 * the Team Lead; one the Manager has not decided in 48 hours also appears for
 * the CEO. The first decision closes it for everyone.
 */

export const TEAM_LEAD_ESCALATE_HOURS = 24;
export const MANAGER_ESCALATE_HOURS = 48;
/** A Team Lead approves up to this many planned (casual) days a month per person. */
export const TEAM_LEAD_CASUAL_DAYS_LIMIT = 3;
/** A person's correction number this many in a month goes to the Manager. */
export const CORRECTION_TO_MANAGER_FROM = 3;

export const REASON_TEXT: Record<string, string> = {
  team_lead: 'Sent to the Team Lead',
  team_lead_own: "Team Lead's own request",
  over_limit: 'More than 3 planned days in a month',
  third_correction: 'Third correction this month',
  forwarded: 'Forwarded by the Team Lead',
  team_lead_24h: "The Team Lead hasn't answered in 24 hours",
  manager_48h: "The Manager hasn't answered in 48 hours",
  sent_back: 'Sent back by the Manager',
  manager_own: "Manager's own request",
  finance_own: "Finance's own request",
  no_line: 'No reporting line yet',
};

export interface RoutedRequest {
  status: string;
  routedToRole: string;
  routeReason: string;
  forwardedAt: Date | null;
  createdAt: Date;
  /** A Manager sent it back to the Team Lead: the Team Lead's 24 hours start again from here. */
  sentBackAt?: Date | null;
}

export interface Placement {
  withTeamLead: boolean;
  withManager: boolean;
  withCeo: boolean;
  managerReason: string | null;
  ceoReason: string | null;
  managerSince: Date | null;
}

const HOUR_MS = 3600 * 1000;

export function placementOf(request: RoutedRequest, now: Date): Placement {
  const placement: Placement = {
    withTeamLead: false,
    withManager: false,
    withCeo: false,
    managerReason: null,
    ceoReason: null,
    managerSince: null,
  };
  if (request.status !== 'pending') return placement;
  if (request.routedToRole === 'ceo') {
    placement.withCeo = true;
    placement.ceoReason = request.routeReason;
    return placement;
  }
  if (request.routedToRole === 'team_lead') {
    if (request.forwardedAt) {
      placement.managerSince = request.forwardedAt;
      placement.managerReason = 'forwarded';
    } else {
      placement.withTeamLead = true;
      const since = request.sentBackAt ?? request.createdAt;
      const escalateAt = new Date(since.getTime() + TEAM_LEAD_ESCALATE_HOURS * HOUR_MS);
      if (now.getTime() >= escalateAt.getTime()) {
        placement.managerSince = escalateAt;
        placement.managerReason = 'team_lead_24h';
      }
    }
  }
  if (request.routedToRole === 'manager') {
    placement.managerSince = request.createdAt;
    placement.managerReason = request.routeReason;
  }
  if (placement.managerSince) {
    placement.withManager = true;
    const ceoAt = placement.managerSince.getTime() + MANAGER_ESCALATE_HOURS * HOUR_MS;
    if (now.getTime() >= ceoAt) {
      placement.withCeo = true;
      placement.ceoReason = 'manager_48h';
    }
  }
  return placement;
}

/** One word for where a request is: with_team_lead, with_manager, with_ceo or decided. */
export function whereLabel(placement: Placement, status: string): string {
  if (status !== 'pending') return 'decided';
  if (placement.withTeamLead) return 'with_team_lead';
  if (placement.withManager) return 'with_manager';
  return 'with_ceo';
}
