import { Module } from '@nestjs/common';
import { AuditModule } from '../../common/audit/audit.module';
import { OtpModule } from '../../common/otp/otp.module';
import { PrismaModule } from '../../common/prisma/prisma.module';
import { ReviewFlagModule } from '../review-flag/review-flag.module';
import { BusinessClock } from './business-clock';
import { BusinessVerificationService } from './business-verification.service';
import { CustomerNotificationModule } from '../customer-notification/customer-notification.module';

@Module({
  imports: [PrismaModule, AuditModule, OtpModule, ReviewFlagModule, CustomerNotificationModule],
  providers: [BusinessClock, BusinessVerificationService],
  exports: [BusinessClock, BusinessVerificationService],
})
export class BusinessVerificationModule {}
