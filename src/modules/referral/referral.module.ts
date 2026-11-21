import { LegalModule } from '../legal/legal.module';
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
import { ReportingScopeModule } from '../staff/reporting-scope.module';
import { ReferralLeadService } from './referral-lead.service';
import { ReferralLeadCustomerController, ReferralLeadStaffController, ReferralLinkPublicController } from './referral-lead.controller';

@Module({
  imports: [ConsentModule, JobSeekerModule, PayoutAccountModule, ReviewFlagModule, PricingModule, MessageModule, AadhaarQrModule, LegalModule, ReportingScopeModule],
  controllers: [ReferralController, ReferralRegistrationController, ReferralTermsController, ReferralLeadStaffController, ReferralLinkPublicController, ReferralLeadCustomerController],
  providers: [ReferralService, ReferralLeadService],
  exports: [ReferralService, ReferralLeadService],
})
export class ReferralModule {}
