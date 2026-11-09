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
import { PatternFlagsJob } from './pattern-flags.job';
import { JoiningRewardJob } from './joining-reward.job';
import { RetentionCleanupJob } from './retention-cleanup.job';
import { PlacementModule } from '../modules/placement/placement.module';
import { FollowUpModule } from '../modules/follow-up/follow-up.module';
import { ReviewFlagModule } from '../modules/review-flag/review-flag.module';
import { RetentionModule } from '../modules/retention/retention.module';

@Module({
  imports: [PrismaModule, JobSeekerModule, AuthModule, AuditModule, MessageModule, VacancyModule, PlacementModule, FollowUpModule, ReviewFlagModule, RetentionModule],
  controllers: [JobsController],
  providers: [NoPickupEvaluationJob, SweepMonitoringService, InterviewReplyJob, PlacementCompletionJob, ClaimOverdueJob, FollowUpJob, PatternFlagsJob, JoiningRewardJob, RetentionCleanupJob],
  exports: [NoPickupEvaluationJob, SweepMonitoringService, PlacementCompletionJob, ClaimOverdueJob, FollowUpJob, PatternFlagsJob, JoiningRewardJob, RetentionCleanupJob],
})
export class JobsModule {}

