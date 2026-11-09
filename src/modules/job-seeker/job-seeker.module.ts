import { Module } from '@nestjs/common';
import { JobSeekerController } from './job-seeker.controller';
import { JobSeekerHitController } from './job-seeker-hit.controller';
import { JobSeekerService } from './job-seeker.service';
import { PaymentModule } from '../payment/payment.module';
import { PricingModule } from '../pricing/pricing.module';
import { ConsentModule } from '../consent/consent.module';
import { ReviewFlagModule } from '../review-flag/review-flag.module';
import { TradeModule } from '../trade/trade.module';
import {
  CANDIDATE_PHOTO_STORAGE,
  sharedCandidatePhotoStorage,
  SupabaseCandidatePhotoStorage,
} from './photo-storage';

@Module({
  imports: [PaymentModule, PricingModule, ConsentModule, ReviewFlagModule, TradeModule],
  controllers: [JobSeekerController, JobSeekerHitController],
  providers: [
    JobSeekerService,
    {
      provide: CANDIDATE_PHOTO_STORAGE,
      useFactory: () => process.env.CANDIDATE_PHOTO_STORAGE_MODE === 'supabase'
        ? new SupabaseCandidatePhotoStorage()
        : sharedCandidatePhotoStorage,
    },
  ],
  exports: [JobSeekerService, CANDIDATE_PHOTO_STORAGE],
})
export class JobSeekerModule {}
