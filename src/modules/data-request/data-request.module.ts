import { Module } from '@nestjs/common';
import { PrismaModule } from '../../common/prisma/prisma.module';
import { IdModule } from '../../common/id/id.module';
import { AuditModule } from '../../common/audit/audit.module';
import { DataRequestController } from './data-request.controller';
import { DataRequestClock, DataRequestService } from './data-request.service';

@Module({
  imports: [PrismaModule, IdModule, AuditModule],
  controllers: [DataRequestController],
  providers: [DataRequestService, DataRequestClock],
  exports: [DataRequestService],
})
export class DataRequestModule {}
