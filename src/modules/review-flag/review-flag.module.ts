import { Module } from '@nestjs/common';
import { PrismaModule } from '../../common/prisma/prisma.module';
import { IdModule } from '../../common/id/id.module';
import { AuditModule } from '../../common/audit/audit.module';
import { ReviewFlagService } from './review-flag.service';
import { ReviewFlagController } from './review-flag.controller';

@Module({
  imports: [PrismaModule, IdModule, AuditModule],
  controllers: [ReviewFlagController],
  providers: [ReviewFlagService],
  exports: [ReviewFlagService],
})
export class ReviewFlagModule {}
