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
import { JwtAuthGuard } from '../../common/auth/jwt-auth.guard';
import { RbacGuard } from '../../common/rbac/rbac.guard';
import { RequireRoles } from '../../common/rbac/roles.decorator';
import { RequirePermission } from '../../common/rbac/permissions.decorator';
import { JwtPayload } from '../../common/auth/jwt-payload.interface';
import { PiiMaskingInterceptor } from '../../common/rbac/pii-masking.interceptor';
import { JobSeekerService } from './job-seeker.service';
import { ReverseHitDto } from './dto/record-hit.dto';

@Controller('job-seeker-hits')
@UseGuards(JwtAuthGuard, RbacGuard)
@UseInterceptors(PiiMaskingInterceptor)
export class JobSeekerHitController {
  constructor(private readonly jobSeekerService: JobSeekerService) {}

  @Post(':id/reverse')
  @RequireRoles('team_lead', 'manager', 'ceo')
  @RequirePermission('job_seeker', 'write')
  async reverseHit(
    @Param('id') id: string,
    @Body() body: ReverseHitDto,
    @Req() req: Request & { user: JwtPayload },
  ) {
    return this.jobSeekerService.reverseHit(id, body.reversalReason, req.user.sub, req.user.role);
  }

  @Get(':id')
  @RequireRoles('call_agent', 'manager', 'ceo', 'field_agent', 'team_lead', 'finance')
  @RequirePermission('job_seeker', 'read')
  async getHit(@Param('id') id: string) {
    return this.jobSeekerService.getHit(id);
  }
}
