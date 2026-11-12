import { Injectable, Logger } from '@nestjs/common';
import { WhatsAppMessageResult, WhatsAppProvider } from './whatsapp.interface';

/** `******3210`: the last 4 digits only. */
export function maskForLog(phone: string): string {
  const digits = String(phone ?? '').replace(/\D/g, '');
  return digits.length >= 4 ? `******${digits.slice(-4)}` : '******';
}

@Injectable()
export class MockWhatsAppProvider implements WhatsAppProvider {
  private readonly logger = new Logger(MockWhatsAppProvider.name);
  public readonly sentMessages: WhatsAppMessageResult[] = [];

  async sendTemplateMessage(
    phone: string,
    templateName: string,
    params: Record<string, string>,
  ): Promise<WhatsAppMessageResult> {
    const messageId = `wamid_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;
    // M5: the log never carries the full number or any variable's value:
    // variables hold live link tokens (registration, payment, consent links)
    // that would let anyone with log access open that person's page.
    this.logger.log(
      `[MOCK WHATSAPP] Sent template '${templateName}' to ${maskForLog(phone)} with params [${Object.keys(params ?? {}).join(', ')}] (ID: ${messageId})`,
    );

    const result: WhatsAppMessageResult = {
      messageId,
      status: 'sent',
      phone,
      templateName,
      timestamp: new Date(),
    };

    this.sentMessages.push(result);
    return result;
  }
}
