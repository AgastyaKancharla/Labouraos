/**
 * The closed list of notification kinds (Phase 21 Task 6). Each kind says
 * what the work is; the notification clears by itself when that work is done.
 */
export const NOTIFICATION_KINDS = [
  // Leave and corrections (Team Lead → Manager → CEO, with 24/48-hour escalation).
  'leave_request',
  'correction_request',
  // The requester's own request was decided (informational).
  'request_decided',
  // Attendance, for the Team Lead.
  'break_overrun',
  'system_problem',
  'agent_idle',
  // Review flags.
  'review_flag',
  'hit_reversed',
  'hit_reversal_needs_manager',
  'in_person_onboarding_review',
  // Staff without a reporting line (CEO, Managers).
  'no_reporting_line',
  // Money (CEO and Finance only — never a Manager).
  'refund_needs_ceo',
  'refund_ready_to_pay',
  'bank_credit_unmatched',
  'payout_failed',
  // Expenses & bills (Phase 22): above Finance's limit → the CEO; within it or approved → Finance pays.
  'expense_needs_ceo',
  'expense_to_pay',
  // Close to a refund (Task 7).
  'refund_priority',
  // Growth tasks for the Team Lead (N2, N3).
  'first_interview_overdue',
  'shortage_task',
  // A Manager's "Remind the agents" on stuck work (Manager portal, Pipeline).
  'stuck_work_reminder',
  'salaries_to_release',
  'salaries_need_ceo',
  'month_not_closed',
  'payslip_ready',
] as const;

export type NotificationKind = (typeof NOTIFICATION_KINDS)[number];

/**
 * Kinds that tell someone something rather than ask them to do something.
 * Reading them is the work: marking one as seen clears it.
 */
export const INFORMATIONAL_KINDS: readonly NotificationKind[] = ['request_decided', 'hit_reversed', 'stuck_work_reminder', 'payslip_ready'];

/** Kinds that carry rupee amounts. They only ever go to the CEO or Finance. */
export const MONEY_KINDS: readonly NotificationKind[] = [
  'refund_needs_ceo',
  'refund_ready_to_pay',
  'bank_credit_unmatched',
  'payout_failed',
  'expense_needs_ceo',
  'expense_to_pay',
  'salaries_to_release',
  'salaries_need_ceo',
];

/** Master Guide: the Team Lead hears about an agent idle for more than 30 minutes. */
export const IDLE_BELL_MINUTES = 30;

/** The bell shows the latest open notifications, at most this many. */
export const BELL_LATEST_LIMIT = 20;

export const STAFF_ROLES = [
  'ceo',
  'manager',
  'team_lead',
  'finance',
  'call_agent',
  'field_agent',
] as const;

/** Web app portal roots (the browser URL is /app + root). Field agents use the Laboura Field app. */
const PORTAL_ROOT: Record<string, string | null> = {
  ceo: '/ceo',
  manager: '/manager',
  team_lead: '/team-lead',
  finance: '/finance',
  call_agent: '/call-agent',
  field_agent: null,
};

type LinkTable = Partial<Record<string, string>>;

/**
 * Where the work behind each kind is done, per recipient role, as a path
 * inside that role's portal. `:id`, `:staffId`, `:kind` are filled from the
 * context; a path with a placeholder left unfilled falls back to the list.
 */
const LINKS: Record<NotificationKind, LinkTable> = {
  leave_request: {
    team_lead: 'requests?kind=leave&id=:id',
    manager: 'requests?kind=leave&id=:id',
    ceo: 'team/leave?kind=leave&id=:id',
  },
  correction_request: {
    team_lead: 'requests?kind=correction&id=:id',
    manager: 'requests?kind=correction&id=:id',
    ceo: 'team/leave?kind=correction&id=:id',
  },
  request_decided: {
    call_agent: 'attendance/history',
    team_lead: 'leave',
    manager: 'leave',
    ceo: 'team/leave',
    finance: '',
  },
  break_overrun: { team_lead: 'attendance/live', manager: 'attendance/live', ceo: 'attendance/live' },
  system_problem: { team_lead: 'attendance/live', manager: 'attendance/live', ceo: 'attendance/live' },
  agent_idle: { team_lead: 'attendance/live', manager: 'attendance/live', ceo: 'attendance/live' },
  review_flag: { team_lead: 'flags', manager: 'flags', ceo: 'flags', finance: 'money-in' },
  hit_reversed: { manager: 'flags', ceo: 'flags' },
  hit_reversal_needs_manager: { manager: 'flags', ceo: 'flags' },
  in_person_onboarding_review: { team_lead: 'verify', manager: 'flags', ceo: 'businesses/:id' },
  no_reporting_line: { ceo: 'team', manager: 'staff' },
  refund_needs_ceo: { ceo: 'refunds' },
  refund_ready_to_pay: { finance: 'refunds/:id', ceo: 'refunds' },
  bank_credit_unmatched: { finance: 'money-in/match?credit=:id', ceo: 'payments' },
  payout_failed: { finance: 'payouts', ceo: 'payments/out' },
  expense_needs_ceo: { ceo: 'expenses' },
  expense_to_pay: { finance: 'expenses?status=to_pay', ceo: 'expenses' },
  refund_priority: {
    call_agent: 'people/:id',
    team_lead: 'work',
    manager: 'pipeline',
    ceo: 'job-seekers/near-refund',
    finance: 'refunds',
  },
  first_interview_overdue: { team_lead: 'work', manager: 'pipeline', ceo: 'job-seekers' },
  shortage_task: { team_lead: 'work', manager: 'pipeline', ceo: 'vacancies' },
  stuck_work_reminder: { call_agent: '', team_lead: 'work', field_agent: '' },
  salaries_to_release: { finance: 'salaries?month=:month' },
  salaries_need_ceo: { ceo: 'team/salaries?month=:month' },
  month_not_closed: { finance: 'review?month=:month', ceo: 'month-end?month=:month' },
  // Payslips: the call agent console has its own page; the other portals have the shared one.
  payslip_ready: { call_agent: 'attendance/payslip', manager: 'payslip', team_lead: 'payslip', finance: 'payslip' },
};

