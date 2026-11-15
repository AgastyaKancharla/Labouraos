import { SignupSettings } from './signup-settings';
import {
  ClockWindow,
  WorkCalendar,
  addWorkingMinutes,
  nextCallableAt,
  nextWorkingMorning,
  reminderAt,
} from './signup-timing';

/**
 * What happens next to an unfinished app sign-up, and when (customer app
 * proposal 4.2, questions 9 and 10, confirmed 14 Nov):
 *
 * | When                          | Job seeker or partner          | Business                       |
 * | 30 minutes after they stop    | reminder (push)                | reminder (push)                |
 * | 4 hours                       | second reminder                | call task                      |
 * | next working morning          | call task (2 working hours if  |                                |
 * |                               | a job seeker stopped at stage E)|                               |
 * | 3 tries over 3 days, no answer| closed "no response", monthly re-engagement list (3 nudges at most); Team Lead told for a business |
 *
 * Call tasks only for someone who ticked "Laboura may call me" (C7) and has a
 * record to call (stage B or later). Push and in-app reminders go to everyone;
 * someone nobody may call is closed when the tries window ends.
 */
export type PlanAction = 'reminder' | 'call_task' | 'close';

export interface PlanInput {
  profileKind: string;
  stage: string;
  /** When they last moved forward (or started). */
  stoppedAt: Date;
  /** Reminder slots already passed at this stop (sent, or due but not sent). */
  remindersDone: number;
  /** Days a sign-up help call task was due (each one is a try). */
  callTries: number;
  /** Can an agent call: contact-me tick given, a record exists, account active. */
  callable: boolean;
  /** Due time of the last call task, if any. */
  lastCallDueAt: Date | null;
  /** The person's own call window (job seekers). */
  personWindow: ClockWindow;
}

export interface Plan {
  action: PlanAction;
  at: Date;
}

/** Reminders before the first call: two for job seekers and partners, one for a business. */
export function reminderCount(profileKind: string): number {
  return profileKind === 'business' ? 1 : 2;
}

export function firstCallAt(input: PlanInput, s: SignupSettings, cal: WorkCalendar): Date {
  if (input.profileKind === 'business') {
    return nextCallableAt(new Date(input.stoppedAt.getTime() + s.businessCallMinutes * 60_000), cal, input.personWindow);
  }
  if (input.profileKind === 'job_seeker' && input.stage === 'E') {
    return addWorkingMinutes(input.stoppedAt, s.paymentStopWorkingMinutes, cal, input.personWindow);
  }
  return nextWorkingMorning(input.stoppedAt, cal, input.personWindow);
}

/**
 * When the confirmed tries window ends for this stop: the working morning after
 * the last of `maxCallTries` tries, one try a working day from the first call.
 * A sign-up nobody may call is closed at the same moment (no endless waiting).
 */
export function triesWindowEnd(input: PlanInput, s: SignupSettings, cal: WorkCalendar): Date {
  let at = firstCallAt(input, s, cal);
  for (let i = 0; i < s.maxCallTries; i += 1) at = nextWorkingMorning(at, cal, input.personWindow);
  return at;
}

export function planNext(input: PlanInput, s: SignupSettings, cal: WorkCalendar): Plan {
  const reminders = reminderCount(input.profileKind);
  const reminderMinutes = [s.firstReminderMinutes, s.secondReminderMinutes];
  const nextReminder =
    input.remindersDone < reminders ? reminderAt(input.stoppedAt, reminderMinutes[input.remindersDone], s) : null;

  if (!input.callable) {
    // Nobody may call: push and in-app reminders only, then closed when the tries window ends.
    if (nextReminder) return { action: 'reminder', at: nextReminder };
    return { action: 'close', at: triesWindowEnd(input, s, cal) };
  }
  if (input.callTries >= s.maxCallTries) {
    return { action: 'close', at: input.lastCallDueAt ? nextWorkingMorning(input.lastCallDueAt, cal, input.personWindow) : input.stoppedAt };
  }
  const callAt =
    input.callTries === 0 || !input.lastCallDueAt
      ? firstCallAt(input, s, cal)
      : nextWorkingMorning(input.lastCallDueAt, cal, input.personWindow);
  if (nextReminder && nextReminder.getTime() < callAt.getTime()) return { action: 'reminder', at: nextReminder };
  return { action: 'call_task', at: callAt };
}

/** An answered call shorter than this does not prove help (question 13; can become a Setting). */
export const ASSISTED_CALL_MIN_SECONDS = 60;

/**
 * Target credit (question 13, confirmed 14 Nov): a sign-up finished without
 * help credits no agent ("Laboura app" channel). An assisted one credits the
 * assigned call agent only when the phone system shows that agent's answered
 * call to the person, lasting at least ASSISTED_CALL_MIN_SECONDS, after the
 * task was assigned and before the payment (or verification). The assignment
 * must come before the payment. Nobody can type this in.
 *
 * GPS visits do not give this credit: the visit is made by a field agent, never
 * by the call agent who holds the sign-up, and no field agent metric counts
 * assisted app sign-ups (the field agent who verifies a business already becomes
 * its account agent, as today).
 */
export interface CreditInput {
  assignedStaffId: string | null;
  assignedAt: Date | null;
  /** When the ₹499 arrived (job seeker) or the business was verified. */
  completedAt: Date | null;
  connectedCalls: Array<{ staffId: string | null; at: Date; durationSec: number | null }>;
}

export function assistedBy(input: CreditInput): string | null {
  const { assignedStaffId, assignedAt, completedAt } = input;
  if (!assignedStaffId || !assignedAt || !completedAt) return null;
  if (assignedAt.getTime() >= completedAt.getTime()) return null;
  const proves = (c: CreditInput['connectedCalls'][number]) =>
    c.staffId === assignedStaffId &&
    (c.durationSec ?? 0) >= ASSISTED_CALL_MIN_SECONDS &&
    c.at.getTime() >= assignedAt.getTime() &&
    c.at.getTime() <= completedAt.getTime();
  return input.connectedCalls.some(proves) ? assignedStaffId : null;
}
