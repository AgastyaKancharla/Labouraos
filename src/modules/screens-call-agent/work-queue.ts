/**
 * The call agent's work queue: what "My work today" lists and what "Call
 * next" opens. Pure ordering rules, kept apart from the database so they can
 * be tested on their own.
 *
 * Order (Master Guide, "Refund priority and bells for everyone", and Phase 21
 * Task 7): anyone within the refund-priority window (default 15 days before
 * their ₹499 refund could fall due) is listed FIRST, fewest days left first.
 * Then, by kind:
 *   1. callback   — he asked to be called back at this time / he called us
 *   2. refund_check — the check call before a ₹499 refund is released
 *   3. close_to_refund — paid, near day 30, no suitable offer yet
 *   4. offer_reply / interview_today — an offer waiting for his answer, or an
 *      interview today to remind him of
 *   5. follow_up  — day-7/30/90 "not selected" checks, joining check-ins
 *   6. retry      — the calling system's automatic retry after no answer
 *   7. stuck_registration — registration link sent but not finished
 *      signup_help — an unfinished app sign-up (customer app proposal 4.4),
 *      ranked with the stuck registrations; signup_payment — a job seeker
 *      who stopped at the ₹499 payment, ranked just under callbacks
 *   8. win_back   — (N5, when built) refunded/deactivated people a new job suits
 * Ties go to whoever has been waiting longest (earliest due time).
 * One row per person: the most urgent reason wins.
 */
export const WORK_KINDS = [
  'callback',
  'missed_call',
  'refund_check',
  'close_to_refund',
  'offer_reply',
  'interview_today',
  'follow_up',
  'retry',
  'stuck_registration',
  'signup_payment',
  'signup_help',
  'win_back',
] as const;
export type WorkKind = (typeof WORK_KINDS)[number];

/** The design's filter chips: All · Callbacks · Follow-ups · Offers · New leads, plus App sign-ups (customer app). */
export type WorkCategory = 'callbacks' | 'follow_ups' | 'offers' | 'new_leads' | 'priority' | 'app_signups';

export const KIND_RANK: Record<WorkKind, number> = {
  callback: 1,
  missed_call: 1,
  refund_check: 2,
  close_to_refund: 3,
  offer_reply: 4,
  interview_today: 4,
  follow_up: 5,
  retry: 6,
  stuck_registration: 7,
  // Proposal 4.4: stopped at payment sits just under callbacks; other sign-ups with stuck registrations.
  signup_payment: 1.5,
  signup_help: 7,
  win_back: 8,
};

export const KIND_CATEGORY: Record<WorkKind, WorkCategory> = {
  callback: 'callbacks',
  missed_call: 'callbacks',
  retry: 'callbacks',
  refund_check: 'follow_ups',
  follow_up: 'follow_ups',
  offer_reply: 'offers',
  interview_today: 'offers',
  close_to_refund: 'priority',
  stuck_registration: 'new_leads',
  signup_payment: 'app_signups',
  signup_help: 'app_signups',
  win_back: 'new_leads',
};

export interface WorkCall {
  purpose: string;
  relatedType: string | null;
  relatedId: string | null;
}

export interface WorkItem {
  key: string;
  kind: WorkKind;
  category: WorkCategory;
  subjectType: 'job_seeker' | 'business' | 'referral';
  subjectId: string;
  code: string | null;
  name: string;
  maskedPhone: string | null;
  trade: string | null;
  /** When it became due (UTC ISO). */
  dueAt: string;
  /** Inside the refund-priority window. */
  priority: boolean;
  /** Days left on the 30-day guarantee, for paid job seekers. */
  daysLeft: number | null;
  guaranteeDay: number | null;
  guaranteeDays: number | null;
  /** Extra facts for the reason line (business name, follow-up kind, stuck step…). */
  detail: Record<string, string | number | null>;
  /** What "Call" places for this row. */
  call: WorkCall;
  /** Can be called right now; otherwise why not (calling hours, his window, consent). */
  callable: boolean;
  lockedReason: string | null;
}

export function compareWorkItems(a: WorkItem, b: WorkItem): number {
  if (a.priority !== b.priority) return a.priority ? -1 : 1;
  if (a.priority && b.priority && a.daysLeft !== b.daysLeft) {
    return (a.daysLeft ?? Number.MAX_SAFE_INTEGER) - (b.daysLeft ?? Number.MAX_SAFE_INTEGER);
  }
  const rank = KIND_RANK[a.kind] - KIND_RANK[b.kind];
  if (rank !== 0) return rank;
  const due = a.dueAt.localeCompare(b.dueAt);
  if (due !== 0) return due;
  return a.key.localeCompare(b.key);
}

/** Sorts and keeps one row per person (the most urgent). */
export function orderWorkItems(items: WorkItem[]): WorkItem[] {
  const sorted = [...items].sort(compareWorkItems);
  const seen = new Set<string>();
  const out: WorkItem[] = [];
  for (const item of sorted) {
    const person = `${item.subjectType}:${item.subjectId}`;
    if (seen.has(person)) continue;
    seen.add(person);
    out.push(item);
  }
  return out;
}

/** The first row "Call next" may dial now, skipping people the agent set aside this session. */
export function pickNext(ordered: WorkItem[], skip: ReadonlySet<string> = new Set()): WorkItem | null {
  return ordered.find((item) => item.callable && !skip.has(item.subjectId) && !skip.has(item.key)) ?? null;
}

export function countByCategory(items: WorkItem[]): Record<'all' | WorkCategory, number> {
  const counts = { all: items.length, callbacks: 0, follow_ups: 0, offers: 0, new_leads: 0, priority: 0, app_signups: 0 };
  for (const item of items) counts[item.category] += 1;
  return counts;
}
