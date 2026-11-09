import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../../common/auth/jwt-auth.guard';
import { RbacGuard } from '../../common/rbac/rbac.guard';
import { RequireRoles } from '../../common/rbac/roles.decorator';
import { StatusHistoryService } from './status-history.service';

@Controller('status-history')
@UseGuards(JwtAuthGuard, RbacGuard)
export class StatusHistoryController {
  constructor(private readonly statusHistoryService: StatusHistoryService) {}

  @Get()
  @RequireRoles('ceo', 'manager', 'team_lead')
  async getHistory(
    @Query('subjectType') subjectType?: string,
    @Query('subjectId') subjectId?: string,
  ) {
    return this.statusHistoryService.getHistory(subjectType, subjectId);
  }
}
