import { isApiError } from '@/api/errors';
import type { MessageKey } from '@/i18n';

/**
 * The statuses a field agent can pick himself (fix list A2, 16 Nov; the
 * server refuses anything else with 400). On visit and Travelling are set by
 * the server at check-in / check-out, On call and After-call notes by the
 * phone system: they show as the current status, never as a choice.
 */
// 22 Nov: Active (available), Team meeting, One-to-one, Training, System problem, Short break, Lunch.
// Start of day is set at sign-in and is never picked; visits still set On visit / Travelling.
export const PICKABLE_STATUSES = ['available', 'team_meeting', 'one_to_one', 'training', 'system_problem', 'short_break', 'lunch'] as const;
export type PickableStatus = (typeof PICKABLE_STATUSES)[number];

export function isPickableStatus(status: string | null | undefined): status is PickableStatus {
  return (PICKABLE_STATUSES as readonly string[]).includes(status ?? '');
}

export const STATUS_KEYS: Record<string, MessageKey> = {
  start_of_day: 'status.start_of_day',
  available: 'status.available',
  on_call: 'status.on_call',
  after_call_notes: 'status.after_call_notes',
  on_visit: 'status.on_visit',
  travelling: 'status.travelling',
  team_meeting: 'status.team_meeting',
  training: 'status.training',
  one_to_one: 'status.one_to_one',
  system_problem: 'status.system_problem',
  short_break: 'status.short_break',
  lunch: 'status.lunch',
  idle: 'status.idle',
};

/** Status label in the agent's language; a status the app does not know shows as "Status updated". */
export function statusLabel(status: string, t: (key: MessageKey) => string): string {
  const key = STATUS_KEYS[status];
  return key ? t(key) : t('today.statusOther');
}

/**
 * The sentence shown when an attendance step fails: no signal, or the
 * step's own translated sentence — never the server's English message.
 */
export function attendanceErrorText(error: unknown, fallback: MessageKey, t: (key: MessageKey) => string): string | null {
  if (!error) return null;
  if (isApiError(error) && error.isNetworkError) return t('common.networkError');
  return t(fallback);
}
