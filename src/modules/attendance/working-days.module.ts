import { Module } from '@nestjs/common';
import { PrismaModule } from '../../common/prisma/prisma.module';
import { PricingModule } from '../pricing/pricing.module';
import { WorkingDaysService } from './working-days.service';

@Module({
  imports: [PrismaModule, PricingModule],
  providers: [WorkingDaysService],
  exports: [WorkingDaysService],
})
export class WorkingDaysModule {}
