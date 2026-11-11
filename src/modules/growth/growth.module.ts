import { Module } from '@nestjs/common';
import { PrismaModule } from '../../common/prisma/prisma.module';
import { AuditModule } from '../../common/audit/audit.module';
import { AuthModule } from '../../common/auth/auth.module';
import { PricingModule } from '../pricing/pricing.module';
import { VacancyModule } from '../vacancy/vacancy.module';
import { ReportingScopeModule } from '../staff/reporting-scope.module';
import { GrowthController } from './growth.controller';
import { MoneyUnderGuaranteeService } from './money-under-guarantee.service';
import { DaysToFirstInterviewService } from './days-to-first-interview.service';
import { ShortageTaskService } from './shortage-task.service';
import { WinBackService } from './win-back.service';

@Module({
  imports: [PrismaModule, AuditModule, AuthModule, PricingModule, VacancyModule, ReportingScopeModule],
  controllers: [GrowthController],
  providers: [MoneyUnderGuaranteeService, DaysToFirstInterviewService, ShortageTaskService, WinBackService],
  exports: [MoneyUnderGuaranteeService, DaysToFirstInterviewService, ShortageTaskService, WinBackService],
})
export class GrowthModule {}
