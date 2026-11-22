import { Module } from '@nestjs/common';
import { JobSeekerModule } from '../job-seeker/job-seeker.module';
import { ScreensManagerModule } from '../screens-manager/screens-manager.module';
import { ScreensTeamLeadModule } from '../screens-team-lead/screens-team-lead.module';
import { ProfileStuckController } from './profile-stuck.controller';
import { ProfileStuckService } from './profile-stuck.service';

/** "Where they're stuck" on every profile (21 Nov, rev 204). */
@Module({
  imports: [JobSeekerModule, ScreensManagerModule, ScreensTeamLeadModule],
  controllers: [ProfileStuckController],
  providers: [ProfileStuckService],
  // Laboura Field lists (22 Nov) use the same steps for the field agent's own job seekers.
  exports: [ProfileStuckService],
})
export class ProfileStuckModule {}
