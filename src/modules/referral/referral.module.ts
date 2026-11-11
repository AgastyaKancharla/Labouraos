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

@Module({
  imports: [ConsentModule, JobSeekerModule, PayoutAccountModule, ReviewFlagModule, PricingModule],
  controllers: [ReferralController, ReferralRegistrationController, ReferralTermsController],
  providers: [ReferralService],
  exports: [ReferralService],
})
export class ReferralModule {}
