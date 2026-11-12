import type { MessageKey } from '../i18n/en';

/**
 * The attendance statuses (guide, "Attendance (decided 9 Nov)") as the web app
 * shows them: one dropdown in the header, picking a status stops one clock and
 * starts the next. Server names: src/modules/attendance/attendance.constants.ts.
 */
export type AttendanceStatus =
  | 'available'
  | 'on_call'
  | 'after_call_notes'
  | 'on_visit'
  | 'travelling'
  | 'team_meeting'
  | 'training'
  | 'one_to_one'
  | 'system_problem'
  | 'short_break'
  | 'lunch'
  | 'idle';

/** Who is using the menu: the call agent console, or a Team Lead / Manager / Finance header. */
export type AttendanceAudience = 'agent' | 'office';

export type StatusKind = 'production' | 'break' | 'idle';

export interface StatusDef {
  status: AttendanceStatus;
  kind: StatusKind;
  /** Dot colour, from the CA14 designs. */
  dot: string;
  /** Set by the phone system, check-in or the idle detector: shown, never picked by hand. */
  automatic: boolean;
}

const GREEN = '#1C9A6C';
const BLUE = '#0055C0';
const GOLD = '#FCCE00';
const CYAN = '#02D0F8';
const TOMATO = '#BB232B';
const AMBER = '#92670A';
export const NOT_STARTED_DOT = '#8290B8';

export const STATUS_DEFS: Record<AttendanceStatus, StatusDef> = {
  available: { status: 'available', kind: 'production', dot: GREEN, automatic: false },
  on_call: { status: 'on_call', kind: 'production', dot: CYAN, automatic: true },
  after_call_notes: { status: 'after_call_notes', kind: 'production', dot: CYAN, automatic: true },
  on_visit: { status: 'on_visit', kind: 'production', dot: CYAN, automatic: true },
  travelling: { status: 'travelling', kind: 'production', dot: CYAN, automatic: true },
  team_meeting: { status: 'team_meeting', kind: 'production', dot: BLUE, automatic: false },
  training: { status: 'training', kind: 'production', dot: BLUE, automatic: false },
  one_to_one: { status: 'one_to_one', kind: 'production', dot: BLUE, automatic: false },
  system_problem: { status: 'system_problem', kind: 'production', dot: TOMATO, automatic: false },
  short_break: { status: 'short_break', kind: 'break', dot: GOLD, automatic: false },
  lunch: { status: 'lunch', kind: 'break', dot: GOLD, automatic: false },
  idle: { status: 'idle', kind: 'idle', dot: AMBER, automatic: true },
};

export function isKnownStatus(value: unknown): value is AttendanceStatus {
  return typeof value === 'string' && value in STATUS_DEFS;
}

/**
 * The menu, in the guide's order. Call agents also see On call and
 * After-call notes (greyed: the phone system sets them). Team Leads,
 * Managers and Finance have the production statuses of an office person:
 * Available, meetings, training, one-to-ones, System problem, breaks, lunch.
 */
export function menuStatuses(audience: AttendanceAudience): AttendanceStatus[] {
  const picked: AttendanceStatus[] = ['team_meeting', 'training', 'one_to_one', 'system_problem', 'short_break', 'lunch'];
  return audience === 'agent' ? ['available', 'on_call', 'after_call_notes', ...picked] : ['available', ...picked];
}

/** Statuses a person may pick by hand (the server refuses the rest). */
export function pickableStatuses(audience: AttendanceAudience): AttendanceStatus[] {
  return menuStatuses(audience).filter((s) => !STATUS_DEFS[s].automatic);
}

/** The status's name. One-to-one says "with Team Lead" for agents only. */
export function statusLabelKey(status: AttendanceStatus, audience: AttendanceAudience): MessageKey {
  if (status === 'one_to_one' && audience === 'office') return 'att.status.one_to_one_office';
  return `att.status.${status}` as MessageKey;
}

/** Break allowance in seconds for a break status (Settings: short break 15, lunch 30). */
export function breakAllowanceSeconds(status: AttendanceStatus, policy: { shortBreakMinutes: number; lunchMinutes: number }): number | null {
  if (status === 'short_break') return policy.shortBreakMinutes * 60;
  if (status === 'lunch') return policy.lunchMinutes * 60;
  return null;
}
