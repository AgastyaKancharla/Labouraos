import { Module } from '@nestjs/common';
import { PrismaModule } from '../../common/prisma/prisma.module';
import { IdModule } from '../../common/id/id.module';
import { AuditModule } from '../../common/audit/audit.module';
import { VacancyController } from './vacancy.controller';
import { VacancyService } from './vacancy.service';
import { ReviewFlagModule } from '../review-flag/review-flag.module';
import { MatchingService } from './matching.service';
import { ConsentModule } from '../consent/consent.module';
import { JobSeekerModule } from '../job-seeker/job-seeker.module';
import { MessageModule } from '../message/message.module';
import { CandidateIntroductionService } from './candidate-introduction.service';
import { CandidateIntroductionController } from './candidate-introduction.controller';

@Module({
  imports: [PrismaModule, IdModule, AuditModule, ReviewFlagModule, ConsentModule, JobSeekerModule, MessageModule],
  controllers: [VacancyController, CandidateIntroductionController],
  providers: [VacancyService, MatchingService, CandidateIntroductionService],
  exports: [VacancyService],
})
export class VacancyModule {}
