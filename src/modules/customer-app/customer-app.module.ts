import { Module } from '@nestjs/common';
import { PrismaModule } from '../../common/prisma/prisma.module';
import { CustomerAccountModule } from '../customer-account/customer-account.module';
import { JobSeekerModule } from '../job-seeker/job-seeker.module';
import { BusinessModule } from '../business/business.module';
import { ReferralModule } from '../referral/referral.module';
import { ConsentModule } from '../consent/consent.module';
import { PricingModule } from '../pricing/pricing.module';
import { VacancyModule } from '../vacancy/vacancy.module';
import { RegistrationJourneyService } from '../job-seeker/registration-journey.service';
import { CustomerAppController } from './customer-app.controller';
import { CustomerHomeService } from './customer-home.service';
import { CustomerRegistrationService } from './customer-registration.service';
import { CustomerRequestsService } from './customer-requests.service';

/**
 * Customer app: self-registration, link issuing, Home status, vacancy drafts,
 * call-me-back and deletion requests for job seekers, businesses and referral
 * partners (docs/customer-app-api.md). Calls the existing job seeker,
 * business, referral, consent and vacancy services. Agent A owns this folder.
 */
@Module({
  imports: [PrismaModule, CustomerAccountModule, JobSeekerModule, BusinessModule, ReferralModule, ConsentModule, PricingModule, VacancyModule],
  controllers: [CustomerAppController],
  providers: [CustomerRegistrationService, CustomerHomeService, CustomerRequestsService, RegistrationJourneyService],
})
export class CustomerAppModule {}
