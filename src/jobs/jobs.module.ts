import { Module } from '@nestjs/common';
import { PrismaModule } from '../common/prisma/prisma.module';
import { JobSeekerModule } from '../modules/job-seeker/job-seeker.module';
import { AuthModule } from '../common/auth/auth.module';
import { AuditModule } from '../common/audit/audit.module';
import { NoPickupEvaluationJob } from './no-pickup-evaluation.job';
import { SweepMonitoringService } from './sweep-monitoring.service';
import { JobsController } from './jobs.controller';
import { MessageModule } from '../modules/message/message.module';
import { VacancyModule } from '../modules/vacancy/vacancy.module';
import { InterviewReplyJob } from './interview-reply.job';
import { PlacementCompletionJob } from './placement-completion.job';
import { ClaimOverdueJob } from './claim-overdue.job';
import { FollowUpJob } from './follow-up.job';
import { PlacementModule } from '../modules/placement/placement.module';
import { FollowUpModule } from '../modules/follow-up/follow-up.module';

@Module({
  imports: [PrismaModule, JobSeekerModule, AuthModule, AuditModule, MessageModule, VacancyModule, PlacementModule, FollowUpModule],
  controllers: [JobsController],
  providers: [NoPickupEvaluationJob, SweepMonitoringService, InterviewReplyJob, PlacementCompletionJob, ClaimOverdueJob, FollowUpJob],
  exports: [NoPickupEvaluationJob, SweepMonitoringService, PlacementCompletionJob, ClaimOverdueJob, FollowUpJob],
})
export class JobsModule {}

