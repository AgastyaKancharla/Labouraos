import { Injectable, Logger } from '@nestjs/common';
import { FREE_TEXT_TEMPLATE, WhatsAppMessageResult, WhatsAppProvider } from './whatsapp.interface';
import { parseIndianMobile } from '../phone/indian-mobile';
import { metaParameterName, NEW_WHATSAPP_TEMPLATE_NAMES, whatsappTemplate } from '../../modules/message/whatsapp-templates';

/**
 * Every template with an approved text in src/modules/message/whatsapp-templates.ts
 * (rev 211: every message the software sends has one). Nothing else is sent.
 */
export const APPROVED_TEMPLATES: string[] = [...NEW_WHATSAPP_TEMPLATE_NAMES];

/** Meta's error code when a number cannot get WhatsApp messages (not on WhatsApp, or too old a version). */
export const NO_WHATSAPP_ERROR_CODES = ['131026'] as const;

export function isNoWhatsAppError(code: string | number | null | undefined): boolean {
  return code !== null && code !== undefined && (NO_WHATSAPP_ERROR_CODES as readonly string[]).includes(String(code));
}

/**
 * The Cloud API `template` object (rev 211). Utility templates carry named
 * parameters, lowercase with underscores (`first_name`), only those the
 * approved text declares, in its order. An Authentication template (a login or
 * confirmation code) carries the code positionally in the body and again for
 * its copy-code button, as Meta asks.
 */
export function templatePayload(templateName: string, params: Record<string, string>) {
  const def = whatsappTemplate(templateName);
  if (def?.category === 'authentication') {
    const code = String(params?.code ?? '');
    return {
      name: templateName,
      language: { code: 'en' },
      components: [
        { type: 'body', parameters: [{ type: 'text', text: code }] },
        { type: 'button', sub_type: 'url', index: '0', parameters: [{ type: 'text', text: code }] },
      ],
    };
  }
  // Only the variables the approved template declares, in its order (21 Nov): Meta refuses a
  // wrong parameter count, and nothing else (a raw link token, for one) ever leaves for Meta.
  const declared = def?.variables;
  const sent: Array<[string, string]> = declared
    ? declared.map((key) => [key, String(params?.[key] ?? '')])
    : Object.entries(params ?? {});
  return {
    name: templateName,
    language: { code: 'en' },
    // A template without variables sends no body component (Meta refuses an empty parameter list).
    components: sent.length === 0 ? [] : [
      {
        type: 'body',
        parameters: sent.map(([key, value]) => ({
          type: 'text',
          text: value,
          parameter_name: metaParameterName(key),
        })),
      },
    ],
  };
}

export interface RealWhatsAppProviderOptions {
  apiUrl?: string;
  accessToken?: string;
  phoneNumberId?: string;
  /** The WhatsApp Business Account that owns the templates (WHATSAPP_BUSINESS_ACCOUNT_ID). */
  businessAccountId?: string;
  fetchFn?: typeof fetch;
}

/** One template as Meta has it (name, review status, category). */
export interface MetaTemplateStatus {
  name: string;
  status: string;
  category: string | null;
}

@Injectable()
export class RealWhatsAppProvider implements WhatsAppProvider {
  private readonly logger = new Logger(RealWhatsAppProvider.name);
  private readonly apiUrl: string;
  private readonly accessToken: string;
  private readonly phoneNumberId: string;
  private readonly businessAccountId: string;
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
    this.businessAccountId = options?.businessAccountId ?? process.env.WHATSAPP_BUSINESS_ACCOUNT_ID ?? '';
    this.fetchFn = options?.fetchFn ?? globalThis.fetch;
  }

  /**
   * Rev 211 (C9): the templates' review state at Meta, read from the WhatsApp Business Account,
   * so the submission sheet can be checked against what Meta approved. Needs
   * WHATSAPP_BUSINESS_ACCOUNT_ID; never sends anything.
   */
  async templateStatuses(): Promise<MetaTemplateStatus[]> {
    if (!this.businessAccountId) throw new Error('WHATSAPP_BUSINESS_ACCOUNT_ID is not set');
    const rows: MetaTemplateStatus[] = [];
    let url: string | null = `${this.apiUrl}/${encodeURIComponent(this.businessAccountId)}/message_templates?fields=name,status,category&limit=200`;
    for (let page = 0; url && page < 20; page += 1) {
      const response = await this.fetchFn(url, { headers: { Authorization: `Bearer ${this.accessToken}` } });
      const body = (await response.json()) as { data?: Array<{ name?: string; status?: string; category?: string }>; paging?: { next?: string }; error?: { message?: string } };
      if (!response.ok) throw new Error(`Meta template list failed (${response.status}): ${body.error?.message ?? 'unknown error'}`);
      for (const row of body.data ?? []) {
        if (row.name) rows.push({ name: row.name, status: row.status ?? 'UNKNOWN', category: row.category ?? null });
      }
      url = body.paging?.next ?? null;
    }
    return rows;
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

    const bodyPayload = {
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      to: cleanPhone,
      type: 'template',
      template: templatePayload(templateName, params),
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
        const errorCode = (data.error as { code?: number | string } | undefined)?.code;
        this.logger.error(`[REAL WHATSAPP] API send failed: ${errorMsg}`);
        return {
          messageId: '',
          status: 'failed',
          phone,
          templateName,
          error: errorMsg,
          ...(errorCode !== undefined && errorCode !== null ? { errorCode: String(errorCode) } : {}),
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
