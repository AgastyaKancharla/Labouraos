import { Injectable, Logger } from '@nestjs/common';
import { WhatsAppMessageResult, WhatsAppProvider } from './whatsapp.interface';

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
    this.logger.log(
      `[MOCK WHATSAPP] Sent template '${templateName}' to ${phone} with params ${JSON.stringify(params)} (ID: ${messageId})`,
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
