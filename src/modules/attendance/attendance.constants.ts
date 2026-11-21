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
