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
import { RecordHitDto } from './dto/record-hit.dto';
import { ApproveJobSeekerRefundDto } from './dto/approve-refund.dto';

@Controller('job-seekers')
@UseGuards(JwtAuthGuard, RbacGuard)
@UseInterceptors(PiiMaskingInterceptor)
export class JobSeekerController {
  constructor(private readonly jobSeekerService: JobSeekerService) {}

  /**
   * ANTI-FRAUD NOTE: Candidate onboarding already carries mobile-number OTP verification,
   * which is the control that makes field-agent candidate capture safe.
   * Do not remove or weaken it, and do not add a bypass for field agents.
   */
  @Post()
  @RequireRoles('call_agent', 'manager', 'ceo', 'field_agent', 'team_lead')
  @RequirePermission('job_seeker', 'write')
  async create(
    @Body() body: CreateJobSeekerDto,
    @Req() req: Request & { user: JwtPayload },
  ) {
    return this.jobSeekerService.create(body, req.user.sub);
  }

  @Get()
  @RequireRoles('call_agent', 'manager', 'ceo', 'finance', 'field_agent', 'team_lead')
  @RequirePermission('job_seeker', 'read')
  async findAll() {
    return this.jobSeekerService.findAll();
  }

  @Get(':id')
  @RequireRoles('call_agent', 'manager', 'ceo', 'finance', 'field_agent', 'team_lead')
  @RequirePermission('job_seeker', 'read')
  async findById(@Param('id') id: string) {
    return this.jobSeekerService.findById(id);
  }

  @Post(':id/activation-payment')
  @RequireRoles('call_agent', 'manager', 'ceo', 'field_agent', 'team_lead')
  @RequirePermission('job_seeker', 'write')
  async createActivationPayment(
    @Param('id') id: string,
    @Req() req: Request & { user?: JwtPayload },
  ) {
    return this.jobSeekerService.createActivationPayment(id, req.user?.sub);
  }

  @Post(':id/kyc')
  @RequireRoles('call_agent', 'manager', 'ceo', 'field_agent', 'team_lead')
  @RequirePermission('job_seeker', 'write')
  async submitKyc(
    @Param('id') id: string,
    @Body() body: Record<string, unknown>,
    @Req() req: Request & { user: JwtPayload },
  ) {
    return this.jobSeekerService.updateKyc(id, body, req.user.sub);
  }

  @Post(':id/hits')
  @RequireRoles('call_agent', 'manager', 'ceo', 'field_agent', 'team_lead')
  @RequirePermission('job_seeker', 'write')
  async recordHit(
    @Param('id') id: string,
    @Body() body: RecordHitDto,
    @Req() req: Request & { user: JwtPayload },
  ) {
    return this.jobSeekerService.recordHit(
      id,
      body.reason,
      body.note,
      req.user.sub,
      req.user.role,
    );
  }

  @Post(':id/reactivate')
  @RequireRoles('call_agent', 'manager', 'ceo', 'field_agent', 'team_lead')
  @RequirePermission('job_seeker', 'write')
  async reactivate(
    @Param('id') id: string,
    @Req() req: Request & { user: JwtPayload },
  ) {
    return this.jobSeekerService.reactivate(id, req.user.sub);
  }

  @Post(':id/refund')
  @RequireRoles('ceo', 'manager')
  @RequirePermission('payment', 'write')
  async approveRefund(
    @Param('id') id: string,
    @Body() body: ApproveJobSeekerRefundDto,
    @Req() req: Request & { user: JwtPayload },
  ) {
    return this.jobSeekerService.approveRefund(id, body, req.user.sub);
  }

  @Post(':id/erase')
  @RequireRoles('ceo', 'manager')
  @RequirePermission('job_seeker', 'write')
  async erase(
    @Param('id') id: string,
    @Req() req: Request & { user: JwtPayload },
  ) {
    return this.jobSeekerService.erase(id, req.user.sub);
  }
}



