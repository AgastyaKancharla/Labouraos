import { Module } from '@nestjs/common';
import { PrismaModule } from '../../common/prisma/prisma.module';
import { AuditModule } from '../../common/audit/audit.module';
import { JobSeekerModule } from '../job-seeker/job-seeker.module';
import { PricingModule } from '../pricing/pricing.module';
import { ConsentModule } from '../consent/consent.module';
import { ScreensCallRegistrationController } from './screens-call-registration.controller';
import { ScreensCallRegistrationService } from './screens-call-registration.service';

@Module({
  imports: [PrismaModule, AuditModule, JobSeekerModule, PricingModule, ConsentModule],
  controllers: [ScreensCallRegistrationController],
  providers: [ScreensCallRegistrationService],
})
export class ScreensCallRegistrationModule {}
