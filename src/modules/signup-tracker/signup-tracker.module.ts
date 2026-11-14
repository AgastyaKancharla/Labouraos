import { Module } from '@nestjs/common';
import { PrismaModule } from '../../common/prisma/prisma.module';
import { AuditModule } from '../../common/audit/audit.module';
import { PricingModule } from '../pricing/pricing.module';
import { ReviewFlagModule } from '../review-flag/review-flag.module';
import { BusinessVerificationModule } from '../business/business-verification.module';
import { ReportingScopeModule } from '../staff/reporting-scope.module';
import { CustomerNotificationModule } from '../customer-notification/customer-notification.module';
import { SignupTrackerClock } from './signup-tracker-clock';
import { SignupFactsService } from './signup-facts.service';
import { SignupTrackerService } from './signup-tracker.service';
import { SignupViewsService } from './signup-views.service';
import { SignupTrackerController } from './signup-tracker.controller';

/**
 * App sign-ups for the back office: tracker stages and timing, automatic
 * assignment, sign-up help call tasks, business sign-up visit requests and
 * the App sign-ups views (customer app proposal, section 4). Agent D owns this
 * folder.
 *
 * Imports the customer notification module so its reminder sender (token
 * SIGNUP_REMINDER_SENDER, signup-reminder.port.ts) is used once it exists.
 * The customer app module imports this one to call SignupTrackerService.
 */
@Module({
  imports: [
    PrismaModule,
    AuditModule,
    PricingModule,
    ReviewFlagModule,
    BusinessVerificationModule,
    ReportingScopeModule,
    CustomerNotificationModule,
  ],
  controllers: [SignupTrackerController],
  providers: [SignupTrackerClock, SignupFactsService, SignupTrackerService, SignupViewsService],
  exports: [SignupTrackerClock, SignupFactsService, SignupTrackerService, SignupViewsService],
})
export class SignupTrackerModule {}