/** The in-app path for one recipient, or null when that role has no screen for it. */
export function notificationLink(
  role: string,
  kind: NotificationKind,
  params: Record<string, string | null | undefined> = {},
): string | null {
  const root = PORTAL_ROOT[role];
  if (!root) return null;
  const template = LINKS[kind]?.[role];
  if (template === undefined) return null;
  let missing = false;
  const filled = template.replace(/:(\w+)/g, (_, name: string) => {
    const value = params[name];
    if (!value) {
      missing = true;
      return '';
    }
    return encodeURIComponent(value);
  });
  if (missing) {
    // Drop the part that needed the missing value: "refunds/:id" → "refunds",
    // "requests?kind=leave&id=:id" → "requests".
    const base = template.split(/[/?]:|\?/)[0].replace(/\/$/, '');
    return base ? `${root}/${base}` : root;
  }
  return filled ? `${root}/${filled}` : root;
}

/** Plain words for a review flag kind, for the bell title. */
const FLAG_TITLES: Record<string, string> = {
  duplicate_business: 'Possible duplicate business',
  visit_short: 'Very short shop visit',
  visits_too_far_apart: 'Two shops too far apart for the time',
  visit_photo_reused: 'Same visit photo used twice',
  visit_gps_suspect: 'Visit GPS looks faked',
  visits_no_onboarding: 'Many visits, no onboarding',
  gps_mismatch: 'Location does not match',
  no_documents_check: 'No-documents business to check',
  in_person_onboarding_review: 'In-person onboarding to review',
  interview_result_mismatch: 'Interview results do not match',
  interview_result_overdue: 'Interview result overdue',
  interview_no_result: 'Interview has no result',
  interview_result_due: 'Interview result due',
  payment_overdue: 'Payment overdue',
  payment_mismatch: 'Payment does not match',
  business_many_rejections: 'Business rejects many candidates',
  agent_rejection_pattern: 'Agent rejection pattern',
  business_stopped_after_interviews: 'Business stopped after interviews',
  bypass_suspected: 'Possible bypass',
  payout_name_mismatch: 'Payout name does not match',
  payout_shared_account: 'Payout account shared',
  payout_matches_staff: 'Payout account matches a staff member',
  odd_hour_login: 'Login at an odd hour',
  screenshot_taken: 'Screenshot taken',
  hit_reversed: 'A hit was reversed',
  hit_reversal_needs_manager: 'Third hit removal needs your decision',
  vacancy_captured_for_account_business: 'Vacancy added to your business',
  claim_decision_overdue: 'Claim decision overdue',
  name_check: 'Name check needed',
  break_overrun: 'Break ran over',
};

export function flagTitle(kind: string): string {
  if (FLAG_TITLES[kind]) return FLAG_TITLES[kind];
  const words = kind.replace(/_/g, ' ');
  return words.charAt(0).toUpperCase() + words.slice(1);
}

/** Review flag kinds about money: they go to the CEO and Finance, never to a Manager. */
export const MONEY_FLAG_KINDS = [
  'payment_overdue',
  'payment_mismatch',
  'payout_name_mismatch',
  'payout_shared_account',
  'payout_matches_staff',
];

/**
 * Flag kinds that have their own notification kind (or none): the generic
 * `review_flag` bell skips them so nobody gets the same thing twice.
 */
export const FLAG_KIND_TO_NOTIFICATION: Record<string, NotificationKind | null> = {
  break_overrun: null, // the attendance bell `break_overrun` covers it
  hit_reversed: 'hit_reversed',
  hit_reversal_needs_manager: 'hit_reversal_needs_manager',
  in_person_onboarding_review: 'in_person_onboarding_review',
};

export const FLAG_NOTIFICATION_KINDS: readonly NotificationKind[] = [
  'review_flag',
  'hit_reversed',
  'hit_reversal_needs_manager',
  'in_person_onboarding_review',
];
