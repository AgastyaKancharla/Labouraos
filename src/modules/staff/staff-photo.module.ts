import { Module } from '@nestjs/common';
import { PrismaModule } from '../../common/prisma/prisma.module';
import { SupabaseCandidatePhotoStorage, sharedCandidatePhotoStorage } from '../job-seeker/photo-storage';
import { STAFF_PHOTO_STORAGE, StaffPhotoService } from './staff-photo.service';

/**
 * Staff photos use the job seeker selfie setting and bucket: Supabase Storage
 * when CANDIDATE_PHOTO_STORAGE_MODE is "supabase", memory otherwise (laptops,
 * tests). Production never runs on memory: main.ts and worker.ts refuse to
 * start unless that setting is "supabase" (assertDurableUploadStorage).
 */
export function staffPhotoStorage(env: NodeJS.ProcessEnv = process.env) {
  return env.CANDIDATE_PHOTO_STORAGE_MODE === 'supabase' ? new SupabaseCandidatePhotoStorage() : sharedCandidatePhotoStorage;
}

/** Staff photos: stored like job seeker selfies (private bucket, signed links), used by every staff list. */
@Module({
  imports: [PrismaModule],
  providers: [
    StaffPhotoService,
    {
      provide: STAFF_PHOTO_STORAGE,
      useFactory: () => staffPhotoStorage(),
    },
  ],
  exports: [StaffPhotoService],
})
export class StaffPhotoModule {}
