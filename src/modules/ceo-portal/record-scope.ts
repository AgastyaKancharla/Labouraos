import { Prisma } from '@prisma/client';
import { businessesOwnedBy, peopleOwnedBy } from '../../common/rbac/own-team';

/**
 * Which pipeline records a Manager's portal shows (MG lists and profiles that
 * reuse the CEO pages). A record belongs to the Manager when the staff member
 * who owns it is in the Manager's reporting tree (the Manager included), by
 * the same owner rules as a Team Lead's own team (src/common/rbac/own-team.ts):
 *   - job seeker and referral partner: the agent who registered them, or the
 *     agent a Team Lead assigned them to (personOwners, rev 194);
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

/** A job seeker or referral partner nobody registered and nobody was assigned. */
const NO_PERSON_OWNER = { registeredByStaffId: null, assignedStaffId: null };
/** A business with no account agent and no lead creator. */
const NO_BUSINESS_OWNER = { accountAgentId: null, leadCreatedByStaffId: null };

export function seekerScope(scope: RecordScope): Prisma.JobSeekerWhereInput {
  return { OR: [...peopleOwnedBy(scope.staffIds).OR, NO_PERSON_OWNER] };
}

export function referralScope(scope: RecordScope): Prisma.ReferralWhereInput {
  return { OR: [...peopleOwnedBy(scope.staffIds).OR, NO_PERSON_OWNER] };
}

export function businessScope(scope: RecordScope): Prisma.BusinessWhereInput {
  return { OR: [businessesOwnedBy(scope.staffIds), NO_BUSINESS_OWNER] };
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

/** One filter per kind of pipeline record: what a viewer's lists and profiles show. */
export interface RecordWheres {
  seeker: Prisma.JobSeekerWhereInput;
  referral: Prisma.ReferralWhereInput;
  business: Prisma.BusinessWhereInput;
  vacancy: Prisma.VacancyWhereInput;
  interview: Prisma.InterviewWhereInput;
  placement: Prisma.PlacementWhereInput;
}

/** The Manager's filters: the reporting tree plus records with no owner. */
export function scopeWheres(scope: RecordScope): RecordWheres {
  return {
    seeker: seekerScope(scope),
    referral: referralScope(scope),
    business: businessScope(scope),
    vacancy: vacancyScope(scope),
    interview: interviewScope(scope),
    placement: placementScope(scope),
  };
}

/**
 * "My team" (Team Lead rev 194, Manager rev 196): records owned by these staff
 * (the Team Lead and his agents, or a Manager's tree), by the same owner rules —
 * and no unowned records (those are the "Not assigned" section).
 */
export function teamWheres(staffIds: string[]): RecordWheres {
  const seeker: Prisma.JobSeekerWhereInput = peopleOwnedBy(staffIds);
  const business = businessesOwnedBy(staffIds);
  return {
    seeker,
    referral: peopleOwnedBy(staffIds),
    business,
    vacancy: { OR: [{ capturedByStaffId: { in: staffIds } }, { business }] },
    interview: { OR: [{ business }, { jobSeeker: seeker }] },
    placement: { OR: [{ business }, { jobSeeker: seeker }] },
  };
}

/**
 * "Not assigned" (Team Lead rev 194, Manager rev 196): records with no owner
 * in the viewer's cities (the Team Lead's Staff.city; every Staff.city of a
 * Manager's tree), against the record's city. A job seeker or
 * partner nobody registered or was assigned; a business with no account agent
 * and no lead creator; a vacancy through its business; an interview or a
 * placement through its business or its job seeker. Anything that already
 * counts as the team's ("My team") is left out, so a record is in one section.
 */
export function unassignedWheres(staffIds: string[], cities: string[]): RecordWheres {
  const team = teamWheres(staffIds);
  const city = { in: cities };
  const seeker: Prisma.JobSeekerWhereInput = { ...NO_PERSON_OWNER, city };
  const business: Prisma.BusinessWhereInput = { ...NO_BUSINESS_OWNER, city };
  return {
    seeker,
    referral: { ...NO_PERSON_OWNER, city },
    business,
    // Its business has no owner, so only who captured it can make it the team's (a NULL-safe NOT).
    vacancy: { AND: [{ business }, { OR: [{ capturedByStaffId: null }, { capturedByStaffId: { notIn: staffIds } }] }] },
    interview: { AND: [{ OR: [{ business }, { jobSeeker: seeker }] }, { NOT: team.interview }] },
    placement: { AND: [{ OR: [{ business }, { jobSeeker: seeker }] }, { NOT: team.placement }] },
  };
}

/** What a Team Lead or Manager may open: his own records or unowned ones in his cities (others are 404). */
export function eitherWheres(a: RecordWheres, b: RecordWheres): RecordWheres {
  return {
    seeker: { OR: [a.seeker, b.seeker] },
    referral: { OR: [a.referral, b.referral] },
    business: { OR: [a.business, b.business] },
    vacancy: { OR: [a.vacancy, b.vacancy] },
    interview: { OR: [a.interview, b.interview] },
    placement: { OR: [a.placement, b.placement] },
  };
}
