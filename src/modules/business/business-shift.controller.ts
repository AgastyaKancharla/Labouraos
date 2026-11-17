import { Body, Controller, Delete, Get, Param, Patch, Post, Req, UseGuards } from '@nestjs/common';
import { Request } from 'express';
import { JwtAuthGuard } from '../../common/auth/jwt-auth.guard';
import { JwtPayload } from '../../common/auth/jwt-payload.interface';
import { RbacGuard } from '../../common/rbac/rbac.guard';
import { RequirePermission } from '../../common/rbac/permissions.decorator';
import { RequireRoles } from '../../common/rbac/roles.decorator';
import { BusinessShiftService } from './business-shift.service';

type Authed = Request & { user: JwtPayload };

/**
 * A business's own shifts (17 Nov, Master Guide rev 193). Reading follows the
 * business read rule; adding, changing and removing follow the business
 * write rule (RbacGuard on :id — field agent: own businesses, call agent: own
 * leads, Team Lead: own team, Manager and CEO: all); adding one follows the
 * vacancy-create rule, so a call agent can add the shift a new vacancy needs.
 */
@Controller('businesses')
@UseGuards(JwtAuthGuard, RbacGuard)
export class BusinessShiftController {
  constructor(private readonly shifts: BusinessShiftService) {}

  @Get(':id/shifts')
  @RequireRoles('field_agent', 'call_agent', 'team_lead', 'manager', 'ceo')
  @RequirePermission('business', 'read')
  list(@Param('id') id: string) {
    return this.shifts.list(id);
  }

  /**
   * Adding a shift follows the vacancy-create rule (whoever may add a vacancy to
   * this business may add the shift it needs: call agents any business, field
   * agents their account businesses, Team Leads their team's). Changing and
   * removing a shift stay under the business write rule.
   */
  @Post(':id/shifts')
  @RequireRoles('field_agent', 'call_agent', 'team_lead', 'manager', 'ceo')
  @RequirePermission('vacancy', 'write', { kind: 'business', from: 'param:id' })
  create(@Param('id') id: string, @Body() body: unknown, @Req() req: Authed) {
    return this.shifts.create(id, body, { staffId: req.user.sub });
  }

  @Patch(':id/shifts/:shiftId')
  @RequireRoles('field_agent', 'call_agent', 'team_lead', 'manager', 'ceo')
  @RequirePermission('business', 'write')
  update(@Param('id') id: string, @Param('shiftId') shiftId: string, @Body() body: unknown, @Req() req: Authed) {
    return this.shifts.update(id, shiftId, body, { staffId: req.user.sub });
  }

  @Delete(':id/shifts/:shiftId')
  @RequireRoles('field_agent', 'call_agent', 'team_lead', 'manager', 'ceo')
  @RequirePermission('business', 'write')
  remove(@Param('id') id: string, @Param('shiftId') shiftId: string, @Req() req: Authed) {
    return this.shifts.remove(id, shiftId, { staffId: req.user.sub });
  }
}
