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
import { FieldSellingModule } from '../modules/field-selling/field-selling.module';
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
import { KycHealthModule } from '../common/kyc/kyc-health.module';
import { KycRecoveryJob } from './kyc-recovery.job';
import { AttendanceModule } from '../modules/attendance/attendance.module';
import { ForgottenLogoutJob } from './forgotten-logout.job';
import { WorkerHeartbeatService } from './worker-heartbeat.service';
import { GrowthModule } from '../modules/growth/growth.module';
import { ShortageTasksJob } from './shortage-tasks.job';
import { WinBackJob } from './win-back.job';
import { NotificationSweepJob } from './notification-sweep.job';
import { NotificationModule } from '../modules/notification/notification.module';
import { RefundPriorityModule } from '../modules/refund-priority/refund-priority.module';
import { WeeklyReportModule } from '../modules/weekly-report/weekly-report.module';
import { WeeklyReportJob } from './weekly-report.job';
import { JobScheduleKeeper } from './job-schedule-keeper.service';
import { JobRunNowController } from './job-run-now.controller';

@Module({
  imports: [PrismaModule, JobSeekerModule, AuthModule, AuditModule, MessageModule, VacancyModule, PlacementModule, FollowUpModule, ReviewFlagModule, RetentionModule, KycHealthModule, AttendanceModule, GrowthModule, NotificationModule, RefundPriorityModule, FieldSellingModule, WeeklyReportModule],
  controllers: [JobsController, JobRunNowController],
  providers: [NoPickupEvaluationJob, SweepMonitoringService, InterviewReplyJob, PlacementCompletionJob, ClaimOverdueJob, FollowUpJob, PatternFlagsJob, JoiningRewardJob, RetentionCleanupJob, KycRecoveryJob, ForgottenLogoutJob, WorkerHeartbeatService, ShortageTasksJob, WinBackJob, NotificationSweepJob, WeeklyReportJob, JobScheduleKeeper],
  exports: [NoPickupEvaluationJob, SweepMonitoringService, PlacementCompletionJob, ClaimOverdueJob, FollowUpJob, PatternFlagsJob, JoiningRewardJob, RetentionCleanupJob, KycRecoveryJob, ForgottenLogoutJob, ShortageTasksJob, WinBackJob, NotificationSweepJob, WeeklyReportJob, JobScheduleKeeper],
})
export class JobsModule {}

