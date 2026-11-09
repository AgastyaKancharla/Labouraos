import { Module } from '@nestjs/common';
import { PrismaModule } from '../../common/prisma/prisma.module';
import { MessageModule } from '../message/message.module';
import { OtpModule } from '../../common/otp/otp.module';
import { ConsentService } from './consent.service';
import { ConsentClock } from './consent-clock';
import { ConsentLinkService } from './consent-link.service';
import { ConsentController } from './consent.controller';
import { ConsentWithdrawalService } from './consent-withdrawal.service';
import { PricingModule } from '../pricing/pricing.module';
import { AuditModule } from '../../common/audit/audit.module';
import {
  AGREEMENT_DOCUMENT_STORAGE,
  SupabaseAgreementDocumentStorage,
  sharedMemoryAgreementDocumentStorage,
} from './agreement-document.storage';
import { BusinessVerificationModule } from '../business/business-verification.module';

@Module({
  imports: [PrismaModule, MessageModule, OtpModule, PricingModule, AuditModule, BusinessVerificationModule],
  controllers: [ConsentController],
  providers: [
    ConsentService,
    ConsentClock,
    ConsentLinkService,
    ConsentWithdrawalService,
    {
      provide: AGREEMENT_DOCUMENT_STORAGE,
      useFactory: () =>
        process.env.AGREEMENT_STORAGE_MODE === 'supabase'
          ? new SupabaseAgreementDocumentStorage()
          : sharedMemoryAgreementDocumentStorage,
    },
  ],
  exports: [ConsentService, ConsentClock, ConsentLinkService, AGREEMENT_DOCUMENT_STORAGE],
})
export class ConsentModule {}
