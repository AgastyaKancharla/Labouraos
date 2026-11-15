import { Module } from '@nestjs/common';
import { PrismaModule } from '../../common/prisma/prisma.module';
import { PricingModule } from '../pricing/pricing.module';
import { LegalController } from './legal.controller';
import { LegalDocumentService } from './legal-document.service';

@Module({
  imports: [PrismaModule, PricingModule],
  controllers: [LegalController],
  providers: [LegalDocumentService],
  exports: [LegalDocumentService],
})
export class LegalModule {}
