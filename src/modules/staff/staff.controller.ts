import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Query,
  Req,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { Request } from 'express';
import { JwtAuthGuard } from '../../common/auth/jwt-auth.guard';
import { AuthThrottlerGuard } from '../../common/auth/auth-throttler.guard';
import { JwtPayload } from '../../common/auth/jwt-payload.interface';
import { RbacGuard } from '../../common/rbac/rbac.guard';
import { RequirePermission } from '../../common/rbac/permissions.decorator';
import { RequireRoles } from '../../common/rbac/roles.decorator';
import { PiiMaskingInterceptor } from '../../common/rbac/pii-masking.interceptor';
import { StaffService } from './staff.service';
import { CreateStaffDto } from './dto/create-staff.dto';
import { AcceptInviteDto } from './dto/accept-invite.dto';
import { QueryStaffDto } from './dto/query-staff.dto';
import { BootstrapStaffDto } from './dto/bootstrap-staff.dto';

type AuthenticatedRequest = Request & { user: JwtPayload };

@Controller('staff')
@UseInterceptors(PiiMaskingInterceptor)
export class StaffController {
  constructor(private readonly staffService: StaffService) {}

  @Post()
  @UseGuards(JwtAuthGuard, RbacGuard)
  @RequirePermission('staff', 'write')
  @RequireRoles('ceo', 'manager')
  create(@Body() dto: CreateStaffDto, @Req() req: AuthenticatedRequest) {
    return this.staffService.createStaff(dto, req.user);
  }

  /**
   * Public by design: creates the very first staff account (CEO) on an empty
   * database. Permanently safe because it requires staff.count() === 0.
   */
  @Post('bootstrap')
  @UseGuards(AuthThrottlerGuard)
  @Throttle({ default: { limit: 5, ttl: 60000 } })
  bootstrap(@Body() dto: BootstrapStaffDto) {
    return this.staffService.bootstrapStaff(dto);
  }

  @Get()
  @UseGuards(JwtAuthGuard, RbacGuard)
  @RequirePermission('staff', 'read')
  @RequireRoles('ceo', 'manager')
  list(@Query() query: QueryStaffDto) {
    return this.staffService.listStaff(query);
  }

  /**
   * Public by design: the new hire has no password or session yet and proves
   * identity with the one-time invite token. Throttled like login.
   */
  @Post('accept-invite')
  @HttpCode(HttpStatus.OK)
  @UseGuards(AuthThrottlerGuard)
  @Throttle({ default: { limit: 5, ttl: 60000 } })
  acceptInvite(@Body() dto: AcceptInviteDto) {
    return this.staffService.acceptInvite(dto);
  }

  @Post(':id/deactivate')
  @HttpCode(HttpStatus.OK)
  @UseGuards(JwtAuthGuard, RbacGuard)
  @RequirePermission('staff', 'write')
  @RequireRoles('ceo', 'manager')
  deactivate(@Param('id') id: string, @Req() req: AuthenticatedRequest) {
    return this.staffService.deactivateStaff(id, req.user);
  }
}
