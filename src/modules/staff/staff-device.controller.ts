import {
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { Request } from 'express';
import { JwtAuthGuard } from '../../common/auth/jwt-auth.guard';
import { JwtPayload } from '../../common/auth/jwt-payload.interface';
import { RbacGuard } from '../../common/rbac/rbac.guard';
import { RequirePermission } from '../../common/rbac/permissions.decorator';
import { RequireRoles } from '../../common/rbac/roles.decorator';
import { DeviceActor, StaffDeviceService } from './staff-device.service';

type AuthenticatedRequest = Request & { user: JwtPayload };

@Controller('staff')
@UseGuards(JwtAuthGuard, RbacGuard)
export class StaffDeviceController {
  constructor(private readonly staffDeviceService: StaffDeviceService) {}

  private actor(user: JwtPayload): DeviceActor {
    return { id: user.sub, role: user.role };
  }

  @Get('devices/pending')
  @RequireRoles('ceo', 'manager', 'team_lead')
  listPending(@Req() req: AuthenticatedRequest) {
    return this.staffDeviceService.listPending(this.actor(req.user));
  }

  @Post('devices/:id/approve')
  @HttpCode(HttpStatus.OK)
  @RequireRoles('ceo', 'manager', 'team_lead')
  approve(@Param('id') id: string, @Req() req: AuthenticatedRequest) {
    return this.staffDeviceService.approve(id, this.actor(req.user));
  }

  @Post('devices/:id/revoke')
  @HttpCode(HttpStatus.OK)
  @RequireRoles('ceo', 'manager', 'team_lead')
  revoke(@Param('id') id: string, @Req() req: AuthenticatedRequest) {
    return this.staffDeviceService.revoke(id, this.actor(req.user));
  }

  @Get(':id/devices')
  @RequireRoles('ceo', 'manager', 'team_lead', 'call_agent', 'field_agent')
  @RequirePermission('staff', 'read')
  listForStaff(@Param('id') id: string, @Req() req: AuthenticatedRequest) {
    return this.staffDeviceService.listForStaff(id, this.actor(req.user));
  }
}
