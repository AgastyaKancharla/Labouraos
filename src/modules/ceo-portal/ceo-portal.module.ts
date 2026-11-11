import { Module } from '@nestjs/common';
import { PrismaModule } from '../../common/prisma/prisma.module';
import { AuditModule } from '../../common/audit/audit.module';
import { IdModule } from '../../common/id/id.module';
import { PricingModule } from '../pricing/pricing.module';
import { RefundModule } from '../refund/refund.module';
import { TargetModule } from '../target/target.module';
import { CeoPortalController } from './ceo-portal.controller';
import { CeoCommandCenterService } from './ceo-command-center.service';
import { CeoJobSeekersService } from './ceo-job-seekers.service';
import { CeoBusinessesService } from './ceo-businesses.service';
import { CeoPlacementsService } from './ceo-placements.service';
import { CeoMoneyService } from './ceo-money.service';

@Module({
  imports: [PrismaModule, AuditModule, IdModule, PricingModule, RefundModule, TargetModule],
  controllers: [CeoPortalController],
  providers: [CeoCommandCenterService, CeoJobSeekersService, CeoBusinessesService, CeoPlacementsService, CeoMoneyService],
})
export class CeoPortalModule {}
