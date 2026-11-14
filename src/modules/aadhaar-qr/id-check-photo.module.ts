import { Module } from '@nestjs/common';
import { PrismaModule } from '../../common/prisma/prisma.module';
import { AuditModule } from '../../common/audit/audit.module';
import { ReportingScopeModule } from '../staff/reporting-scope.module';
import { IdCheckPhotoService } from './id-check-photo.service';
import { OtherIdService } from './other-id.service';
import { Under18StopService } from './under18-stop.service';
import { IdCheckAccessService } from './id-check-access.service';

/**
 * The parts of the ID check the Team Lead screens and the daily retention run
 * need without the rest: ID photos (storage, deletion, short-lived links),
 * the sticky under-18 stop, and another ID checked by the Team Lead by eye.
 * The candidate-photo storage comes from the global AnonymisationModule.
 */
@Module({
  imports: [PrismaModule, AuditModule, ReportingScopeModule],
  providers: [IdCheckPhotoService, Under18StopService, OtherIdService, IdCheckAccessService],
  exports: [IdCheckPhotoService, Under18StopService, OtherIdService, IdCheckAccessService],
})
export class IdCheckPhotoModule {}
