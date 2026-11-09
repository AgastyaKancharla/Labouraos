import { Global, Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { AuditModule } from '../audit/audit.module';
import { AnonymisationService } from './anonymisation.service';
import {
  CANDIDATE_PHOTO_STORAGE,
  sharedCandidatePhotoStorage,
  SupabaseCandidatePhotoStorage,
} from '../../modules/job-seeker/photo-storage';

@Global()
@Module({
  imports: [PrismaModule, AuditModule],
  providers: [
    AnonymisationService,
    {
      provide: CANDIDATE_PHOTO_STORAGE,
      useFactory: () =>
        process.env.CANDIDATE_PHOTO_STORAGE_MODE === 'supabase'
          ? new SupabaseCandidatePhotoStorage()
          : sharedCandidatePhotoStorage,
    },
  ],
  exports: [AnonymisationService, CANDIDATE_PHOTO_STORAGE],
})
export class AnonymisationModule {}
