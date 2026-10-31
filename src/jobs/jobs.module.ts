import { Module } from '@nestjs/common';
import { PrismaModule } from '../common/prisma/prisma.module';
import { JobSeekerModule } from '../modules/job-seeker/job-seeker.module';
import { AuthModule } from '../common/auth/auth.module';
import { AuditModule } from '../common/audit/audit.module';
import { NoPickupEvaluationJob } from './no-pickup-evaluation.job';
import { JobsController } from './jobs.controller';

@Module({
  imports: [PrismaModule, JobSeekerModule, AuthModule, AuditModule],
  controllers: [JobsController],
  providers: [NoPickupEvaluationJob],
  exports: [NoPickupEvaluationJob],
})
export class JobsModule {}

