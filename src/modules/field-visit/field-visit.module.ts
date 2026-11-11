import { Module } from '@nestjs/common';
import { PrismaModule } from '../../common/prisma/prisma.module';
import { AuditModule } from '../../common/audit/audit.module';
import { OtpModule } from '../../common/otp/otp.module';
import { PricingModule } from '../pricing/pricing.module';
import { ReviewFlagModule } from '../review-flag/review-flag.module';
import { AttendanceModule } from '../attendance/attendance.module';
import { BusinessVerificationModule } from '../business/business-verification.module';
import {
  BUSINESS_PHOTO_STORAGE,
  MemoryBusinessPhotoStorage,
  SupabaseBusinessPhotoStorage,
} from '../business/storefront-photo.storage';
import { FieldVisitController } from './field-visit.controller';
import { FieldVisitService } from './field-visit.service';
import { FieldVisitClock } from './field-visit-clock';

@Module({
  imports: [PrismaModule, AuditModule, OtpModule, PricingModule, ReviewFlagModule, AttendanceModule, BusinessVerificationModule],
  controllers: [FieldVisitController],
  providers: [
    FieldVisitService,
    FieldVisitClock,
    {
      // Visit photos live with the business photos (private bucket).
      provide: BUSINESS_PHOTO_STORAGE,
      useFactory: () => {
        const mode = process.env.BUSINESS_PHOTO_STORAGE_MODE || 'mock';
        if (mode === 'mock') return new MemoryBusinessPhotoStorage();
        if (mode === 'supabase') return new SupabaseBusinessPhotoStorage();
        throw new Error(`Unsupported business photo storage mode: ${mode}`);
      },
    },
  ],
  exports: [FieldVisitService, FieldVisitClock],
})
export class FieldVisitModule {}
