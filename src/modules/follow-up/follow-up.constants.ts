export const FOLLOW_UP_KINDS = [
  'not_selected_day_7',
  'not_selected_day_30',
  'not_selected_day_90',
  'placement_check_in_day_7',
  'placement_check_in_day_30',
  'refund_check',
  'exit_call',
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

export const ALLOWED_FOLLOW_UP_CALL_PURPOSES = [
  'follow_up',
  'check_in',
  'refund_check',
  'exit_call',
] as const;
