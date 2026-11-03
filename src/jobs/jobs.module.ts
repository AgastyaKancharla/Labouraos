import { Module } from '@nestjs/common';
import { PrismaModule } from '../common/prisma/prisma.module';
import { JobSeekerModule } from '../modules/job-seeker/job-seeker.module';
import { AuthModule } from '../common/auth/auth.module';
import { AuditModule } from '../common/audit/audit.module';
import { NoPickupEvaluationJob } from './no-pickup-evaluation.job';
import { SweepMonitoringService } from './sweep-monitoring.service';
import { JobsController } from './jobs.controller';
import { MessageModule } from '../modules/message/message.module';

@Module({
  imports: [PrismaModule, JobSeekerModule, AuthModule, AuditModule, MessageModule],
  controllers: [JobsController],
  providers: [NoPickupEvaluationJob, SweepMonitoringService],
  exports: [NoPickupEvaluationJob, SweepMonitoringService],
})
export class JobsModule {}

