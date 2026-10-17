import { Module } from '@nestjs/common';
import { JobSeekerController } from './job-seeker.controller';
import { JobSeekerService } from './job-seeker.service';
import { PaymentModule } from '../payment/payment.module';

@Module({
  imports: [PaymentModule],
  controllers: [JobSeekerController],
  providers: [JobSeekerService],
  exports: [JobSeekerService],
})
export class JobSeekerModule {}
