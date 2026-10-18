import { Module } from '@nestjs/common';
import { PrismaModule } from '../common/prisma/prisma.module';
import { JobSeekerModule } from '../modules/job-seeker/job-seeker.module';
import { NoPickupEvaluationJob } from './no-pickup-evaluation.job';

@Module({
  imports: [PrismaModule, JobSeekerModule],
  providers: [NoPickupEvaluationJob],
  exports: [NoPickupEvaluationJob],
})
export class JobsModule {}

