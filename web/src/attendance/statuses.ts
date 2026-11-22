import type { MessageKey } from '../i18n/en';

/**
 * The attendance statuses (guide, "Attendance (decided 9 Nov)") as the web app
 * shows them: one dropdown in the header, picking a status stops one clock and
 * starts the next. Server names: src/modules/attendance/attendance.constants.ts.
 */
export type AttendanceStatus =
  | 'start_of_day'
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

/** 'unproductive': Start of day (22 Nov) — not production, not a break. */
export type StatusKind = 'production' | 'break' | 'idle' | 'unproductive';

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
/** Start of day's own colour (22 Nov), apart from breaks (gold) and Idle (amber). */
export const START_OF_DAY_DOT = '#7A4FC4';
export const NOT_STARTED_DOT = '#8290B8';

export const STATUS_DEFS: Record<AttendanceStatus, StatusDef> = {
  // Set at sign-in (22 Nov): shown, never picked by hand.
  start_of_day: { status: 'start_of_day', kind: 'unproductive', dot: START_OF_DAY_DOT, automatic: true },
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
 * The menu, in the guide's order (22 Nov): Active (the name shown for
 * Available), Team meeting, One-to-one, Training, System problem, Short break,
 * Lunch. Call agents also see On call and After-call work (greyed: the phone
 * system sets them). Start of day is shown greyed while the person is in it
 * (the day opens in it at sign-in); it cannot be picked once left.
 */
export function menuStatuses(audience: AttendanceAudience, current: AttendanceStatus | null = null): AttendanceStatus[] {
  const picked: AttendanceStatus[] = ['team_meeting', 'one_to_one', 'training', 'system_problem', 'short_break', 'lunch'];
  const start: AttendanceStatus[] = current === 'start_of_day' ? ['start_of_day'] : [];
  return audience === 'agent' ? [...start, 'available', 'on_call', 'after_call_notes', ...picked] : [...start, 'available', ...picked];
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
