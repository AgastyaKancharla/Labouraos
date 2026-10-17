import { Controller, Get, UseGuards } from '@nestjs/common';
import { JobSeekerService } from './job-seeker.service';
import { JwtAuthGuard } from '../../common/auth/jwt-auth.guard';
import { RbacGuard } from '../../common/rbac/rbac.guard';
import { RequirePermission } from '../../common/rbac/permissions.decorator';

@Controller('job-seekers')
@UseGuards(JwtAuthGuard, RbacGuard)
export class JobSeekerController {
  constructor(private readonly jobSeekerService: JobSeekerService) {}

  @Get()
  @RequirePermission('job_seeker', 'read')
  async findAll() {
    return this.jobSeekerService.findAll();
  }
}
