import { BadRequestException } from '@nestjs/common';

/**
 * The two send buttons wherever a call agent or field agent sends a link
 * (Master Guide rev 211): "Send on WhatsApp" (`whatsapp`, the default: WhatsApp
 * first with SMS as backup) and the small "Send by SMS" (`sms`). Team Leads,
 * Managers and the CEO get no send buttons, and the sending routes refuse them
 * (they keep their view of where each person is stuck); Finance sends payout
 * details links.
 */
export type LinkChannel = 'whatsapp' | 'sms';

/** The roles that may press a send button for a person's link. */
export const LINK_SENDING_ROLES = ['call_agent', 'field_agent'] as const;

/** The channel a send route was asked for: undefined (WhatsApp first), 'whatsapp' or 'sms'; anything else is 400. */
export function linkChannel(value: unknown): LinkChannel | undefined {
  if (value === undefined || value === null || value === '') return undefined;
  if (value === 'whatsapp' || value === 'sms') return value;
  throw new BadRequestException('channel must be whatsapp or sms');
}
