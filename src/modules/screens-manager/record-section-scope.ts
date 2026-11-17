import { BadRequestException } from '@nestjs/common';
import { RecordWheres, teamWheres, unassignedWheres } from '../ceo-portal/record-scope';

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
  cities: string[];
  assignees: string[];
  team: RecordWheres;
  unassigned: RecordWheres;
}

export function sectionScope(viewer: Viewer, staffIds: string[], cities: string[], assignees: string[]): SectionScope {
  return { viewer, staffIds, cities, assignees, team: teamWheres(staffIds), unassigned: unassignedWheres(staffIds, cities) };
}

