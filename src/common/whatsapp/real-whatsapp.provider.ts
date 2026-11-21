import { Injectable, Logger } from '@nestjs/common';
import { FREE_TEXT_TEMPLATE, WhatsAppMessageResult, WhatsAppProvider } from './whatsapp.interface';
import { parseIndianMobile } from '../phone/indian-mobile';
import { NEW_WHATSAPP_TEMPLATE_NAMES, whatsappTemplate } from '../../modules/message/whatsapp-templates';

export const APPROVED_TEMPLATES = [
  'call_attempt_notice',
  'interview_reminder',
  'interview_offer',
  'interview_booked',
  'interview_candidate_for_owner',
  'interview_result_request',
  'candidate_offer_check',
  'joining_confirmed',
  'job_offer_notice',
  'candidate_activation_confirmation',
  // 21 Nov (rev 202): event messages, links sent on WhatsApp and inbound replies
  // (texts in src/modules/message/whatsapp-templates.ts).
  ...NEW_WHATSAPP_TEMPLATE_NAMES,
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
    // An Indian mobile in any spelling goes out as 91 and the 10 digits.
    const indian = parseIndianMobile(phone);
    const cleanPhone = indian ? indian.slice(1) : phone.replace(/\D/g, '');

    // Only the variables the approved template declares, in its order (21 Nov): Meta refuses a
    // wrong parameter count, and nothing else (a raw link token, for one) ever leaves for Meta.
    const declared = whatsappTemplate(templateName)?.variables;
    const sent: Array<[string, string]> = declared
      ? declared.map((key) => [key, String(params?.[key] ?? '')])
      : Object.entries(params ?? {});

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
        // A template without variables sends no body component (Meta refuses an empty parameter list).
        components: sent.length === 0 ? [] : [
          {
            type: 'body',
            parameters: sent.map(([key, value]) => ({
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

  /**
   * A free-form text reply inside the 24-hour window (Cloud API `type: text`).
   * Outside the window Meta refuses it (error 131047); the caller then offers a template.
   */
  async sendTextMessage(phone: string, text: string): Promise<WhatsAppMessageResult> {
    const timestamp = new Date();
    const indian = parseIndianMobile(phone);
    const to = indian ? indian.slice(1) : phone.replace(/\D/g, '');
    try {
      const response = await this.fetchFn(`${this.apiUrl}/${this.phoneNumberId}/messages`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${this.accessToken}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          messaging_product: 'whatsapp',
          recipient_type: 'individual',
          to,
          type: 'text',
          text: { preview_url: false, body: text },
        }),
      });
      const data = (await response.json()) as Record<string, unknown>;
      if (!response.ok) {
        const error = (data.error as { message?: string })?.message || `WhatsApp API returned status ${response.status}`;
        this.logger.error(`[REAL WHATSAPP] Text reply failed: ${error}`);
        return { messageId: '', status: 'failed', phone, templateName: FREE_TEXT_TEMPLATE, error, timestamp };
      }
      const messageId = ((data.messages as Array<{ id: string }>) || [])[0]?.id || `wamid_${Date.now()}`;
      return { messageId, status: 'sent', phone, templateName: FREE_TEXT_TEMPLATE, timestamp };
    } catch (err: unknown) {
      const error = err instanceof Error ? err.message : String(err);
      this.logger.error(`[REAL WHATSAPP] Text reply request failed: ${error}`);
      return { messageId: '', status: 'failed', phone, templateName: FREE_TEXT_TEMPLATE, error, timestamp };
    }
  }
}
