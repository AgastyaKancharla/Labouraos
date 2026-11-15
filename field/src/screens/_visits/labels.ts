import type { MessageKey } from '@/i18n';
import { colors } from '@/theme';

/** i18n keys for the shared visit words. */
export function statusKey(status: string): MessageKey {
  switch (status) {
    case 'onboarded':
      return 'shop.onboarded';
    case 'revisit_due':
      return 'shop.revisit_due';
    case 'interested':
      return 'shop.interested';
    case 'not_interested':
      return 'shop.not_interested';
    default:
      return 'shop.lead';
  }
}

export function outcomeKey(outcome: string | null): MessageKey {
  switch (outcome) {
    case 'onboarded':
      return 'outcome.onboarded';
    case 'interested_later':
      return 'outcome.interested_later';
    case 'not_interested':
      return 'outcome.not_interested';
    case 'owner_not_there':
      return 'outcome.owner_not_there';
    default:
      return 'outcome.none';
  }
}

export function verificationKey(status: string | null, paused: boolean): MessageKey {
  if (paused) return 'vstatus.paused';
  switch (status) {
    case 'verified':
      return 'vstatus.verified';
    case 'pending_visit':
      return 'vstatus.pending_visit';
    case 'pending_tl_check':
      return 'vstatus.pending_tl_check';
    case 'rejected':
      return 'vstatus.rejected';
    default:
      return 'vstatus.lead';
  }
}

export const STATUS_COLORS: Record<string, string> = {
  onboarded: colors.green,
  revisit_due: colors.gold,
  interested: colors.cyanRaw,
  not_interested: colors.redRaw,
  lead: colors.orangeRaw,
};
