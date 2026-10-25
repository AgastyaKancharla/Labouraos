import { Module } from '@nestjs/common';
import { PaymentController } from './payment.controller';
import { PaymentService } from './payment.service';
import { PAYMENT_PROVIDER } from './payment-provider.interface';
import { MockPaymentProvider } from './mock-payment.provider';
import { RealPaymentProvider } from './real-payment.provider';
import { PrismaModule } from '../../common/prisma/prisma.module';
import { AuditModule } from '../../common/audit/audit.module';
import { IdModule } from '../../common/id/id.module';

@Module({
  imports: [PrismaModule, AuditModule, IdModule],
  controllers: [PaymentController],
  providers: [
    {
      provide: PAYMENT_PROVIDER,
      useFactory: () => {
        const rawProvider =
          process.env.PAYMENT_PROVIDER_MODE || process.env.PAYMENT_PROVIDER;
        const providerName =
          rawProvider && rawProvider !== 'undefined' ? rawProvider : 'mock';
        if (providerName === 'mock') {
          return new MockPaymentProvider();
        }
        if (
          providerName === 'real' ||
          providerName === 'razorpay'
        ) {
          return new RealPaymentProvider();
        }
        throw new Error(`Unsupported payment provider: ${providerName}`);
      },
    },
    PaymentService,
  ],
  exports: [PaymentService, PAYMENT_PROVIDER],
})
export class PaymentModule {}
