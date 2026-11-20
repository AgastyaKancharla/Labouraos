import { BadRequestException } from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.service';
import { Ownership, RecordWheres, teamWheres, unassignedWheres } from '../ceo-portal/record-scope';

/** The two sections of every Team Lead and Manager list (rev 194 / rev 196). */
export type RecordSection = 'team' | 'unassigned';
export type AssignKind = 'job_seeker' | 'referral' | 'business';

export function parseSection(value: unknown): RecordSection {
  if (value === undefined || value === null || value === '' || value === 'team') return 'team';
  if (value === 'unassigned') return 'unassigned';
  throw new BadRequestException('section is team or unassigned');
}

export interface Viewer {
  id: string;
  role: string;
}

/**
 * Who a viewer's sections are about. `staffIds` own "My team" records (the
 * Team Lead and his agents, or a Manager's whole reporting tree); "Not
 * assigned" is records with no owner in `cities` (the Team Lead's Staff.city,
 * or every city of a Manager's tree). `assignees` are the people an
 * assignment may go to (active staff of the team or tree, the viewer
 * included).
 */
export interface SectionScope {
  viewer: Viewer;
  staffIds: string[];
  /** The viewer's cities, normalised (trimmed, lower case). */
  cities: string[];
  assignees: string[];
  ownership: Ownership;
  team: RecordWheres;
  unassigned: RecordWheres;
}

/** Cities compare trimmed and case-insensitive ("Bengaluru", " bengaluru "). */
export function normaliseCity(city: string | null | undefined): string {
  return (city ?? '').trim().toLowerCase();
}

/**
 * Loads who owns what for one request: the stored city spellings that match
 * the viewer's cities, and the app sign-ups (SignupTracker) given to an agent —
 * those of this team or tree, and those of anyone (an app sign-up given to an
 * agent is never "Not assigned").
 */
export async function loadOwnership(prisma: PrismaService, staffIds: string[], cities: string[]): Promise<Ownership> {
  const wanted = new Set(cities.map(normaliseCity));
  const [seekerCities, businessCities, referralCities, trackers] = await Promise.all([
    prisma.jobSeeker.groupBy({ by: ['city'] }),
    prisma.business.groupBy({ by: ['city'] }),
    prisma.referral.groupBy({ by: ['city'] }),
    prisma.signupTracker.findMany({
      where: { subjectType: { in: ['job_seeker', 'referral'] }, subjectId: { not: null }, assignedStaffId: { not: null } },
      select: { subjectType: true, subjectId: true, assignedStaffId: true },
    }),
  ]);
  const spellings = new Set([...cities]);
  for (const row of [...seekerCities, ...businessCities, ...referralCities]) if (wanted.has(normaliseCity(row.city))) spellings.add(row.city);
  const pick = (type: string, team: boolean) => [
    ...new Set(trackers.filter((t) => t.subjectType === type && (!team || staffIds.includes(t.assignedStaffId!))).map((t) => t.subjectId!)),
  ];
  return {
    staffIds,
    cities: [...spellings],
    teamAppSeekerIds: pick('job_seeker', true),
    teamAppReferralIds: pick('referral', true),
    assignedAppSeekerIds: pick('job_seeker', false),
    assignedAppReferralIds: pick('referral', false),
  };
}

export async function sectionScope(prisma: PrismaService, viewer: Viewer, staffIds: string[], cities: string[], assignees: string[]): Promise<SectionScope> {
  const ownership = await loadOwnership(prisma, staffIds, cities);
  return { viewer, staffIds, cities: cities.map(normaliseCity), assignees, ownership, team: teamWheres(ownership), unassigned: unassignedWheres(ownership) };
}
