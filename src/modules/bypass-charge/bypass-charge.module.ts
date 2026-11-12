import { Module } from '@nestjs/common';
import { PrismaModule } from '../../common/prisma/prisma.module';
import { AuditModule } from '../../common/audit/audit.module';
import { IdModule } from '../../common/id/id.module';
import { PricingModule } from '../pricing/pricing.module';
import { MonthLockModule } from '../month-lock/month-lock.module';
import { PaymentModule } from '../payment/payment.module';
import { BypassChargeController } from './bypass-charge.controller';
import { BypassChargeService } from './bypass-charge.service';

@Module({
  imports: [PrismaModule, AuditModule, IdModule, PricingModule, MonthLockModule, PaymentModule],
  controllers: [BypassChargeController],
  providers: [BypassChargeService],
  exports: [BypassChargeService],
})
export class BypassChargeModule {}
