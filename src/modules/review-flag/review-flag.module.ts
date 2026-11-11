import { Module } from '@nestjs/common';
import { PrismaModule } from '../../common/prisma/prisma.module';
import { IdModule } from '../../common/id/id.module';
import { AuditModule } from '../../common/audit/audit.module';
import { PricingModule } from '../pricing/pricing.module';
import { NotificationModule } from '../notification/notification.module';
import { ReviewFlagService } from './review-flag.service';
import { ReviewFlagController } from './review-flag.controller';
import { PatternFlagService } from './pattern-flag.service';

@Module({
  imports: [PrismaModule, IdModule, AuditModule, PricingModule, NotificationModule],
  controllers: [ReviewFlagController],
  providers: [ReviewFlagService, PatternFlagService],
  exports: [ReviewFlagService, PatternFlagService],
})
export class ReviewFlagModule {}
