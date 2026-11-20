import { StaffPhotoModule } from '../staff/staff-photo.module';
import { Module } from '@nestjs/common';
import { PrismaModule } from '../../common/prisma/prisma.module';
import { AuditModule } from '../../common/audit/audit.module';
import { AttendanceModule } from '../attendance/attendance.module';
import {
  BUSINESS_PHOTO_STORAGE,
  MemoryBusinessPhotoStorage,
  SupabaseBusinessPhotoStorage,
} from '../business/storefront-photo.storage';
import { JobSeekerModule } from '../job-seeker/job-seeker.module';
import { NotificationModule } from '../notification/notification.module';
import { ReviewFlagModule } from '../review-flag/review-flag.module';
import { ReportingScopeModule } from '../staff/reporting-scope.module';
import { TargetModule } from '../target/target.module';
import { TeamLeadChecksService } from './team-lead-checks.service';
import { TeamLeadController } from './team-lead.controller';
import { TeamLeadScreensService } from './team-lead-screens.service';
import { IdCheckPhotoModule } from '../aadhaar-qr/id-check-photo.module';
import { CeoPortalModule } from '../ceo-portal/ceo-portal.module';
import { RefundPriorityModule } from '../refund-priority/refund-priority.module';
import { ScreensManagerModule } from '../screens-manager/screens-manager.module';
import { CompanyPlanModule } from '../company-plan/company-plan.module';
import { TeamLeadRecordsController } from './team-lead-records.controller';
import { TeamLeadRecordsService } from './team-lead-records.service';
import { TeamLeadTargetsService } from './team-lead-targets.service';

@Module({
  imports: [PrismaModule, AuditModule, AttendanceModule, JobSeekerModule, NotificationModule, ReviewFlagModule, ReportingScopeModule, TargetModule, StaffPhotoModule, IdCheckPhotoModule, CeoPortalModule, ScreensManagerModule, RefundPriorityModule, CompanyPlanModule],
  controllers: [TeamLeadController, TeamLeadRecordsController],
  providers: [
    TeamLeadScreensService,
    TeamLeadChecksService,
    TeamLeadRecordsService,
    // ManagerTreeService comes from ScreensManagerModule (its work counts back the targets' "done").
    TeamLeadTargetsService,
    {
      // Visit photos live with the business photos (private bucket); read here through signed links only.
      provide: BUSINESS_PHOTO_STORAGE,
      useFactory: () => {
        const mode = process.env.BUSINESS_PHOTO_STORAGE_MODE || 'mock';
        if (mode === 'mock') return new MemoryBusinessPhotoStorage();
        if (mode === 'supabase') return new SupabaseBusinessPhotoStorage();
        throw new Error(`Unsupported business photo storage mode: ${mode}`);
      },
    },
  ],
})
export class ScreensTeamLeadModule {}
