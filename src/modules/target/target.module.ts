import { Module } from '@nestjs/common';
import { TargetService } from './target.service';
import { CallAgentMetricsService } from './call-agent-metrics.service';
import { FieldAgentMetricsService } from './field-agent-metrics.service';
import { MoneyAtRiskService } from './money-at-risk.service';
import { TargetOverviewService } from './target-overview.service';
import { LeaderboardService } from './leaderboard.service';
import { TargetController } from './target.controller';
import { PrismaModule } from '../../common/prisma/prisma.module';
import { AuditModule } from '../../common/audit/audit.module';
import { PricingModule } from '../pricing/pricing.module';
import { ReportingScopeModule } from '../staff/reporting-scope.module';

@Module({
  imports: [PrismaModule, AuditModule, PricingModule, ReportingScopeModule],
  controllers: [TargetController],
  providers: [
    TargetService,
    CallAgentMetricsService,
    FieldAgentMetricsService,
    MoneyAtRiskService,
    TargetOverviewService,
    LeaderboardService,
  ],
  exports: [
    TargetService,
    CallAgentMetricsService,
    FieldAgentMetricsService,
    MoneyAtRiskService,
    TargetOverviewService,
    LeaderboardService,
  ],
})
export class TargetModule {}
