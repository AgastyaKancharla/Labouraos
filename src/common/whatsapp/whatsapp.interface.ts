export const WHATSAPP_PROVIDER = 'WHATSAPP_PROVIDER';

export interface SendTemplateMessageParams {
  phone: string;
  templateName: string;
  params: Record<string, string>;
}

export interface WhatsAppMessageResult {
  messageId: string;
  status: 'sent' | 'failed';
  phone: string;
  templateName: string;
  error?: string;
  /** Meta's error code when it refused the message (131026: the number cannot get WhatsApp). */
  errorCode?: string;
  timestamp: Date;
}

export interface WhatsAppProvider {
  sendTemplateMessage(
    phone: string,
    templateName: string,
    params: Record<string, string>,
  ): Promise<WhatsAppMessageResult>;
  /**
   * A free-form text reply (21 Nov, inbound WhatsApp). WhatsApp allows it only
   * inside the 24-hour window after the person's last message; after that a
   * template is needed. Optional so test doubles that only send templates still
   * fit; a provider without it cannot reply in free text.
   */
  sendTextMessage?(phone: string, text: string): Promise<WhatsAppMessageResult>;
}

/** templateName recorded for a free-form text reply. */
export const FREE_TEXT_TEMPLATE = 'free_text';
