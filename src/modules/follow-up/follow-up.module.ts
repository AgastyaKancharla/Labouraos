import { Module } from '@nestjs/common';
import { PrismaModule } from '../../common/prisma/prisma.module';
import { IdModule } from '../../common/id/id.module';
import { AuditModule } from '../../common/audit/audit.module';
import { PricingModule } from '../pricing/pricing.module';
import { ReviewFlagModule } from '../review-flag/review-flag.module';
import { VacancyModule } from '../vacancy/vacancy.module';
import { JobSeekerModule } from '../job-seeker/job-seeker.module';
import { ReportingScopeModule } from '../staff/reporting-scope.module';
import { FollowUpService } from './follow-up.service';
import { FollowUpController } from './follow-up.controller';
import { FollowUpHandoverService } from './follow-up-handover.service';
import { WorkHandoverService } from './work-handover.service';
import { FieldVisitModule } from '../field-visit/field-visit.module';

@Module({
  imports: [
    PrismaModule,
    IdModule,
    AuditModule,
    PricingModule,
    ReviewFlagModule,
    VacancyModule,
    JobSeekerModule,
    ReportingScopeModule,
    FieldVisitModule,
  ],
  controllers: [FollowUpController],
  providers: [FollowUpService, FollowUpHandoverService, WorkHandoverService],
  exports: [FollowUpService, FollowUpHandoverService, WorkHandoverService],
})
export class FollowUpModule {}
