import { Global, Module } from '@nestjs/common';
import { OTP_PROVIDER } from './otp.interface';
import { MockOtpProvider } from './mock-otp.provider';
import { RealOtpProvider } from './real-otp.provider';
import { OtpService } from './otp.service';
import { OtpController } from './otp.controller';
import { AuditModule } from '../audit/audit.module';
import { PrismaModule } from '../prisma/prisma.module';
import { PrismaService } from '../prisma/prisma.service';
import { WHATSAPP_PROVIDER, WhatsAppProvider } from '../whatsapp/whatsapp.interface';
import { WhatsAppFirstOtpProvider } from './whatsapp-first-otp.provider';

/** WhatsApp is live (WHATSAPP_PROVIDER_MODE other than mock): codes go on WhatsApp first (rev 211). */
export function whatsappIsLive(env: NodeJS.ProcessEnv = process.env): boolean {
  const raw = env.WHATSAPP_PROVIDER_MODE?.trim().toLowerCase();
  return Boolean(raw) && raw !== 'undefined' && raw !== 'mock';
}

@Global()
@Module({
  imports: [AuditModule, PrismaModule],
  controllers: [OtpController],
  providers: [
    {
      provide: OTP_PROVIDER,
      inject: [PrismaService, { token: WHATSAPP_PROVIDER, optional: true }],
      useFactory: (prisma: PrismaService, whatsapp?: WhatsAppProvider) => {
        const rawProvider = process.env.OTP_PROVIDER_MODE;
        const providerName =
          rawProvider && rawProvider !== 'undefined' ? rawProvider : 'mock';
        let sms;
        if (providerName === 'mock') {
          sms = new MockOtpProvider();
        } else if (
          providerName === 'real' ||
          providerName === 'msg91' ||
          providerName === 'dlt'
        ) {
          const provider = new RealOtpProvider();
          provider.setPrismaService(prisma);
          sms = provider;
        } else {
          throw new Error(`Unsupported OTP provider: ${providerName}`);
        }
        // Rev 211: with a live WhatsApp, codes go on WhatsApp first and the SMS sender is the backup.
        return whatsappIsLive() && whatsapp ? new WhatsAppFirstOtpProvider(sms, whatsapp, prisma) : sms;
      },
    },
    OtpService,
  ],
  exports: [OTP_PROVIDER, OtpService],
})
export class OtpModule {}
