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
  timestamp: Date;
}

export interface WhatsAppProvider {
  sendTemplateMessage(
    phone: string,
    templateName: string,
    params: Record<string, string>,
  ): Promise<WhatsAppMessageResult>;
}
