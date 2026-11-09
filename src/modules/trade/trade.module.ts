import { Module } from '@nestjs/common';
import { PrismaModule } from '../../common/prisma/prisma.module';
import { AuditModule } from '../../common/audit/audit.module';
import { PricingModule } from '../pricing/pricing.module';
import { TradeController } from './trade.controller';
import { TradeService } from './trade.service';

@Module({
  imports: [PrismaModule, AuditModule, PricingModule],
  controllers: [TradeController],
  providers: [TradeService],
  exports: [TradeService],
})
export class TradeModule {}
