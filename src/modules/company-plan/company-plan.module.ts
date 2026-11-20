import { Module } from '@nestjs/common';
import { PrismaModule } from '../../common/prisma/prisma.module';
import { AuditModule } from '../../common/audit/audit.module';
import { TargetModule } from '../target/target.module';
import { WorkingDaysModule } from '../attendance/working-days.module';
import { CompanyPlanController } from './company-plan.controller';
import { CompanyPlanService } from './company-plan.service';
import { TargetSplitService } from './target-split.service';

/** The CEO's monthly company plan, the team split and the automatic split to agents (counts only). */
@Module({
  imports: [PrismaModule, AuditModule, TargetModule, WorkingDaysModule],
  controllers: [CompanyPlanController],
  providers: [CompanyPlanService, TargetSplitService],
  exports: [CompanyPlanService, TargetSplitService],
})
export class CompanyPlanModule {}
