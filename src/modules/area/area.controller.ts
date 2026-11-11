import { Body, Controller, Get, Param, Patch, Post, Query, Req, UseGuards } from '@nestjs/common';
import { Request } from 'express';
import { JwtAuthGuard } from '../../common/auth/jwt-auth.guard';
import { JwtPayload } from '../../common/auth/jwt-payload.interface';
import { RbacGuard } from '../../common/rbac/rbac.guard';
import { RequireRoles } from '../../common/rbac/roles.decorator';
import { AreaInput, AreaService } from './area.service';

type Authed = Request & { user: JwtPayload };

/**
 * The Areas list. Everyone who fills a form reads the active areas; the CEO
 * and Managers manage the list (guide, Forms: "a list of Bengaluru areas that
 * the CEO and Managers manage in the Command Center").
 */
@Controller('areas')
@UseGuards(JwtAuthGuard, RbacGuard)
export class AreaController {
  constructor(private readonly areas: AreaService) {}

  private actor(req: Authed) {
    return { id: req.user.sub, role: req.user.role };
  }

  @Get()
  @RequireRoles('ceo', 'manager', 'team_lead', 'call_agent', 'field_agent')
  async list() {
    return { city: 'Bengaluru', areas: await this.areas.options() };
  }

  @Get('manage')
  @RequireRoles('ceo', 'manager')
  manage(@Query('search') search?: string, @Query('status') status?: string) {
    return this.areas.manage({ search, status });
  }

  @Post()
  @RequireRoles('ceo', 'manager')
  create(@Req() req: Authed, @Body() body: AreaInput) {
    return this.areas.create(this.actor(req), body ?? {});
  }

  @Patch(':id')
  @RequireRoles('ceo', 'manager')
  update(@Req() req: Authed, @Param('id') id: string, @Body() body: AreaInput) {
    return this.areas.update(this.actor(req), id, body ?? {});
  }

  @Post(':id/merge')
  @RequireRoles('ceo', 'manager')
  merge(@Req() req: Authed, @Param('id') id: string, @Body() body: { intoId?: unknown }) {
    return this.areas.merge(this.actor(req), id, body ?? {});
  }
}
