import { Body, Controller, Delete, Get, Param, Patch, Post, Put, Query, Req, UseGuards } from '@nestjs/common';
import { Request } from 'express';
import { JwtAuthGuard } from '../../common/auth/jwt-auth.guard';
import { RequireRoles } from '../../common/rbac/roles.decorator';
import { RbacGuard } from '../../common/rbac/rbac.guard';
import { JwtPayload } from '../../common/auth/jwt-payload.interface';
import { HolidayService } from './holiday.service';

type Authed = Request & { user: JwtPayload };
type HolidayBody = { date?: string; name?: string };

/** Public holidays. Everyone reads the list; only the CEO changes it. */
@Controller('attendance/holidays')
@UseGuards(JwtAuthGuard, RbacGuard)
export class HolidayController {
  constructor(private readonly holidays: HolidayService) {}

  private actor(req: Authed) {
    return { id: req.user.sub, role: req.user.role };
  }

  @Get()
  @RequireRoles('ceo', 'manager', 'team_lead', 'call_agent', 'field_agent', 'finance')
  list(@Query('year') year?: string) {
    return this.holidays.list(year);
  }

  @Put(':year')
  @RequireRoles('ceo')
  setYear(@Req() req: Authed, @Param('year') year: string, @Body() body: { holidays?: HolidayBody[] }) {
    return this.holidays.setYear(this.actor(req), year, body ?? {});
  }

  @Post()
  @RequireRoles('ceo')
  add(@Req() req: Authed, @Body() body: HolidayBody) {
    return this.holidays.add(this.actor(req), body ?? {});
  }

  @Patch(':id')
  @RequireRoles('ceo')
  update(@Req() req: Authed, @Param('id') id: string, @Body() body: HolidayBody) {
    return this.holidays.update(this.actor(req), id, body ?? {});
  }

  @Delete(':id')
  @RequireRoles('ceo')
  remove(@Req() req: Authed, @Param('id') id: string) {
    return this.holidays.remove(this.actor(req), id);
  }
}
