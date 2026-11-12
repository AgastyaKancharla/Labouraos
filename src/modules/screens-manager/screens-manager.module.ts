import { Module } from '@nestjs/common';
import { PrismaModule } from '../../common/prisma/prisma.module';
import { AuditModule } from '../../common/audit/audit.module';
import { IdModule } from '../../common/id/id.module';
import { ReportingScopeModule } from '../staff/reporting-scope.module';
import { AttendanceModule } from '../attendance/attendance.module';
import { RefundPriorityModule } from '../refund-priority/refund-priority.module';
import { ReviewFlagModule } from '../review-flag/review-flag.module';
import { NotificationModule } from '../notification/notification.module';
import { TargetModule } from '../target/target.module';
import { RequestsModule } from '../requests/requests.module';
import { ScreensManagerController } from './screens-manager.controller';
import { ManagerTreeService } from './manager-tree.service';
import { ManagerPlanService } from './manager-plan.service';
import { ManagerPeopleService } from './manager-people.service';
import { ManagerOpsService } from './manager-ops.service';
import { ManagerTargetsService } from './manager-targets.service';

/** Manager portal read endpoints (MG-* designs), scoped to the Manager's own reporting tree. */
@Module({
  imports: [PrismaModule, AuditModule, IdModule, ReportingScopeModule, AttendanceModule, RefundPriorityModule, ReviewFlagModule, NotificationModule, TargetModule, RequestsModule],
  controllers: [ScreensManagerController],
  providers: [ManagerTreeService, ManagerPlanService, ManagerPeopleService, ManagerOpsService, ManagerTargetsService],
})
export class ScreensManagerModule {}
