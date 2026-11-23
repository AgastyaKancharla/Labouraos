import { Module } from '@nestjs/common';
import { PrismaModule } from '../../common/prisma/prisma.module';
import { PricingModule } from '../pricing/pricing.module';
import { FieldVisitModule } from '../field-visit/field-visit.module';
import { ScreensFieldController } from './screens-field.controller';
import { ScreensFieldService } from './screens-field.service';
import { FieldRedesignService } from './field-redesign.service';
import { AuditModule } from '../../common/audit/audit.module';
import { AttendanceModule } from '../attendance/attendance.module';
import { ConsentModule } from '../consent/consent.module';
import { TargetModule } from '../target/target.module';
import { VacancyModule } from '../vacancy/vacancy.module';
import { NotificationModule } from '../notification/notification.module';
import { ReviewFlagModule } from '../review-flag/review-flag.module';
import { FieldWorkExtrasService } from './field-work-extras.service';
import { FieldPeopleService } from './field-people.service';
import { JobSeekerModule } from '../job-seeker/job-seeker.module';
import { ProfileStuckModule } from '../profile-stuck/profile-stuck.module';

@Module({
  imports: [PrismaModule, PricingModule, FieldVisitModule, AuditModule, AttendanceModule, ConsentModule, TargetModule, VacancyModule, NotificationModule, ReviewFlagModule, JobSeekerModule, ProfileStuckModule],
  controllers: [ScreensFieldController],
  providers: [ScreensFieldService, FieldRedesignService, FieldWorkExtrasService, FieldPeopleService],
  // The call agent console lists (23 Nov) reuse the same rows with the call agent as viewer.
  exports: [FieldPeopleService],
})
export class ScreensFieldModule {}
