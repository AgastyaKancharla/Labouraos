import {
  Body,
  Controller,
  Get,
  Post,
  Query,
  Req,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { Request } from 'express';
import { FieldAgentService } from './field-agent.service';
import { JwtAuthGuard } from '../../common/auth/jwt-auth.guard';
import { RbacGuard } from '../../common/rbac/rbac.guard';
import { RequirePermission } from '../../common/rbac/permissions.decorator';
import { RequireRoles } from '../../common/rbac/roles.decorator';
import { PiiMaskingInterceptor } from '../../common/rbac/pii-masking.interceptor';
import { JwtPayload } from '../../common/auth/jwt-payload.interface';
import { BusinessVerificationService, CheckInDto } from '../business/business-verification.service';

@Controller('field-agent')
@UseGuards(JwtAuthGuard, RbacGuard)
@UseInterceptors(PiiMaskingInterceptor)
export class FieldAgentController {
  constructor(
    private readonly fieldAgentService: FieldAgentService,
    private readonly verificationService: BusinessVerificationService,
  ) {}

  @Post('check-in')
  @RequireRoles('field_agent')
  async checkIn(@Body() body: CheckInDto, @Req() req: Request & { user: JwtPayload }) {
    return this.verificationService.checkIn(req.user.sub, body);
  }

  @Get('priority-dashboard')
  @RequireRoles('field_agent', 'call_agent', 'manager', 'ceo', 'team_lead')
  @RequirePermission('vacancy', 'read')
  async getPriorityDashboard(
    @Req() req: Request & { user: JwtPayload },
    @Query('now') nowQuery?: string,
  ) {
    const now = nowQuery ? new Date(nowQuery) : new Date();
    return this.fieldAgentService.getPriorityDashboard(req.user.sub, now);
  }
}
