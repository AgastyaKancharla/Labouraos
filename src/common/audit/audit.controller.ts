import { Controller, Get, Param, Query, UseGuards } from '@nestjs/common';
import { AuditService } from './audit.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RbacGuard } from '../rbac/rbac.guard';
import { RequirePermission } from '../rbac/permissions.decorator';

@Controller('audit-logs')
@UseGuards(JwtAuthGuard, RbacGuard)
export class AuditController {
  constructor(private readonly auditService: AuditService) {}

  @Get()
  @RequirePermission('staff', 'read')
  async getAuditLogs(
    @Query('entityType') entityType?: string,
    @Query('entityCode') entityCode?: string,
  ) {
    return this.auditService.getLogs({ entityType, entityCode });
  }

  @Get(':id')
  @RequirePermission('staff', 'read')
  async getAuditLogById(@Param('id') id: string) {
    return this.auditService.getLogById(id);
  }

  // NOTE: Audit rows are strictly append-only.
  // There are deliberately NO PUT, PATCH, or DELETE routes in this controller or any other controller.
}
