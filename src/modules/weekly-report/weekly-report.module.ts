import { Module } from '@nestjs/common';
import { PrismaModule } from '../../common/prisma/prisma.module';
import { CeoPortalModule } from '../ceo-portal/ceo-portal.module';
import { CompanyPlanModule } from '../company-plan/company-plan.module';
import { GrowthModule } from '../growth/growth.module';
import { NotificationModule } from '../notification/notification.module';
import { ScreensManagerModule } from '../screens-manager/screens-manager.module';
import { WeeklyReportController } from './weekly-report.controller';
import { WeeklyReportService } from './weekly-report.service';

/** The Monday weekly report: built by WeeklyReportJob, kept as snapshots, read here. */
@Module({
  imports: [PrismaModule, ScreensManagerModule, CeoPortalModule, CompanyPlanModule, GrowthModule, NotificationModule],
  controllers: [WeeklyReportController],
  providers: [WeeklyReportService],
  exports: [WeeklyReportService],
})
export class WeeklyReportModule {}
