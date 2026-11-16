import { Prisma } from '@prisma/client';
import { businessesOwnedBy } from '../../common/rbac/own-team';

/**
 * Which pipeline records a Manager's portal shows (MG lists and profiles that
 * reuse the CEO pages). A record belongs to the Manager when the staff member
 * who owns it is in the Manager's reporting tree (the Manager included), by
 * the same owner rules as a Team Lead's own team (src/common/rbac/own-team.ts):
 *   - job seeker and referral partner: the agent who registered them;
 *   - business: its account agent, else the agent who created the lead
 *     (businessesOwnedBy);
 *   - vacancy: the agent who captured it, or its business;
 *   - interview and placement: the business, or the job seeker.
 * A record with no owner (a customer-app sign-up, a lead with no agent)
 * belongs to no team, and "the CEO and Managers handle it" (own-team.ts), so
 * it is included. Records owned by staff outside the tree are not.
 */
export interface RecordScope {
  staffIds: string[];
}

export function seekerScope(scope: RecordScope): Prisma.JobSeekerWhereInput {
  return { OR: [{ registeredByStaffId: { in: scope.staffIds } }, { registeredByStaffId: null }] };
}

export function referralScope(scope: RecordScope): Prisma.ReferralWhereInput {
  return { OR: [{ registeredByStaffId: { in: scope.staffIds } }, { registeredByStaffId: null }] };
}

export function businessScope(scope: RecordScope): Prisma.BusinessWhereInput {
  return { OR: [businessesOwnedBy(scope.staffIds), { accountAgentId: null, leadCreatedByStaffId: null }] };
}

export function vacancyScope(scope: RecordScope): Prisma.VacancyWhereInput {
  return { OR: [{ capturedByStaffId: { in: scope.staffIds } }, { business: businessScope(scope) }] };
}

export function interviewScope(scope: RecordScope): Prisma.InterviewWhereInput {
  return { OR: [{ business: businessScope(scope) }, { jobSeeker: seekerScope(scope) }] };
}

export function placementScope(scope: RecordScope): Prisma.PlacementWhereInput {
  return { OR: [{ business: businessScope(scope) }, { jobSeeker: seekerScope(scope) }] };
}
