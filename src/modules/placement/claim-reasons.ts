export const ACCEPT_CLAIM_REASONS = [
  'resigned',
  'absconded_3_days',
  'never_joined',
  'serious_misconduct',
  'repeated_absence',
  'skill_gap_15_days',
  'misrepresentation',
] as const;

export type AcceptClaimReason = (typeof ACCEPT_CLAIM_REASONS)[number];

export const REJECT_CLAIM_REASONS = [
  'business_closed',
  'role_changed',
  'salary_unpaid',
  'unsafe_workplace',
  'fired_without_reason',
  'hired_own_person',
] as const;

export type RejectClaimReason = (typeof REJECT_CLAIM_REASONS)[number];

export const ALL_CLAIM_REASONS = [
  ...ACCEPT_CLAIM_REASONS,
  ...REJECT_CLAIM_REASONS,
] as const;

export type ClaimReason = (typeof ALL_CLAIM_REASONS)[number];

export function isAcceptClaimReason(reason: string): reason is AcceptClaimReason {
  return (ACCEPT_CLAIM_REASONS as readonly string[]).includes(reason);
}

export function isRejectClaimReason(reason: string): reason is RejectClaimReason {
  return (REJECT_CLAIM_REASONS as readonly string[]).includes(reason);
}

export function isValidClaimReason(reason: string): reason is ClaimReason {
  return (ALL_CLAIM_REASONS as readonly string[]).includes(reason);
}
