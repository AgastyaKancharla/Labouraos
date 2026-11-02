import { Module } from '@nestjs/common';
import { PrismaModule } from '../../common/prisma/prisma.module';
import { PricingModule } from '../pricing/pricing.module';
import { RefundController } from './refund.controller';
import { RefundService } from './refund.service';

@Module({
  imports: [PrismaModule, PricingModule],
  controllers: [RefundController],
  providers: [RefundService],
  exports: [RefundService],
})
export class RefundModule {}
