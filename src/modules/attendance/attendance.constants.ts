/** Statuses a person picks. The phone system and check-in never use this list. */
export const STAFF_PICKED_STATUSES = [
  'available',
  'team_meeting',
  'training',
  'one_to_one',
  'system_problem',
  'short_break',
  'lunch',
] as const;

/** Set by the phone system. Staff cannot pick these. */
export const PHONE_STATUSES = ['on_call', 'after_call_notes'] as const;

/** Set when a field agent checks in at a business or checks out. */
export const VISIT_STATUSES = ['on_visit', 'travelling'] as const;

export const IDLE_STATUS = 'idle';

/**
 * Attendance start and console layout (Master Guide rev 206, decided 22 Nov):
 * for call agents, field agents, Team Leads and Managers the first sign-in of
 * the IST day opens the attendance day in this status. It is not production
 * and not a break: it counts as unproductive time. The person then picks a
 * status (Active, a meeting, a break…); it cannot be picked again once left.
 * Nobody in Start of day receives calls or new work (only Active does).
 */
export const START_OF_DAY_STATUS = 'start_of_day';

/** The roles whose day opens at sign-in, in Start of day. CEO, Finance and owner accounts are unchanged. */
export const START_OF_DAY_ROLES = ['call_agent', 'field_agent', 'team_lead', 'manager'] as const;

/** Longer than this in Start of day rings the person's Team Lead (the Manager for a Team Lead), once a day. */
export const START_OF_DAY_BELL_MINUTES = 15;

export function startsDayAtSignIn(staff: { role: string; isOwnerAccount?: boolean | null } | null | undefined): boolean {
  return Boolean(staff && !staff.isOwnerAccount && (START_OF_DAY_ROLES as readonly string[]).includes(staff.role));
}

/** After-call notes last this long, then the person is Available again. */
export const AFTER_CALL_NOTES_MS = 2 * 60 * 1000;

/**
 * The screen asks "Still there?" for one minute. The server marks Idle
 * after the idle setting plus that minute.
 */
export const IDLE_PROMPT_MINUTES = 1;

/**
 * Decided 21 Nov: an open, visible console or Laboura Field counts as present
 * (it sends a presence heartbeat about once a minute). With no heartbeat at
 * all for this long — the console closed or hidden, the app in the background
 * — an Available person is marked Idle (after the prompt minute), so incoming
 * calls skip them. "Still there?" itself waits for the idle setting
 * (PricingPolicy.idleAfterMinutes, 30 minutes) with no call and no click.
 */
export const PRESENCE_TIMEOUT_MINUTES = 10;

export const PRODUCTION_STATUSES = [
  'available',
  'on_call',
  'after_call_notes',
  'on_visit',
  'travelling',
  'team_meeting',
  'training',
  'one_to_one',
  'system_problem',
] as const;

export const BREAK_STATUSES = ['short_break', 'lunch'] as const;

export const ATTENDANCE_SETTING_KEYS = [
  'shiftStart',
  'shiftEnd',
  'productionHoursFullDay',
  'halfDayBelowHours',
  'dayToleranceMinutes',
  'lateGraceMinutes',
  'shortBreakMinutes',
  'lunchMinutes',
  'idleAfterMinutes',
  'casualLeavePerMonth',
  'emergencyLeavePerMonth',
  'refundPriorityWindowDays',
  'weeklyOffDays',
] as const;

export function isStaffPickedStatus(status: string): boolean {
  return (STAFF_PICKED_STATUSES as readonly string[]).includes(status);
}

/**
 * A filter on AttendanceDay for "on shift" checks (missed-call hand-out,
 * WhatsApp and lead assignment, app sign-up calls): someone still in Start of
 * day is not available for work (22 Nov: only Active receives calls).
 */
export const NOT_IN_START_OF_DAY = { segments: { none: { status: START_OF_DAY_STATUS, endedAt: null } } } as const;
