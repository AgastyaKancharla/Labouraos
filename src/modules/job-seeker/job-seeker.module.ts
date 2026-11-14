import { Module } from '@nestjs/common';
import { JobSeekerController } from './job-seeker.controller';
import { JobSeekerHitController } from './job-seeker-hit.controller';
import { RegistrationController } from './registration.controller';
import { JobSeekerService } from './job-seeker.service';
import { RegistrationJourneyService } from './registration-journey.service';
import { PaymentModule } from '../payment/payment.module';
import { PricingModule } from '../pricing/pricing.module';
import { ConsentModule } from '../consent/consent.module';
import { ReviewFlagModule } from '../review-flag/review-flag.module';
import { TradeModule } from '../trade/trade.module';
import { KycHealthModule } from '../../common/kyc/kyc-health.module';
import { MessageModule } from '../message/message.module';
import { OtpModule } from '../../common/otp/otp.module';
import { AadhaarQrModule } from '../aadhaar-qr/aadhaar-qr.module';
import {
  CANDIDATE_PHOTO_STORAGE,
  sharedCandidatePhotoStorage,
  SupabaseCandidatePhotoStorage,
} from './photo-storage';

@Module({
  imports: [PaymentModule, PricingModule, ConsentModule, ReviewFlagModule, TradeModule, KycHealthModule, MessageModule, OtpModule, AadhaarQrModule],
  controllers: [JobSeekerController, JobSeekerHitController, RegistrationController],
  providers: [
    JobSeekerService,
    RegistrationJourneyService,
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
