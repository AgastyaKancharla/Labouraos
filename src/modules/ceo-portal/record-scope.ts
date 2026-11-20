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
 * Who owns what, for the "My team" / "Not assigned" sections (rev 194/196),
 * loaded once per request (record-section-scope.ts loadOwnership).
 *  - staffIds: the owners that count as "My team" (the Team Lead and his
 *    agents, or a Manager's whole tree);
 *  - cities: the stored city spellings that match the viewer's cities
 *    (compared trimmed and case-insensitive);
 *  - app sign-ups (customer app) have no registering agent: the agent the
 *    sign-up is given to (SignupTracker.assignedStaffId) owns them. teamApp*
 *    are those given to staffIds, assignedApp* those given to anyone.
 */
export interface Ownership {
  staffIds: string[];
  cities: string[];
  teamAppSeekerIds: string[];
  teamAppReferralIds: string[];
  assignedAppSeekerIds: string[];
  assignedAppReferralIds: string[];
}

/** Optional NULL-safe "not one of these": NULL counts as not one of them. */
function nullOrNotIn<K extends string>(key: K, ids: string[]): Record<string, unknown> {
  return { OR: [{ [key]: null }, { [key]: { notIn: ids } }] };
}

function personOwnedByTeam(staffIds: string[], appIds: string[]) {
  return { OR: [{ registeredByStaffId: { in: staffIds } }, { assignedStaffId: { in: staffIds } }, ...(appIds.length ? [{ id: { in: appIds } }] : [])] };
}

/** NULL-safe complement of personOwnedByTeam (no SQL NOT over nullable columns). */
function personNotOwnedByTeam(staffIds: string[], appIds: string[]) {
  return { AND: [nullOrNotIn('registeredByStaffId', staffIds), nullOrNotIn('assignedStaffId', staffIds), ...(appIds.length ? [{ id: { notIn: appIds } }] : [])] };
}

/** NULL-safe complement of businessesOwnedBy: owned by someone else, or by nobody. */
function businessNotOwnedBy(staffIds: string[]): Prisma.BusinessWhereInput {
  return {
    OR: [
      { accountAgentId: { not: null, notIn: staffIds } },
      { accountAgentId: null, OR: [{ leadCreatedByStaffId: null }, { leadCreatedByStaffId: { notIn: staffIds } }] },
    ],
  };
}

/**
 * "My team" (Team Lead rev 194, Manager rev 196): records owned by these staff
 * (the Team Lead and his agents, or a Manager's tree), by the same owner rules —
 * an app sign-up given to one of them included — and no unowned records (those
 * are the "Not assigned" section).
 */
export function teamWheres(o: Ownership): RecordWheres {
  const seeker = personOwnedByTeam(o.staffIds, o.teamAppSeekerIds) as Prisma.JobSeekerWhereInput;
  const business = businessesOwnedBy(o.staffIds);
  return {
    seeker,
    referral: personOwnedByTeam(o.staffIds, o.teamAppReferralIds) as Prisma.ReferralWhereInput,
    business,
    vacancy: { OR: [{ capturedByStaffId: { in: o.staffIds } }, { business }] },
    interview: { OR: [{ business }, { jobSeeker: seeker }] },
    placement: { OR: [{ business }, { jobSeeker: seeker }] },
  };
}

/**
 * "Not assigned" (Team Lead rev 194, Manager rev 196): records with no owner in
 * the viewer's cities. A job seeker or partner nobody registered, was assigned
 * or was given as an app sign-up; a business with no account agent and no lead
 * creator; a vacancy of such a business that nobody captured; an interview or a
 * placement through its business or its job seeker. What already counts as the
 * team's ("My team") is left out, so a record is in one section. Every filter is
 * written NULL-safe (no SQL NOT over a nullable column).
 */
export function unassignedWheres(o: Ownership): RecordWheres {
  const city = { in: o.cities };
  const seeker = { registeredByStaffId: null, assignedStaffId: null, city, ...(o.assignedAppSeekerIds.length ? { id: { notIn: o.assignedAppSeekerIds } } : {}) } as Prisma.JobSeekerWhereInput;
  const referral = { registeredByStaffId: null, assignedStaffId: null, city, ...(o.assignedAppReferralIds.length ? { id: { notIn: o.assignedAppReferralIds } } : {}) } as Prisma.ReferralWhereInput;
  const business: Prisma.BusinessWhereInput = { ...NO_BUSINESS_OWNER, city };
  const notTeam = { business: businessNotOwnedBy(o.staffIds), jobSeeker: personNotOwnedByTeam(o.staffIds, o.teamAppSeekerIds) as Prisma.JobSeekerWhereInput };
  return {
    seeker,
    referral,
    business,
    // Captured by someone (in this team or another) makes it that person's, so only nobody's here.
    vacancy: { business, capturedByStaffId: null },
    interview: { AND: [{ OR: [{ business }, { jobSeeker: seeker }] }, notTeam] },
    placement: { AND: [{ OR: [{ business }, { jobSeeker: seeker }] }, notTeam] },
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
