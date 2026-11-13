import { Module } from '@nestjs/common';
import { HealthModule } from './health/health.module';
import { PrismaModule } from './common/prisma/prisma.module';
import { IdModule } from './common/id/id.module';
import { AuthModule } from './common/auth/auth.module';
import { RbacModule } from './common/rbac/rbac.module';
import { AuditModule } from './common/audit/audit.module';
import { EditPolicyModule } from './common/edit-policy/edit-policy.module';
import { AnonymisationModule } from './common/anonymisation/anonymisation.module';
import { OtpModule } from './common/otp/otp.module';
import { BypassChargeModule } from './modules/bypass-charge/bypass-charge.module';
import { EmailModule } from './common/email/email.module';
import { KycModule } from './common/kyc/kyc.module';
import { KycHealthModule } from './common/kyc/kyc-health.module';
import { JobSeekerModule } from './modules/job-seeker/job-seeker.module';
import { ReferralModule } from './modules/referral/referral.module';
import { PaymentModule } from './modules/payment/payment.module';
import { JobsModule } from './jobs/jobs.module';
import { BusinessModule } from './modules/business/business.module';
import { VacancyModule } from './modules/vacancy/vacancy.module';
import { FieldAgentModule } from './modules/field-agent/field-agent.module';
import { PlacementModule } from './modules/placement/placement.module';
import { PricingModule } from './modules/pricing/pricing.module';
import { ConsoleModule } from './modules/console/console.module';
import { TelephonyModule } from './modules/telephony/telephony.module';
import { CallModule } from './modules/call/call.module';
import { MessageModule } from './modules/message/message.module';
import { WhatsAppModule } from './common/whatsapp/whatsapp.module';
import { StaffModule } from './modules/staff/staff.module';
import { TargetModule } from './modules/target/target.module';
import { StatusHistoryModule } from './modules/status-history/status-history.module';
import { ReviewFlagModule } from './modules/review-flag/review-flag.module';
import { LoginCodeModule } from './modules/login-code/login-code.module';
import { RefundModule } from './modules/refund/refund.module';
import { ObservabilityModule } from './common/observability/observability.module';
import { ConsentModule } from './modules/consent/consent.module';
import { MapModule } from './modules/map/map.module';
import { FollowUpModule } from './modules/follow-up/follow-up.module';
import { PayoutAccountModule } from './modules/payout-account/payout-account.module';
import { AttendanceModule } from './modules/attendance/attendance.module';
import { NotificationModule } from './modules/notification/notification.module';
import { RefundPriorityModule } from './modules/refund-priority/refund-priority.module';
import { RetentionModule } from './modules/retention/retention.module';
import { WebAppModule } from './modules/web-app/web-app.module';
import { ScreensCallRegistrationModule } from './modules/screens-call-registration/screens-call-registration.module';
import { FieldSellingModule } from './modules/field-selling/field-selling.module';
import { CeoPortalModule } from './modules/ceo-portal/ceo-portal.module';
import { DataRequestModule } from './modules/data-request/data-request.module';
import { AreaModule } from './modules/area/area.module';
import { LiveModule } from './common/live/live.module';
import { ScreensCallAgentModule } from './modules/screens-call-agent/screens-call-agent.module';
import { ScreensManagerModule } from './modules/screens-manager/screens-manager.module';
import { FinanceModule } from './modules/finance/finance.module';
import { FieldVisitModule } from './modules/field-visit/field-visit.module';
import { ScreensFieldModule } from './modules/screens-field/screens-field.module';
import { RequestsModule } from './modules/requests/requests.module';
import { CompanyPlanModule } from './modules/company-plan/company-plan.module';
import { ScreensTeamLeadModule } from './modules/screens-team-lead/screens-team-lead.module';
import { IdempotencyModule } from './common/idempotency/idempotency.module';
import { APP_GUARD } from '@nestjs/core';
import { PublicRateLimitGuard } from './common/http/public-rate-limit.guard';

@Module({
  imports: [
    CeoPortalModule,
    DataRequestModule,
    FinanceModule,
    AreaModule,
    ObservabilityModule,
    PrismaModule,
    IdempotencyModule,
    LiveModule,
    IdModule,
    AuthModule,
    RbacModule,
    AuditModule,
    EditPolicyModule,
    AnonymisationModule,
    RetentionModule,
    OtpModule,
    EmailModule,
    KycModule,
    KycHealthModule,
    WhatsAppModule,
    JobSeekerModule,
    ReferralModule,
    PaymentModule,
    JobsModule,
    BusinessModule,
    VacancyModule,
    FieldAgentModule,
    PlacementModule,
    RefundModule,
    PricingModule,
    ConsoleModule,
    TelephonyModule,
    CallModule,
    MessageModule,
    StaffModule,
    StatusHistoryModule,
    ReviewFlagModule,
    LoginCodeModule,
    TargetModule,
    ConsentModule,
    MapModule,
    FollowUpModule,
    PayoutAccountModule,
    AttendanceModule,
    NotificationModule,
    RefundPriorityModule,
    HealthModule,
    ScreensCallRegistrationModule,
    FieldSellingModule,
    ScreensCallAgentModule,
    ScreensManagerModule,
    WebAppModule,
    BypassChargeModule,
    FieldVisitModule,
    ScreensFieldModule,
    RequestsModule,
    CompanyPlanModule,
    ScreensTeamLeadModule,
  ],
  providers: [
    // M4: one per-address limit across every @Public() route.
    { provide: APP_GUARD, useClass: PublicRateLimitGuard },
  ],
})
export class AppModule {}

