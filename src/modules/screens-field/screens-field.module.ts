import { Module } from '@nestjs/common';
import { PrismaModule } from '../../common/prisma/prisma.module';
import { PricingModule } from '../pricing/pricing.module';
import { FieldVisitModule } from '../field-visit/field-visit.module';
import { ScreensFieldController } from './screens-field.controller';
import { ScreensFieldService } from './screens-field.service';

@Module({
  imports: [PrismaModule, PricingModule, FieldVisitModule],
  controllers: [ScreensFieldController],
  providers: [ScreensFieldService],
})
export class ScreensFieldModule {}
