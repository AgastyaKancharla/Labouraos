import { Module } from '@nestjs/common';
import { PaymentController } from './payment.controller';
import { PaymentService } from './payment.service';
import { PAYMENT_PROVIDER } from './payment-provider.interface';
import { MockPaymentProvider } from './mock-payment.provider';
import { RealPaymentProvider } from './real-payment.provider';
import { BANK_FEED_PROVIDER } from './bank-feed-provider.interface';
import { MockBankFeedProvider } from './mock-bank-feed.provider';
import { PrismaModule } from '../../common/prisma/prisma.module';
import { PublicLinkStoreModule } from '../../common/public-link-store.module';
import { AuditModule } from '../../common/audit/audit.module';
import { IdModule } from '../../common/id/id.module';
import { PricingModule } from '../pricing/pricing.module';
import { MessageModule } from '../message/message.module';
import { ReviewFlagModule } from '../review-flag/review-flag.module';
import { UpiCollectionService } from './upi-collection.service';

@Module({
  imports: [
    PrismaModule,
    PublicLinkStoreModule,
    AuditModule,
    IdModule,
    PricingModule,
    MessageModule,
    ReviewFlagModule,
  ],
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
    {
      provide: BANK_FEED_PROVIDER,
      useClass: MockBankFeedProvider,
    },
    PaymentService,
    UpiCollectionService,
  ],
  exports: [PaymentService, PAYMENT_PROVIDER, BANK_FEED_PROVIDER, UpiCollectionService],
})
export class PaymentModule {}
