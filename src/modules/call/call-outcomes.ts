/** Closed list from data-design §1. */
export const CALL_PURPOSES = [
  'offer',
  'follow_up',
  'verification',
  'consent_explain',
  'consent_withdraw',
  'exit_call',
  'check_in',
  'interview_result',
  'refund_check',
  'joining_confirmation',
  'general',
  /** A phone interview: Laboura rings the owner and the candidate and joins them (3-way). */
  'phone_interview',
] as const;

export const AGENT_OUTCOMES = [
  'interested',
  'accepted_offer',
  'rejected_offer',
  'callback_requested',
  'not_interested',
  'working_now',
  'other',
  // 21 Nov fixes (Master Guide rev 202, "Call results").
  'wrong_number',
  'do_not_call',
  'busy',
  'switched_off',
] as const;

/** Count as no answer: the retry rules apply as if nobody picked up (never a hit by themselves). */
export const NO_ANSWER_OUTCOMES: readonly string[] = ['busy', 'switched_off'];
/** Stop every retry and automatic message; do_not_call also blocks calls (contact-block.ts). */
export const STOP_OUTCOMES: readonly string[] = ['wrong_number', 'do_not_call'];

export type AgentOutcome = (typeof AGENT_OUTCOMES)[number];

export function isCallPurpose(value: string): boolean {
  return (CALL_PURPOSES as readonly string[]).includes(value);
}

export function isAgentOutcome(value: string): value is AgentOutcome {
  return (AGENT_OUTCOMES as readonly string[]).includes(value);
}
