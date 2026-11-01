import { Module } from '@nestjs/common';
import { TargetService } from './target.service';
import { CallAgentMetricsService } from './call-agent-metrics.service';
import { FieldAgentMetricsService } from './field-agent-metrics.service';
import { MoneyAtRiskService } from './money-at-risk.service';
import { TargetController } from './target.controller';
import { PrismaModule } from '../../common/prisma/prisma.module';
import { AuditModule } from '../../common/audit/audit.module';

@Module({
  imports: [PrismaModule, AuditModule],
  controllers: [TargetController],
  providers: [
    TargetService,
    CallAgentMetricsService,
    FieldAgentMetricsService,
    MoneyAtRiskService,
  ],
  exports: [
    TargetService,
    CallAgentMetricsService,
    FieldAgentMetricsService,
    MoneyAtRiskService,
  ],
})
export class TargetModule {}
