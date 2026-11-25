import { Module } from '@nestjs/common';
import { APP_INTERCEPTOR } from '@nestjs/core';
import { TestModeLinkInterceptor } from '../../common/test-mode-link';
import { PrismaModule } from '../../common/prisma/prisma.module';
import { WhatsAppModule } from '../../common/whatsapp/whatsapp.module';
import { MessageController } from './message.controller';
import { MessagingService } from './messaging.service';
import { NoWhatsAppService } from './no-whatsapp.service';
import { MockSmsProvider, RealSmsProvider, SMS_PROVIDER } from './sms.provider';

@Module({
  imports: [PrismaModule, WhatsAppModule],
  controllers: [MessageController],
  providers: [
    MessagingService,
    NoWhatsAppService,
    // Test site only: answers carry the link an SMS would have carried (common/test-mode-link.ts).
    { provide: APP_INTERCEPTOR, useClass: TestModeLinkInterceptor },
    {
      provide: SMS_PROVIDER,
      useFactory: () => {
        const mode = process.env.SMS_PROVIDER_MODE || 'mock';
        if (mode === 'mock') {
          return new MockSmsProvider();
        }
        if (mode === 'real') {
          return new RealSmsProvider();
        }
        throw new Error(`Unsupported SMS provider: ${mode}`);
      },
    },
  ],
  exports: [MessagingService, SMS_PROVIDER],
})
export class MessageModule {}
