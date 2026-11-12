import { Module } from '@nestjs/common';
import { PrismaModule } from '../../common/prisma/prisma.module';
import { AuditModule } from '../../common/audit/audit.module';
import { AttendanceModule } from '../attendance/attendance.module';
import { JobSeekerModule } from '../job-seeker/job-seeker.module';
import { NotificationModule } from '../notification/notification.module';
import { PlacementModule } from '../placement/placement.module';
import { PricingModule } from '../pricing/pricing.module';
import { ReviewFlagModule } from '../review-flag/review-flag.module';
import { ReportingScopeModule } from '../staff/reporting-scope.module';
import { StaffModule } from '../staff/staff.module';
import { TargetModule } from '../target/target.module';
import { FlagEscalationService } from './flag-escalation.service';
import { RequestBellsService } from './request-bells.service';
import { RequestsController } from './requests.controller';
import { RequestsService } from './requests.service';

/** The shared requests and escalation backend (Team Lead and Manager portals). */
@Module({
  imports: [
    PrismaModule,
    AuditModule,
    AttendanceModule,
    JobSeekerModule,
    NotificationModule,
    PlacementModule,
    PricingModule,
    ReviewFlagModule,
    ReportingScopeModule,
    StaffModule,
    TargetModule,
  ],
  controllers: [RequestsController],
  providers: [RequestsService, RequestBellsService, FlagEscalationService],
  exports: [RequestsService, RequestBellsService, FlagEscalationService],
})
export class RequestsModule {}
