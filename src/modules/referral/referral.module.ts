import { Module } from '@nestjs/common';
import { ReferralController } from './referral.controller';
import { ReferralService } from './referral.service';
import { ConsentModule } from '../consent/consent.module';
import { ReferralRegistrationController } from './referral-registration.controller';
import { JobSeekerModule } from '../job-seeker/job-seeker.module';
import { PayoutAccountModule } from '../payout-account/payout-account.module';

@Module({
  imports: [ConsentModule, JobSeekerModule, PayoutAccountModule],
  controllers: [ReferralController, ReferralRegistrationController],
  providers: [ReferralService],
  exports: [ReferralService],
})
export class ReferralModule {}
