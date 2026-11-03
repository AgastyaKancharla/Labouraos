export const SMS_PROVIDER = 'SMS_PROVIDER';

export interface SmsSendResult {
  messageId: string;
  status: 'sent' | 'failed';
  error?: string;
}

export interface SmsProvider {
  sendTemplate(
    phone: string,
    template: string,
    dltTemplateId: string,
    variables: Record<string, string>,
  ): Promise<SmsSendResult>;
}

/** DLT template ids live in SMS_DLT_TEMPLATE_IDS, a JSON object of template name to id. */
export function dltTemplateId(template: string): string {
  const raw = process.env.SMS_DLT_TEMPLATE_IDS;
  if (!raw) {
    return '';
  }
  try {
    const parsed = JSON.parse(raw) as Record<string, string>;
    return parsed[template] ?? '';
  } catch {
    return '';
  }
}

export class MockSmsProvider implements SmsProvider {
  async sendTemplate(phone: string, template: string): Promise<SmsSendResult> {
    if (!phone || !template) {
      return { messageId: '', status: 'failed', error: 'missing phone or template' };
    }
    return { messageId: `sms_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`, status: 'sent' };
  }
}

/** Real provider stub. It does not call a vendor until SMS_API_URL and SMS_API_KEY are set. */
export class RealSmsProvider implements SmsProvider {
  async sendTemplate(
    phone: string,
    template: string,
    dltTemplateId: string,
    variables: Record<string, string>,
  ): Promise<SmsSendResult> {
    const apiUrl = process.env.SMS_API_URL;
    const apiKey = process.env.SMS_API_KEY;
    if (!apiUrl || !apiKey || !dltTemplateId) {
      return {
        messageId: '',
        status: 'failed',
        error: 'SMS provider is not configured',
      };
    }
    const response = await fetch(apiUrl, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        to: phone,
        template,
        dltTemplateId,
        variables,
      }),
    });
    if (!response.ok) {
      return { messageId: '', status: 'failed', error: `SMS provider status ${response.status}` };
    }
    const data = (await response.json()) as { messageId?: string };
    return { messageId: data.messageId ?? `sms_${Date.now()}`, status: 'sent' };
  }
}
