export const FOLLOW_UP_KINDS = [
  'not_selected_day_7',
  'not_selected_day_30',
  'not_selected_day_90',
  'placement_check_in_day_7',
  'placement_check_in_day_30',
  'refund_check',
  'exit_call',
  'repeat_business_day_30',
  'repeat_business_day_61',
] as const;

export type FollowUpKind = (typeof FOLLOW_UP_KINDS)[number];

export const FOLLOW_UP_STATUSES = ['pending', 'done', 'missed'] as const;
export type FollowUpStatus = (typeof FOLLOW_UP_STATUSES)[number];

export const FOLLOW_UP_ANSWERS = [
  'working_at_introduced_business',
  'working_elsewhere',
  'not_working',
  'no_answer',
] as const;

export type FollowUpAnswer = (typeof FOLLOW_UP_ANSWERS)[number];

/**
 * N4 repeat-business reminders (confirmed 11 Nov): tasks for the business's account
 * agent. Day 30 after an employee joins: "is the employee doing well? any other
 * staff needed?". The day after the 60-day guarantee ends (day 61 with the seeded
 * replacementWindowDays): "guarantee complete — next vacancy, and would you refer
 * another business?".
 */
export const REPEAT_BUSINESS_KINDS = ['repeat_business_day_30', 'repeat_business_day_61'] as const;
export type RepeatBusinessKind = (typeof REPEAT_BUSINESS_KINDS)[number];

/** Days after a joining for the first repeat-business call. */
export const REPEAT_BUSINESS_CHECK_IN_DAYS = 30;

/** What the owner said on a repeat-business call. */
export const REPEAT_BUSINESS_ANSWERS = [
  'needs_more_staff',
  'no_staff_needed_now',
  'no_answer',
] as const;
export type RepeatBusinessAnswer = (typeof REPEAT_BUSINESS_ANSWERS)[number];

export function isRepeatBusinessKind(kind: string): kind is RepeatBusinessKind {
  return (REPEAT_BUSINESS_KINDS as readonly string[]).includes(kind);
}

export const ALLOWED_FOLLOW_UP_CALL_PURPOSES = [
  'follow_up',
  'check_in',
  'refund_check',
  'exit_call',
] as const;
