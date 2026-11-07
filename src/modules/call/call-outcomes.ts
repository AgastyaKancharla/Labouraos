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
] as const;

export const AGENT_OUTCOMES = [
  'interested',
  'accepted_offer',
  'rejected_offer',
  'callback_requested',
  'not_interested',
  'working_now',
  'other',
] as const;

export type AgentOutcome = (typeof AGENT_OUTCOMES)[number];

export function isCallPurpose(value: string): boolean {
  return (CALL_PURPOSES as readonly string[]).includes(value);
}

export function isAgentOutcome(value: string): value is AgentOutcome {
  return (AGENT_OUTCOMES as readonly string[]).includes(value);
}
