import { Module } from '@nestjs/common';
import { PrismaModule } from '../../common/prisma/prisma.module';
import { WhatsAppModule } from '../../common/whatsapp/whatsapp.module';
import { MessageController } from './message.controller';
import { MessagingService } from './messaging.service';
import { MockSmsProvider, RealSmsProvider, SMS_PROVIDER } from './sms.provider';

@Module({
  imports: [PrismaModule, WhatsAppModule],
  controllers: [MessageController],
  providers: [
    MessagingService,
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
