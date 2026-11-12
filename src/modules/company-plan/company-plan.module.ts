import { Module } from '@nestjs/common';
import { PrismaModule } from '../../common/prisma/prisma.module';
import { AuditModule } from '../../common/audit/audit.module';
import { CompanyPlanController } from './company-plan.controller';
import { CompanyPlanService } from './company-plan.service';

/** The CEO's monthly company plan and the Managers' team split (counts only). */
@Module({
  imports: [PrismaModule, AuditModule],
  controllers: [CompanyPlanController],
  providers: [CompanyPlanService],
  exports: [CompanyPlanService],
})
export class CompanyPlanModule {}
