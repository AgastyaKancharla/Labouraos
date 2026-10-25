import { Global, Module } from '@nestjs/common';
import { WHATSAPP_PROVIDER } from './whatsapp.interface';
import { MockWhatsAppProvider } from './mock-whatsapp.provider';
import { RealWhatsAppProvider } from './real-whatsapp.provider';
import { WhatsAppService } from './whatsapp.service';
import { AuditModule } from '../audit/audit.module';

@Global()
@Module({
  imports: [AuditModule],
  providers: [
    {
      provide: WHATSAPP_PROVIDER,
      useFactory: () => {
        const rawProvider =
          process.env.WHATSAPP_PROVIDER_MODE || process.env.WHATSAPP_PROVIDER;
        const providerName =
          rawProvider && rawProvider !== 'undefined' ? rawProvider : 'mock';
        if (providerName === 'mock') {
          return new MockWhatsAppProvider();
        }
        if (
          providerName === 'real' ||
          providerName === 'meta' ||
          providerName === 'gupshup'
        ) {
          return new RealWhatsAppProvider();
        }
        throw new Error(`Unsupported WhatsApp provider: ${providerName}`);
      },
    },
    WhatsAppService,
  ],
  exports: [WHATSAPP_PROVIDER, WhatsAppService],
})
export class WhatsAppModule {}
