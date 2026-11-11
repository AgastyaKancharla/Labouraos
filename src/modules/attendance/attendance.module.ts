import { Module } from '@nestjs/common';
import { PrismaModule } from '../../common/prisma/prisma.module';
import { PricingModule } from '../pricing/pricing.module';
import { ReviewFlagModule } from '../review-flag/review-flag.module';
import { ReportingScopeModule } from '../staff/reporting-scope.module';
import { AttendanceClock } from './attendance-clock';
import { AttendanceController } from './attendance.controller';
import { AttendanceService } from './attendance.service';
import { AttendanceDaysService } from './attendance-days.service';

@Module({
  imports: [PrismaModule, PricingModule, ReviewFlagModule, ReportingScopeModule],
  controllers: [AttendanceController],
  providers: [AttendanceService, AttendanceDaysService, AttendanceClock],
  exports: [AttendanceService, AttendanceDaysService, AttendanceClock],
})
export class AttendanceModule {}
