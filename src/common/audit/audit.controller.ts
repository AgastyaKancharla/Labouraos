import {
  Controller,
  Get,
  NotFoundException,
  Param,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { Request } from 'express';
import { AuditScope, AuditService } from './audit.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { JwtPayload } from '../auth/jwt-payload.interface';
import { RbacGuard } from '../rbac/rbac.guard';
import { RequireRoles } from '../rbac/roles.decorator';
import { ReportingScopeService } from '../../modules/staff/reporting-scope.service';

type AuthenticatedRequest = Request & { user: JwtPayload };

/**
 * The CEO sees every audit row. A Manager sees only actions by, or on, staff
 * in their own reporting tree; a Team Lead only their own team (Master Guide,
 * CEO and founders vs. Manager).
 */
@Controller('audit-logs')
@UseGuards(JwtAuthGuard, RbacGuard)
export class AuditController {
  constructor(
    private readonly auditService: AuditService,
    private readonly reportingScope: ReportingScopeService,
  ) {}

  @Get()
  @RequireRoles('ceo', 'manager', 'team_lead')
  async getAuditLogs(
    @Req() req: AuthenticatedRequest,
    @Query('entityType') entityType?: string,
    @Query('entityCode') entityCode?: string,
  ) {
    const scope = await this.scopeFor(req.user);
    return this.auditService.getLogs({ entityType, entityCode }, scope);
  }

  @Get(':id')
  @RequireRoles('ceo', 'manager', 'team_lead')
  async getAuditLogById(@Param('id') id: string, @Req() req: AuthenticatedRequest) {
    const scope = await this.scopeFor(req.user);
    if (!scope) {
      return this.auditService.getLogById(id);
    }
    const row = await this.auditService.getLogById(id, scope);
    if (!row) {
      throw new NotFoundException('Audit row not found');
    }
    return row;
  }

  /** null means everything (the CEO). */
  private async scopeFor(actor: JwtPayload): Promise<AuditScope | null> {
    if (actor.role === 'ceo') {
      return null;
    }
    const under = await this.reportingScope.peopleUnder(actor.sub);
    return this.auditService.scopeForStaff([actor.sub, ...under]);
  }

  // NOTE: Audit rows are strictly append-only.
  // There are deliberately NO PUT, PATCH, or DELETE routes in this controller or any other controller.
}
