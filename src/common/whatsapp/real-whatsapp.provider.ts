import { Injectable, Logger } from '@nestjs/common';
import { WhatsAppMessageResult, WhatsAppProvider } from './whatsapp.interface';

export const APPROVED_TEMPLATES = [
  'call_attempt_notice',
  'interview_reminder',
  'job_offer_notice',
  'candidate_activation_confirmation',
];

export interface RealWhatsAppProviderOptions {
  apiUrl?: string;
  accessToken?: string;
  phoneNumberId?: string;
  fetchFn?: typeof fetch;
}

@Injectable()
export class RealWhatsAppProvider implements WhatsAppProvider {
  private readonly logger = new Logger(RealWhatsAppProvider.name);
  private readonly apiUrl: string;
  private readonly accessToken: string;
  private readonly phoneNumberId: string;
  private readonly fetchFn: typeof fetch;

  constructor(options?: RealWhatsAppProviderOptions) {
    this.apiUrl =
      options?.apiUrl ??
      process.env.WHATSAPP_API_URL ??
      'https://graph.facebook.com/v21.0';
    this.accessToken =
      options?.accessToken ?? process.env.WHATSAPP_ACCESS_TOKEN ?? 'test-token';
    this.phoneNumberId =
      options?.phoneNumberId ??
      process.env.WHATSAPP_PHONE_NUMBER_ID ??
      '100000000000001';
    this.fetchFn = options?.fetchFn ?? globalThis.fetch;
  }

  async sendTemplateMessage(
    phone: string,
    templateName: string,
    params: Record<string, string>,
  ): Promise<WhatsAppMessageResult> {
    const timestamp = new Date();

    // 1. WhatsApp Business API Policy: Only pre-approved templates allowed
    if (!APPROVED_TEMPLATES.includes(templateName)) {
      this.logger.error(
        `[REAL WHATSAPP] Template '${templateName}' is not an approved template`,
      );
      return {
        messageId: '',
        status: 'failed',
        phone,
        templateName,
        error: `Template '${templateName}' is not approved. Allowed: ${APPROVED_TEMPLATES.join(', ')}`,
        timestamp,
      };
    }

    // 2. Format phone to E.164 (without leading + for Meta API)
    const cleanPhone = phone.replace(/\D/g, '');

    const bodyPayload = {
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      to: cleanPhone,
      type: 'template',
      template: {
        name: templateName,
        language: {
          code: 'en',
        },
        components: [
          {
            type: 'body',
            parameters: Object.entries(params).map(([key, value]) => ({
              type: 'text',
              text: value,
              parameter_name: key,
            })),
          },
        ],
      },
    };

    try {
      const response = await this.fetchFn(
        `${this.apiUrl}/${this.phoneNumberId}/messages`,
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${this.accessToken}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(bodyPayload),
        },
      );

      const data = (await response.json()) as Record<string, unknown>;

      if (!response.ok) {
        const errorMsg =
          (data.error as { message?: string })?.message ||
          `WhatsApp API returned status ${response.status}`;
        this.logger.error(`[REAL WHATSAPP] API send failed: ${errorMsg}`);
        return {
          messageId: '',
          status: 'failed',
          phone,
          templateName,
          error: errorMsg,
          timestamp,
        };
      }

      const messages = (data.messages as Array<{ id: string }>) || [];
      const messageId = messages[0]?.id || `wamid_${Date.now()}`;

      this.logger.log(
        `[REAL WHATSAPP] Message sent successfully via Meta Cloud API. Message ID: ${messageId}`,
      );

      return {
        messageId,
        status: 'sent',
        phone,
        templateName,
        timestamp,
      };
    } catch (err: unknown) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      this.logger.error(`[REAL WHATSAPP] Request failed: ${errorMsg}`);
      return {
        messageId: '',
        status: 'failed',
        phone,
        templateName,
        error: errorMsg,
        timestamp,
      };
    }
  }
}
