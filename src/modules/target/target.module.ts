import { Module } from '@nestjs/common';
import { TargetService } from './target.service';
import { CallAgentMetricsService } from './call-agent-metrics.service';
import { TargetController } from './target.controller';
import { PrismaModule } from '../../common/prisma/prisma.module';
import { AuditModule } from '../../common/audit/audit.module';

@Module({
  imports: [PrismaModule, AuditModule],
  controllers: [TargetController],
  providers: [TargetService, CallAgentMetricsService],
  exports: [TargetService, CallAgentMetricsService],
})
export class TargetModule {}
