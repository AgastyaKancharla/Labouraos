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
import { JobSeekerModule } from './modules/job-seeker/job-seeker.module';
import { JobSeekerFlowEventsModule } from './modules/job-seeker/job-seeker-flow-events';
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
import { WhatsAppInboxModule } from './modules/whatsapp-inbox/whatsapp-inbox.module';
import { WhatsAppModule } from './common/whatsapp/whatsapp.module';
import { StaffModule } from './modules/staff/staff.module';
import { TargetModule } from './modules/target/target.module';
import { StatusHistoryModule } from './modules/status-history/status-history.module';
import { ReviewFlagModule } from './modules/review-flag/review-flag.module';
import { LoginCodeModule } from './modules/login-code/login-code.module';
import { PasswordResetModule } from './modules/password-reset/password-reset.module';
import { RefundModule } from './modules/refund/refund.module';
import { ObservabilityModule } from './common/observability/observability.module';
import { ConsentModule } from './modules/consent/consent.module';
import { LegalModule } from './modules/legal/legal.module';
import { ConductModule } from './modules/conduct/conduct.module';
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
import { MapsLinkModule } from './modules/maps-link/maps-link.module';
import { RegistrationDraftModule } from './modules/registration-draft/registration-draft.module';
import { ProfileStuckModule } from './modules/profile-stuck/profile-stuck.module';
import { RequestsModule } from './modules/requests/requests.module';
import { CompanyPlanModule } from './modules/company-plan/company-plan.module';
import { TargetSplitHooksModule } from './modules/company-plan/target-split.hooks';
import { ScreensTeamLeadModule } from './modules/screens-team-lead/screens-team-lead.module';
import { IdempotencyModule } from './common/idempotency/idempotency.module';
import { CustomerAuthModule } from './common/customer-auth/customer-auth.module';
import { CustomerAccountModule } from './modules/customer-account/customer-account.module';
import { CustomerAppModule } from './modules/customer-app/customer-app.module';
import { CustomerNotificationModule } from './modules/customer-notification/customer-notification.module';
import { SignupTrackerModule } from './modules/signup-tracker/signup-tracker.module';
import { APP_GUARD } from '@nestjs/core';
import { PlainQueryGuard } from './common/http/plain-query';
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
    WhatsAppModule,
    JobSeekerFlowEventsModule,
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
    WhatsAppInboxModule,
    StaffModule,
    StatusHistoryModule,
    ReviewFlagModule,
    LoginCodeModule,
    PasswordResetModule,
    TargetModule,
    ConsentModule,
    LegalModule,
    ConductModule,
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
    MapsLinkModule,
    RegistrationDraftModule,
    ProfileStuckModule,
    RequestsModule,
    CompanyPlanModule,
    TargetSplitHooksModule,
    ScreensTeamLeadModule,
    // Customer app (separate sign-in realm). Registered once here so the agents
    // filling these folders never edit this file.
    CustomerAuthModule,
    CustomerAccountModule,
    CustomerAppModule,
    CustomerNotificationModule,
    SignupTrackerModule,
  ],
  providers: [
    // M4: one per-address limit across every @Public() route.
    { provide: APP_GUARD, useClass: PublicRateLimitGuard },
    // Security IN-2: query values are plain text only.
    { provide: APP_GUARD, useClass: PlainQueryGuard },
  ],
})
export class AppModule {}

