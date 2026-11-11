import { Module } from '@nestjs/common';
import { PrismaModule } from '../../common/prisma/prisma.module';
import { IdModule } from '../../common/id/id.module';
import { AuditModule } from '../../common/audit/audit.module';
import { ConsentModule } from '../consent/consent.module';
import { PricingModule } from '../pricing/pricing.module';
import { CallModule } from '../call/call.module';
import { JobSeekerModule } from '../job-seeker/job-seeker.module';
import { MessageModule } from '../message/message.module';
import { ReviewFlagModule } from '../review-flag/review-flag.module';
import { TelephonyModule } from '../telephony/telephony.module';
import { VacancyModule } from '../vacancy/vacancy.module';
import { FieldVisitModule } from '../field-visit/field-visit.module';
import { FieldSellingController } from './field-selling.controller';
import { FieldSellingService } from './field-selling.service';
import { FieldSellingScreensService } from './field-selling-screens.service';

@Module({
  imports: [
    PrismaModule, IdModule, AuditModule, ConsentModule, PricingModule, CallModule, JobSeekerModule,
    MessageModule, ReviewFlagModule, TelephonyModule, VacancyModule, FieldVisitModule,
  ],
  controllers: [FieldSellingController],
  providers: [FieldSellingService, FieldSellingScreensService],
  exports: [FieldSellingService],
})
export class FieldSellingModule {}
