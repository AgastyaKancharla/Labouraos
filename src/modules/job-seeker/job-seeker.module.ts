import { Module } from '@nestjs/common';
import { JobSeekerController } from './job-seeker.controller';
import { JobSeekerService } from './job-seeker.service';

@Module({
  controllers: [JobSeekerController],
  providers: [JobSeekerService],
  exports: [JobSeekerService],
})
export class JobSeekerModule {}
