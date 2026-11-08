import { Module } from '@nestjs/common';
import { PrismaModule } from '../../common/prisma/prisma.module';
import { PricingModule } from '../pricing/pricing.module';
import { IdModule } from '../../common/id/id.module';
import { AuditModule } from '../../common/audit/audit.module';
import { MessageModule } from '../message/message.module';
import { OtpModule } from '../../common/otp/otp.module';
import { ReviewFlagModule } from '../review-flag/review-flag.module';
import { PayoutAccountService } from './payout-account.service';
import { PayoutAccountController } from './payout-account.controller';
import { NAME_CHECK_PROVIDER } from './name-check-provider.interface';
import { ManualNameCheckProvider } from './manual-name-check.provider';

@Module({
  imports: [
    PrismaModule,
    PricingModule,
    IdModule,
    AuditModule,
    MessageModule,
    OtpModule,
    ReviewFlagModule,
  ],
  controllers: [PayoutAccountController],
  providers: [
    PayoutAccountService,
    {
      provide: NAME_CHECK_PROVIDER,
      useClass: ManualNameCheckProvider,
    },
    ManualNameCheckProvider,
  ],
  exports: [PayoutAccountService, NAME_CHECK_PROVIDER, ManualNameCheckProvider],
})
export class PayoutAccountModule {}
