import { Module } from '@nestjs/common';
import { PrismaModule } from '../../common/prisma/prisma.module';
import { ReportingScopeModule } from '../staff/reporting-scope.module';
import { StatusHistoryController } from './status-history.controller';
import { StatusHistoryService } from './status-history.service';

@Module({
  imports: [PrismaModule, ReportingScopeModule],
  controllers: [StatusHistoryController],
  providers: [StatusHistoryService],
  exports: [StatusHistoryService],
})
export class StatusHistoryModule {}
