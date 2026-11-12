import { Module } from '@nestjs/common';
import { PrismaModule } from '../../common/prisma/prisma.module';
import { AnonymisationModule } from '../../common/anonymisation/anonymisation.module';
import { CallModule } from '../call/call.module';
import { ConsentModule } from '../consent/consent.module';
import { RetentionService } from './retention.service';
import { RetentionController } from './retention.controller';
import { BUSINESS_PHOTO_STORAGE, MemoryBusinessPhotoStorage, SupabaseBusinessPhotoStorage } from '../business/storefront-photo.storage';

@Module({
  imports: [PrismaModule, AnonymisationModule, CallModule, ConsentModule],
  controllers: [RetentionController],
  providers: [
    RetentionService,
    {
      // Visit photos (name board, proof selfie) live with the business photos.
      provide: BUSINESS_PHOTO_STORAGE,
      useFactory: () => {
        const mode = process.env.BUSINESS_PHOTO_STORAGE_MODE || 'mock';
        if (mode === 'mock') return new MemoryBusinessPhotoStorage();
        if (mode === 'supabase') return new SupabaseBusinessPhotoStorage();
        throw new Error(`Unsupported business photo storage mode: ${mode}`);
      },
    },
  ],
  exports: [RetentionService],
})
export class RetentionModule {}
