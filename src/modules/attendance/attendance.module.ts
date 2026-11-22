import { Module } from '@nestjs/common';
import { PrismaModule } from '../../common/prisma/prisma.module';
import { PricingModule } from '../pricing/pricing.module';
import { ReviewFlagModule } from '../review-flag/review-flag.module';
import { ReportingScopeModule } from '../staff/reporting-scope.module';
import { MessageModule } from '../message/message.module';
import { NotificationModule } from '../notification/notification.module';
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
import { AttendanceShiftsService } from './attendance-shifts.service';
import { AttendanceActivityInterceptor } from './attendance-activity.interceptor';
import { AttendanceSignInHook } from './attendance-sign-in.hook';
import { APP_INTERCEPTOR } from '@nestjs/core';

@Module({
  imports: [PrismaModule, PricingModule, ReviewFlagModule, ReportingScopeModule, MessageModule, WorkingDaysModule, NotificationModule],
  controllers: [
    AttendanceController,
    AttendanceRequestsController,
    AttendanceReportsController,
    HolidayController,
  ],
  providers: [
    AttendanceService,
    AttendanceDaysService,
    AttendanceShiftsService,
    AttendanceSignInHook,
    { provide: APP_INTERCEPTOR, useClass: AttendanceActivityInterceptor },
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
    AttendanceShiftsService,
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
