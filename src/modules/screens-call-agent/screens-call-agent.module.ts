import { Module } from '@nestjs/common';
import { PrismaModule } from '../../common/prisma/prisma.module';
import { PricingModule } from '../pricing/pricing.module';
import { AttendanceModule } from '../attendance/attendance.module';
import { CallModule } from '../call/call.module';
import { VacancyModule } from '../vacancy/vacancy.module';
import { TelephonyModule } from '../telephony/telephony.module';
import { TargetModule } from '../target/target.module';
import { SignupTrackerModule } from '../signup-tracker/signup-tracker.module';
import { CallWorkController, SearchController } from './call-work.controller';
import { CallWorkService } from './call-work.service';
import { CallWorkClock } from './call-work-clock';
import { SearchService } from './search.service';

/** Backend reads for the call agent console's daily-work screens, and the global search. */
@Module({
  imports: [PrismaModule, PricingModule, AttendanceModule, CallModule, VacancyModule, TelephonyModule, TargetModule, SignupTrackerModule],
  controllers: [CallWorkController, SearchController],
  providers: [CallWorkService, CallWorkClock, SearchService],
  exports: [CallWorkService, SearchService],
})
export class ScreensCallAgentModule {}
