import { Module } from '@nestjs/common';
import { PrismaModule } from '../../common/prisma/prisma.module';
import { IdModule } from '../../common/id/id.module';
import { AuditModule } from '../../common/audit/audit.module';
import { VacancyController } from './vacancy.controller';
import { VacancyService } from './vacancy.service';
import { ReviewFlagModule } from '../review-flag/review-flag.module';
import { MatchingService } from './matching.service';
import { ConsentModule } from '../consent/consent.module';

@Module({
  imports: [PrismaModule, IdModule, AuditModule, ReviewFlagModule, ConsentModule],
  controllers: [VacancyController],
  providers: [VacancyService, MatchingService],
  exports: [VacancyService],
})
export class VacancyModule {}
