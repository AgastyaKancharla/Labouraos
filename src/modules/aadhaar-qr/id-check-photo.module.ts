import { Module } from '@nestjs/common';
import { PrismaModule } from '../../common/prisma/prisma.module';
import { AuditModule } from '../../common/audit/audit.module';
import { ReportingScopeModule } from '../staff/reporting-scope.module';
import { IdCheckPhotoService } from './id-check-photo.service';
import { OtherIdService } from './other-id.service';
import { Under18StopService } from './under18-stop.service';
import { IdCheckAccessService } from './id-check-access.service';
import { OtherIdApprovalService } from './other-id-approval.service';
import { ReviewFlagModule } from '../review-flag/review-flag.module';

/**
 * The parts of the ID check the Team Lead screens and the daily retention run
 * need without the rest: ID photos (storage, deletion, short-lived links),
 * the sticky under-18 stop, and another ID checked by the Team Lead by eye
 * (who approves it: OtherIdApprovalService, rev 169).
 * The candidate-photo storage comes from the global AnonymisationModule.
 */
@Module({
  imports: [PrismaModule, AuditModule, ReportingScopeModule, ReviewFlagModule],
  providers: [IdCheckPhotoService, Under18StopService, OtherIdService, IdCheckAccessService, OtherIdApprovalService],
  exports: [IdCheckPhotoService, Under18StopService, OtherIdService, IdCheckAccessService, OtherIdApprovalService],
})
export class IdCheckPhotoModule {}
