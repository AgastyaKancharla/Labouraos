import { Module } from '@nestjs/common';
import { JobSeekerController } from './job-seeker.controller';
import { JobSeekerHitController } from './job-seeker-hit.controller';
import { JobSeekerService } from './job-seeker.service';
import { PaymentModule } from '../payment/payment.module';
import { PricingModule } from '../pricing/pricing.module';
import { ConsentModule } from '../consent/consent.module';
import { ReviewFlagModule } from '../review-flag/review-flag.module';

@Module({
  imports: [PaymentModule, PricingModule, ConsentModule, ReviewFlagModule],
  controllers: [JobSeekerController, JobSeekerHitController],
  providers: [JobSeekerService],
  exports: [JobSeekerService],
})
export class JobSeekerModule {}
