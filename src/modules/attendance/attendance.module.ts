import { Module } from '@nestjs/common';
import { PrismaModule } from '../../common/prisma/prisma.module';
import { PricingModule } from '../pricing/pricing.module';
import { ReviewFlagModule } from '../review-flag/review-flag.module';
import { AttendanceClock } from './attendance-clock';
import { AttendanceController } from './attendance.controller';
import { AttendanceService } from './attendance.service';

@Module({
  imports: [PrismaModule, PricingModule, ReviewFlagModule],
  controllers: [AttendanceController],
  providers: [AttendanceService, AttendanceClock],
  exports: [AttendanceService, AttendanceClock],
})
export class AttendanceModule {}
