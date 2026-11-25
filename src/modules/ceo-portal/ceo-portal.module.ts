import { StaffPhotoModule } from '../staff/staff-photo.module';
import { Module } from '@nestjs/common';
import { BusinessChecksService } from './business-checks.service';
import { PrismaModule } from '../../common/prisma/prisma.module';
import { AuditModule } from '../../common/audit/audit.module';
import { IdModule } from '../../common/id/id.module';
import { PricingModule } from '../pricing/pricing.module';
import { RefundModule } from '../refund/refund.module';
import { TargetModule } from '../target/target.module';
import { AttendanceModule } from '../attendance/attendance.module';
import { JobSeekerModule } from '../job-seeker/job-seeker.module';
import { CeoPortalController } from './ceo-portal.controller';
import { CeoCommandCenterService } from './ceo-command-center.service';
import { CeoJobSeekersService } from './ceo-job-seekers.service';
import { CeoBusinessesService } from './ceo-businesses.service';
import { CeoPlacementsService } from './ceo-placements.service';
import { CeoMoneyService } from './ceo-money.service';
import { CeoTeamService } from './ceo-team.service';
import { CeoOpsService } from './ceo-ops.service';
import { CeoAdminService } from './ceo-admin.service';
import { CeoBreachService } from './ceo-breach.service';
import { RecordPhotosService } from './record-photos.service';
import { BUSINESS_PHOTO_STORAGE, MemoryBusinessPhotoStorage, SupabaseBusinessPhotoStorage } from '../business/storefront-photo.storage';

@Module({
  imports: [PrismaModule, AuditModule, IdModule, PricingModule, RefundModule, TargetModule, AttendanceModule, JobSeekerModule, StaffPhotoModule],
  controllers: [CeoPortalController],
  providers: [
    // 25 Nov (rev 211): the Team Lead's check queue (businesses and vacancies), also the CEO's and the Manager's.
    BusinessChecksService,
    CeoCommandCenterService,
    CeoJobSeekersService,
    CeoBusinessesService,
    CeoPlacementsService,
    CeoMoneyService,
    CeoTeamService,
    CeoOpsService,
    CeoAdminService,
    CeoBreachService,
    RecordPhotosService,
    {
      // Visit photos live with the business photos (private bucket); profiles read them through signed links only.
      provide: BUSINESS_PHOTO_STORAGE,
      useFactory: () => {
        const mode = process.env.BUSINESS_PHOTO_STORAGE_MODE || 'mock';
        if (mode === 'mock') return new MemoryBusinessPhotoStorage();
        if (mode === 'supabase') return new SupabaseBusinessPhotoStorage();
        throw new Error(`Unsupported business photo storage mode: ${mode}`);
      },
    },
  ],
  // The Manager portal reuses the list and profile services, scoped to the Manager's tree (record-scope.ts).
  // Profile photos (RecordPhotosService) are shared the same way, each portal passing its own filter.
  exports: [CeoCommandCenterService, CeoJobSeekersService, CeoBusinessesService, CeoPlacementsService, CeoMoneyService, RecordPhotosService, BusinessChecksService],
})
export class CeoPortalModule {}
