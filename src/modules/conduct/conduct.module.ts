import { Module } from '@nestjs/common';
import { PrismaModule } from '../../common/prisma/prisma.module';
import { AuditModule } from '../../common/audit/audit.module';
import { MessageModule } from '../message/message.module';
import { ReviewFlagModule } from '../review-flag/review-flag.module';
import { CustomerNotificationModule } from '../customer-notification/customer-notification.module';
import { ConsentClock } from '../consent/consent-clock';
import { ConductController } from './conduct.controller';
import { ConductService } from './conduct.service';

@Module({
  imports: [PrismaModule, AuditModule, MessageModule, CustomerNotificationModule, ReviewFlagModule],
  controllers: [ConductController],
  providers: [ConductService, ConsentClock],
  exports: [ConductService],
})
export class ConductModule {}
