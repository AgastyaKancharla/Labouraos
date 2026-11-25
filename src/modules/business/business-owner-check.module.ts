import { Module } from '@nestjs/common';
import { AuditModule } from '../../common/audit/audit.module';
import { PrismaModule } from '../../common/prisma/prisma.module';
import { AadhaarQrModule } from '../aadhaar-qr/aadhaar-qr.module';
import { BusinessVerificationModule } from './business-verification.module';
import { BusinessOwnerCheckService } from './business-owner-check.service';
import { BUSINESS_PHOTO_STORAGE, MemoryBusinessPhotoStorage, SupabaseBusinessPhotoStorage } from './storefront-photo.storage';

/** 25 Nov (rev 212, B9): the small-business checks (owner's ID, business proof, address proof, video call). */
@Module({
  imports: [PrismaModule, AuditModule, AadhaarQrModule, BusinessVerificationModule],
  providers: [
    BusinessOwnerCheckService,
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
  exports: [BusinessOwnerCheckService],
})
export class BusinessOwnerCheckModule {}
