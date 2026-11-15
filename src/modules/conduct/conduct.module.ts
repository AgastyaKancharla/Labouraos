import { Module } from '@nestjs/common';
import { PrismaModule } from '../../common/prisma/prisma.module';
import { AuditModule } from '../../common/audit/audit.module';
import { ConsentClock } from '../consent/consent-clock';
import { ConductController } from './conduct.controller';
import { ConductService } from './conduct.service';

@Module({
  imports: [PrismaModule, AuditModule],
  controllers: [ConductController],
  providers: [ConductService, ConsentClock],
  exports: [ConductService],
})
export class ConductModule {}
