import { Module } from '@nestjs/common';
import { HealthModule } from './health/health.module';
import { PrismaModule } from './common/prisma/prisma.module';
import { IdModule } from './common/id/id.module';
import { AuthModule } from './common/auth/auth.module';
import { RbacModule } from './common/rbac/rbac.module';
import { AuditModule } from './common/audit/audit.module';
import { OtpModule } from './common/otp/otp.module';
import { KycModule } from './common/kyc/kyc.module';
import { JobSeekerModule } from './modules/job-seeker/job-seeker.module';
import { ReferralModule } from './modules/referral/referral.module';
import { PaymentModule } from './modules/payment/payment.module';

@Module({
  imports: [
    PrismaModule,
    IdModule,
    AuthModule,
    RbacModule,
    AuditModule,
    OtpModule,
    KycModule,
    JobSeekerModule,
    ReferralModule,
    PaymentModule,
    HealthModule,
  ],
})
export class AppModule {}
