import { Module } from '@nestjs/common';
import { CustomerNotificationModule } from '../customer-notification/customer-notification.module';
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
import { InterviewController } from './interview.controller';
import { InterviewService } from './interview.service';
import { PricingModule } from '../pricing/pricing.module';
import { CallModule } from '../call/call.module';
import { BusinessVerificationModule } from '../business/business-verification.module';
import { PlacementModule } from '../placement/placement.module';
import { TradeModule } from '../trade/trade.module';
import { VacancyConfirmationService } from './vacancy-confirmation.service';
import { VacancyConfirmController } from './vacancy-confirm.controller';

@Module({
  imports: [PrismaModule, IdModule, AuditModule, ReviewFlagModule, ConsentModule, JobSeekerModule, MessageModule, PricingModule, CallModule, BusinessVerificationModule, PlacementModule, TradeModule, CustomerNotificationModule],
  controllers: [VacancyController, CandidateIntroductionController, InterviewController, VacancyConfirmController],
  providers: [VacancyService, MatchingService, CandidateIntroductionService, InterviewService, VacancyConfirmationService],
  exports: [VacancyService, MatchingService, CandidateIntroductionService, InterviewService, VacancyConfirmationService],
})
export class VacancyModule {}
