import { Module } from '@nestjs/common';
import { PrismaModule } from '../../common/prisma/prisma.module';
import { ConsentService } from './consent.service';
import { ConsentClock } from './consent-clock';

@Module({
  imports: [PrismaModule],
  providers: [ConsentService, ConsentClock],
  exports: [ConsentService, ConsentClock],
})
export class ConsentModule {}
