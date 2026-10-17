import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Req,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { Request } from 'express';
import { JobSeekerService } from './job-seeker.service';
import { JwtAuthGuard } from '../../common/auth/jwt-auth.guard';
import { RbacGuard } from '../../common/rbac/rbac.guard';
import { RequirePermission } from '../../common/rbac/permissions.decorator';
import { RequireRoles } from '../../common/rbac/roles.decorator';
import { PiiMaskingInterceptor } from '../../common/rbac/pii-masking.interceptor';
import { JwtPayload } from '../../common/auth/jwt-payload.interface';
import { CreateJobSeekerDto } from './dto/create-job-seeker.dto';

@Controller('job-seekers')
@UseGuards(JwtAuthGuard, RbacGuard)
@UseInterceptors(PiiMaskingInterceptor)
export class JobSeekerController {
  constructor(private readonly jobSeekerService: JobSeekerService) {}

  @Post()
  @RequireRoles('call_agent', 'manager', 'ceo')
  @RequirePermission('job_seeker', 'write')
  async create(
    @Body() body: CreateJobSeekerDto,
    @Req() req: Request & { user: JwtPayload },
  ) {
    return this.jobSeekerService.create(body, req.user.sub);
  }

  @Get()
  @RequirePermission('job_seeker', 'read')
  async findAll() {
    return this.jobSeekerService.findAll();
  }

  @Get(':id')
  @RequirePermission('job_seeker', 'read')
  async findById(@Param('id') id: string) {
    return this.jobSeekerService.findById(id);
  }

  @Post(':id/activation-payment')
  @RequireRoles('call_agent', 'manager', 'ceo')
  @RequirePermission('job_seeker', 'write')
  async createActivationPayment(@Param('id') id: string) {
    return this.jobSeekerService.createActivationPayment(id);
  }
}
