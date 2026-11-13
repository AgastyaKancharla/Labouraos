import { Module } from '@nestjs/common';
import { PrismaModule } from '../../common/prisma/prisma.module';
import { SupabaseCandidatePhotoStorage, sharedCandidatePhotoStorage } from '../job-seeker/photo-storage';
import { STAFF_PHOTO_STORAGE, StaffPhotoService } from './staff-photo.service';

/** Staff photos: stored like job seeker selfies (private bucket, signed links), used by every staff list. */
@Module({
  imports: [PrismaModule],
  providers: [
    StaffPhotoService,
    {
      provide: STAFF_PHOTO_STORAGE,
      useFactory: () => (process.env.CANDIDATE_PHOTO_STORAGE_MODE === 'supabase' ? new SupabaseCandidatePhotoStorage() : sharedCandidatePhotoStorage),
    },
  ],
  exports: [StaffPhotoService],
})
export class StaffPhotoModule {}
