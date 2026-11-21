import { Module } from '@nestjs/common';
import { PrismaModule } from '../../common/prisma/prisma.module';
import { AuditModule } from '../../common/audit/audit.module';
import { WhatsAppModule } from '../../common/whatsapp/whatsapp.module';
import { MessageModule } from '../message/message.module';
import { NotificationModule } from '../notification/notification.module';
import { ReportingScopeModule } from '../staff/reporting-scope.module';
import { ConsentModule } from '../consent/consent.module';
import { WhatsAppInboxClock } from './whatsapp-inbox.clock';
import { WhatsAppInboxService } from './whatsapp-inbox.service';
import { WhatsAppEventsService } from './whatsapp-events.service';
import { WhatsAppInboxController } from './whatsapp-inbox.controller';
import { WhatsAppWebhookController } from './whatsapp-webhook.controller';

/**
 * WhatsApp (Master Guide rev 202, 21 Nov): inbound conversations as tracked
 * leads (Cloud API webhook, assignment, the console's WhatsApp tab, Team Lead
 * and Manager bells), automatic event messages with SMS as fallback, and
 * "Send on WhatsApp" for links.
 */
@Module({
  imports: [PrismaModule, AuditModule, WhatsAppModule, MessageModule, NotificationModule, ReportingScopeModule, ConsentModule],
  controllers: [WhatsAppWebhookController, WhatsAppInboxController],
  providers: [WhatsAppInboxClock, WhatsAppInboxService, WhatsAppEventsService],
  exports: [WhatsAppInboxClock, WhatsAppInboxService, WhatsAppEventsService],
})
export class WhatsAppInboxModule {}
