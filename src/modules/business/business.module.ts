import { Module } from '@nestjs/common';
import { PrismaModule } from '../../common/prisma/prisma.module';
import { IdModule } from '../../common/id/id.module';
import { AuditModule } from '../../common/audit/audit.module';
import { OtpModule } from '../../common/otp/otp.module';
import { VacancyModule } from '../vacancy/vacancy.module';
import { ReviewFlagModule } from '../review-flag/review-flag.module';
import { BusinessController } from './business.controller';
import { BusinessService } from './business.service';
import { GST_LOOKUP_PROVIDER, MockGstLookupProvider } from './gst-lookup.provider';
import {
  BUSINESS_PHOTO_STORAGE,
  MemoryBusinessPhotoStorage,
  SupabaseBusinessPhotoStorage,
} from './storefront-photo.storage';
import { PricingModule } from '../pricing/pricing.module';
import { TradeModule } from '../trade/trade.module';
import { ConsentModule } from '../consent/consent.module';
import { BusinessVerificationModule } from './business-verification.module';

@Module({
  imports: [
    PrismaModule,
    IdModule,
    AuditModule,
    OtpModule,
    VacancyModule,
    ReviewFlagModule,
    PricingModule,
    TradeModule,
    ConsentModule,
    BusinessVerificationModule,
  ],
  controllers: [BusinessController],
  providers: [
    BusinessService,
    { provide: GST_LOOKUP_PROVIDER, useClass: MockGstLookupProvider },
    {
      provide: BUSINESS_PHOTO_STORAGE,
      useFactory: () => {
        const mode = process.env.BUSINESS_PHOTO_STORAGE_MODE || 'mock';
        if (mode === 'mock') return new MemoryBusinessPhotoStorage();
        if (mode === 'supabase') return new SupabaseBusinessPhotoStorage();
        throw new Error(`Unsupported business photo storage mode: ${mode}`);
      },
    },
  ],
  exports: [BusinessService],
})
export class BusinessModule {}
