import { Module } from '@nestjs/common';
import { PrismaModule } from '../../common/prisma/prisma.module';
import { PricingModule } from '../pricing/pricing.module';
import { ReviewFlagModule } from '../review-flag/review-flag.module';
import { ReportingScopeModule } from '../staff/reporting-scope.module';
import { MessageModule } from '../message/message.module';
import { AttendanceRequestsController } from './attendance-requests.controller';
import { AttendanceRequestsService } from './attendance-requests.service';
import { AttendanceRequestHooks } from './attendance-request-hooks';
import { LeaveService } from './leave.service';
import { AttendanceReportsController } from './attendance-reports.controller';
import { AttendanceReportsService } from './attendance-reports.service';
import { WorkingDaysModule } from './working-days.module';
import { HolidayController } from './holiday.controller';
import { HolidayService } from './holiday.service';
import { AttendanceClock } from './attendance-clock';
import { AttendanceController } from './attendance.controller';
import { AttendanceService } from './attendance.service';
import { AttendanceDaysService } from './attendance-days.service';

@Module({
  imports: [PrismaModule, PricingModule, ReviewFlagModule, ReportingScopeModule, MessageModule, WorkingDaysModule],
  controllers: [
    AttendanceController,
    AttendanceRequestsController,
    AttendanceReportsController,
    HolidayController,
  ],
  providers: [
    AttendanceService,
    AttendanceDaysService,
    AttendanceClock,
    LeaveService,
    AttendanceRequestsService,
    AttendanceRequestHooks,
    AttendanceReportsService,
    HolidayService,
  ],
  exports: [
    AttendanceService,
    AttendanceDaysService,
    AttendanceClock,
    LeaveService,
    AttendanceRequestsService,
    AttendanceRequestHooks,
    AttendanceReportsService,
    HolidayService,
    WorkingDaysModule,
  ],
})
export class AttendanceModule {}
