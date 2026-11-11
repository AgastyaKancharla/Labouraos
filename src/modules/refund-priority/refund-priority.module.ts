import { Module } from '@nestjs/common';
import { PrismaModule } from '../../common/prisma/prisma.module';
import { PricingModule } from '../pricing/pricing.module';
import { ReportingScopeModule } from '../staff/reporting-scope.module';
import { NotificationModule } from '../notification/notification.module';
import { RefundPriorityController } from './refund-priority.controller';
import { RefundPriorityService } from './refund-priority.service';

/** Phase 21 Task 7: close to a refund, the 15-day priority. */
@Module({
  imports: [PrismaModule, PricingModule, ReportingScopeModule, NotificationModule],
  controllers: [RefundPriorityController],
  providers: [RefundPriorityService],
  exports: [RefundPriorityService],
})
export class RefundPriorityModule {}
