/**
 * The one requests model for everything a Team Lead, a Manager or the CEO
 * decides (Master Guide: "The Team Lead portal", "The Manager portal",
 * Requests; designs T-Requests, T-Decided, MG-Requests, MG-Decided).
 *
 * Leave and corrections, devices and replacement claims keep their own
 * tables; StaffRequest holds the kinds that had none. All of them are read
 * through RequestsService as one shape (RequestView).
 */
import { REASON_TEXT as ATTENDANCE_REASON_TEXT } from '../attendance/request-routing';

export const STAFF_REQUEST_KINDS = ['hit_removal', 'target_change', 'day_change', 'written_warning'] as const;
export type StaffRequestKind = (typeof STAFF_REQUEST_KINDS)[number];

export const REQUEST_KINDS = ['leave', 'correction', 'device', 'claim', ...STAFF_REQUEST_KINDS] as const;
export type RequestKind = (typeof REQUEST_KINDS)[number];

/** The plain name of each kind, as the designs write it. */
export const KIND_TITLE: Record<RequestKind, string> = {
  leave: 'Leave',
  correction: 'Attendance correction',
  device: 'New device',
  claim: 'Replacement claim',
  hit_removal: 'Remove a hit',
  target_change: 'Target change',
  day_change: 'Change a day',
  written_warning: 'Written warning',
};

/** A hit removal number this many on one job seeker goes to the Manager (guide, 9 Nov). */
export const HIT_REMOVAL_TO_MANAGER_FROM = 3;
/** A person's day change number this many in a month goes to the Manager (T-Attendance). */
export const DAY_CHANGE_TO_MANAGER_FROM = 3;
/** A replacement claim is decided within 48 hours; after 24 the Manager can decide it too. */
export const CLAIM_MANAGER_AFTER_HOURS = 24;

/** Target metrics a Team Lead may ask the Manager to change (whole numbers only). */
export const TARGET_METRICS = [
  'candidatesActivated',
  'vacanciesCaptured',
  'placementsClosed',
  'replacementsInside15Days',
  'repeatBusinesses',
] as const;
export type TargetMetric = (typeof TARGET_METRICS)[number];

export const TARGET_METRIC_LABEL: Record<TargetMetric, string> = {
  candidatesActivated: 'Paid the ₹499 fee',
  vacanciesCaptured: 'Vacancies added',
  placementsClosed: 'People placed',
  replacementsInside15Days: 'Replacements in 15 days',
  repeatBusinesses: 'Repeat businesses',
};

/** Why a request is with someone, in plain words (shared with leave and corrections). */
export const REASON_TEXT: Record<string, string> = {
  ...ATTENDANCE_REASON_TEXT,
  third_hit: '3rd hit removal on this job seeker — needs a Manager',
  third_day_change: '3rd day change this month — needs a Manager',
  target_change: 'Only a Manager changes targets',
  written_warning: 'A Team Lead asks; the Manager decides on a written warning',
  device_agent: "Agents' devices are approved by their Team Lead",
  device_team_lead: "A Team Lead's device — only a Manager approves",
  device_ceo: "A Manager's or Finance's device — only the CEO approves",
  device_24h: "The Team Lead hasn't approved it in 24 hours",
  claim: 'Decide within 48 hours',
  claim_24h: "The Team Lead hasn't decided in 24 hours",
  claim_48h: 'Past the 48-hour limit',
  claim_no_team: 'The business has no account agent in a team',
};

export { CEO_OWNED_FLAG_KINDS } from '../review-flag/review-flag.constants';
