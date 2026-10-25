import { Inject, Injectable } from '@nestjs/common';
import {
  WHATSAPP_PROVIDER,
  WhatsAppMessageResult,
  WhatsAppProvider,
} from './whatsapp.interface';
import { AuditService } from '../audit/audit.service';

@Injectable()
export class WhatsAppService {
  constructor(
    @Inject(WHATSAPP_PROVIDER)
    private readonly provider: WhatsAppProvider,
    private readonly auditService: AuditService,
  ) {}

  async sendTemplateMessage(
    phone: string,
    templateName: string,
    params: Record<string, string>,
    actorId?: string,
  ): Promise<WhatsAppMessageResult> {
    const result = await this.provider.sendTemplateMessage(
      phone,
      templateName,
      params,
    );

    // Audit log send attempt (audit log requirements per Task 3)
    if (actorId) {
      await this.auditService.log({
        actorId,
        action: 'whatsapp.send_attempt',
        entityType: 'whatsapp_message',
        entityCode: result.messageId || `fail_${Date.now()}`,
        after: {
          phone,
          templateName,
          status: result.status,
          error: result.error ?? null,
          timestamp: result.timestamp,
        },
        city: 'Bengaluru',
      });
    }

    return result;
  }
}
