import { MessageModule } from '../message/message.module';
import { Module } from '@nestjs/common';
import { ReferralController } from './referral.controller';
import { ReferralService } from './referral.service';
import { ConsentModule } from '../consent/consent.module';
import { ReferralRegistrationController } from './referral-registration.controller';
import { JobSeekerModule } from '../job-seeker/job-seeker.module';
import { PayoutAccountModule } from '../payout-account/payout-account.module';
import { ReviewFlagModule } from '../review-flag/review-flag.module';
import { PricingModule } from '../pricing/pricing.module';
import { ReferralTermsController } from './referral-terms.controller';
import { AadhaarQrModule } from '../aadhaar-qr/aadhaar-qr.module';

@Module({
  imports: [ConsentModule, JobSeekerModule, PayoutAccountModule, ReviewFlagModule, PricingModule, MessageModule, AadhaarQrModule],
  controllers: [ReferralController, ReferralRegistrationController, ReferralTermsController],
  providers: [ReferralService],
  exports: [ReferralService],
})
export class ReferralModule {}
