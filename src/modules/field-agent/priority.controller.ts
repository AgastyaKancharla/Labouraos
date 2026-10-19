import {
  Controller,
  Get,
  Query,
  Req,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { Request } from 'express';
import { PriorityService } from './priority.service';
import { JwtAuthGuard } from '../../common/auth/jwt-auth.guard';
import { RbacGuard } from '../../common/rbac/rbac.guard';
import { RequirePermission } from '../../common/rbac/permissions.decorator';
import { RequireRoles } from '../../common/rbac/roles.decorator';
import { PiiMaskingInterceptor } from '../../common/rbac/pii-masking.interceptor';
import { JwtPayload } from '../../common/auth/jwt-payload.interface';

@Controller('priority')
@UseGuards(JwtAuthGuard, RbacGuard)
@UseInterceptors(PiiMaskingInterceptor)
export class PriorityController {
  constructor(private readonly priorityService: PriorityService) {}

  @Get('candidates')
  @RequireRoles('field_agent', 'call_agent', 'manager', 'ceo')
  @RequirePermission('vacancy', 'read')
  async getCandidates(
    @Req() req: Request & { user: JwtPayload },
    @Query('now') nowQuery?: string,
  ) {
    const now = nowQuery ? new Date(nowQuery) : new Date();
    return this.priorityService.getPriorityCandidates(req.user.sub, now);
  }

  @Get('vacancies')
  @RequireRoles('field_agent', 'call_agent', 'manager', 'ceo')
  @RequirePermission('vacancy', 'read')
  async getVacancies(
    @Req() req: Request & { user: JwtPayload },
    @Query('now') nowQuery?: string,
  ) {
    const now = nowQuery ? new Date(nowQuery) : new Date();
    return this.priorityService.getPriorityVacancies(req.user.sub, now);
  }

  @Get('trades')
  @RequireRoles('field_agent', 'call_agent', 'manager', 'ceo')
  @RequirePermission('vacancy', 'read')
  async getTrades(@Req() req: Request & { user: JwtPayload }) {
    return this.priorityService.getPriorityTrades(req.user.sub);
  }
}
