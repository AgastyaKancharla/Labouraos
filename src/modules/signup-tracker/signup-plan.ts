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
 * | 3 tries over 3 days, no answer| closed "no response", monthly re-engagement list; Team Lead told for a business |
 *
 * Call tasks only for someone who ticked "Laboura may call me" (C7) and has a
 * record to call (stage B or later). Reminders go to everyone; the
 * notification service applies quiet hours and the daily cap too.
 */
export type PlanAction = 'reminder' | 'call_task' | 'close' | 'wait';

export interface PlanInput {
  profileKind: string;
  stage: string;
  /** When they last moved forward (or started). */
  stoppedAt: Date;
  remindersSent: number;
  /** Days a sign-up help call task was due (each one is a try). */
  callTries: number;
  /** Can an agent call: contact-me tick given, a record exists, account not deleted. */
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

export function planNext(input: PlanInput, s: SignupSettings, cal: WorkCalendar): Plan {
  const reminders = reminderCount(input.profileKind);
  const reminderMinutes = [s.firstReminderMinutes, s.secondReminderMinutes];
  const nextReminder =
    input.remindersSent < reminders ? reminderAt(input.stoppedAt, reminderMinutes[input.remindersSent], s) : null;

  if (!input.callable) {
    // No call possible: reminders only, then the tracker is looked at again daily.
    if (nextReminder) return { action: 'reminder', at: nextReminder };
    return { action: 'wait', at: new Date(input.stoppedAt.getTime() + 24 * 3600_000) };
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

/**
 * Target credit (question 13, confirmed 14 Nov): a sign-up finished without
 * help credits no agent ("Laboura app" channel). An assisted one credits the
 * assigned agent only when the records show that agent's connected call to the
 * person, or that agent's GPS visit, after the task was assigned and before it
 * finished. Nobody can type this in.
 */
export interface CreditInput {
  assignedStaffId: string | null;
  assignedAt: Date | null;
  finishedAt: Date;
  connectedCalls: Array<{ staffId: string | null; at: Date }>;
  gpsVisits: Array<{ staffId: string | null; at: Date }>;
}

export function assistedBy(input: CreditInput): string | null {
  const { assignedStaffId, assignedAt, finishedAt } = input;
  if (!assignedStaffId || !assignedAt) return null;
  const inWindow = (e: { staffId: string | null; at: Date }) =>
    e.staffId === assignedStaffId && e.at.getTime() >= assignedAt.getTime() && e.at.getTime() <= finishedAt.getTime();
  return input.connectedCalls.some(inWindow) || input.gpsVisits.some(inWindow) ? assignedStaffId : null;
}
