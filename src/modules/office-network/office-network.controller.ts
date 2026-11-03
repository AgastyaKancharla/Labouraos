import {
  Body,
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
import { RequireRoles } from '../../common/rbac/roles.decorator';
import { OfficeNetworkService } from './office-network.service';

type AuthenticatedRequest = Request & { user: JwtPayload };

@Controller()
@UseGuards(JwtAuthGuard, RbacGuard)
@RequireRoles('ceo', 'manager')
export class OfficeNetworkController {
  constructor(private readonly officeNetworkService: OfficeNetworkService) {}

  private actor(req: AuthenticatedRequest) {
    return { id: req.user.sub, role: req.user.role };
  }

  @Get('office-networks')
  list(@Req() req: AuthenticatedRequest) {
    return this.officeNetworkService.list(this.actor(req));
  }

  @Get('office-networks/check')
  check(@Req() req: AuthenticatedRequest) {
    const ip = this.officeNetworkService.requestIp(req);
    return this.officeNetworkService.describeRequest(this.actor(req), ip);
  }

  @Post('office-networks')
  add(
    @Req() req: AuthenticatedRequest,
    @Body() body: { label?: string; cidr?: string },
  ) {
    return this.officeNetworkService.add(this.actor(req), body?.label ?? '', body?.cidr ?? '');
  }

  @Post('office-networks/:id/deactivate')
  @HttpCode(HttpStatus.OK)
  deactivate(@Param('id') id: string, @Req() req: AuthenticatedRequest) {
    return this.officeNetworkService.deactivate(this.actor(req), id);
  }

  @Post('staff/:id/works-from-office')
  @HttpCode(HttpStatus.OK)
  setWorksFromOffice(
    @Param('id') id: string,
    @Req() req: AuthenticatedRequest,
    @Body() body: { worksFromOffice?: boolean },
  ) {
    return this.officeNetworkService.setWorksFromOffice(
      this.actor(req),
      id,
      body?.worksFromOffice as boolean,
    );
  }
}
