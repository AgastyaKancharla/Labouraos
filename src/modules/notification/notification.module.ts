import { Module } from '@nestjs/common';
import { PrismaModule } from '../../common/prisma/prisma.module';
import { NotificationClock } from './notification-clock';
import { NotificationController } from './notification.controller';
import { NotificationService } from './notification.service';
import { NotificationSourcesService } from './notification-sources.service';

/**
 * Phase 21 Task 6: notification bells. Depends only on the database, so any
 * module can import it to raise or clear a bell without a cycle.
 */
@Module({
  imports: [PrismaModule],
  controllers: [NotificationController],
  providers: [NotificationService, NotificationSourcesService, NotificationClock],
  exports: [NotificationService, NotificationSourcesService, NotificationClock],
})
export class NotificationModule {}
