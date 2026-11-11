import { Controller, Get, Query, Req, Res, UseGuards } from '@nestjs/common';
import { Request, Response } from 'express';
import { JwtAuthGuard } from '../../common/auth/jwt-auth.guard';
import { RbacGuard } from '../../common/rbac/rbac.guard';
import { RequireRoles } from '../../common/rbac/roles.decorator';
import { JwtPayload } from '../../common/auth/jwt-payload.interface';
import { PriorityQuery, RefundPriorityService } from './refund-priority.service';

type AuthedRequest = Request & { user: JwtPayload };

@Controller('close-to-refund')
@UseGuards(JwtAuthGuard, RbacGuard)
export class RefundPriorityController {
  constructor(private readonly priority: RefundPriorityService) {}

  /**
   * GET /close-to-refund — the close-to-refund list (Phase 21 Task 7): CEO and
   * Finance everything with rupees; a Manager their tree, a Team Lead their
   * team, an agent their own people, all without rupees. `format=csv`
   * downloads it (CEO, Finance and Managers only).
   */
  @Get()
  @RequireRoles('ceo', 'finance', 'manager', 'team_lead', 'call_agent', 'field_agent')
  async list(
    @Req() req: AuthedRequest,
    @Res({ passthrough: true }) res: Response,
    @Query() query: PriorityQuery & { format?: string },
  ) {
    const actor = { id: req.user.sub, role: req.user.role };
    if (query.format !== 'csv') return this.priority.list(actor, query);
    const csv = await this.priority.csv(actor, query);
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="close-to-refund.csv"');
    return csv;
  }
}
