import { Module } from '@nestjs/common';
import { PrismaModule } from '../../common/prisma/prisma.module';
import { IdModule } from '../../common/id/id.module';
import { AuditModule } from '../../common/audit/audit.module';
import { RbacModule } from '../../common/rbac/rbac.module';
import { JobSeekerModule } from '../job-seeker/job-seeker.module';
import { PlacementService } from './placement.service';
import { PlacementController, VacancyPlacementController } from './placement.controller';

@Module({
  imports: [PrismaModule, IdModule, AuditModule, RbacModule, JobSeekerModule],
  controllers: [VacancyPlacementController, PlacementController],
  providers: [PlacementService],
  exports: [PlacementService],
})
export class PlacementModule {}
