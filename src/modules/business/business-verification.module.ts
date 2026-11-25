import { Module } from '@nestjs/common';
import { AuditModule } from '../../common/audit/audit.module';
import { OtpModule } from '../../common/otp/otp.module';
import { PrismaModule } from '../../common/prisma/prisma.module';
import { ReviewFlagModule } from '../review-flag/review-flag.module';
import { BusinessClock } from './business-clock';
import { BusinessVerificationService } from './business-verification.service';
import { CustomerNotificationModule } from '../customer-notification/customer-notification.module';
import { BusinessAutoCheckService } from './business-auto-check.service';
import { BusinessOwnerPhotoService } from './business-owner-photo.service';
import { BUSINESS_PHOTO_STORAGE, MemoryBusinessPhotoStorage, SupabaseBusinessPhotoStorage } from './storefront-photo.storage';

@Module({
  imports: [PrismaModule, AuditModule, OtpModule, ReviewFlagModule, CustomerNotificationModule],
  providers: [
    BusinessClock,
    BusinessVerificationService,
    // 25 Nov (rev 211): the automatic check (B3) and the owner's photos (B1).
    BusinessAutoCheckService,
    BusinessOwnerPhotoService,
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
  exports: [BusinessClock, BusinessVerificationService, BusinessAutoCheckService, BusinessOwnerPhotoService],
})
export class BusinessVerificationModule {}
