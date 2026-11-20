import { Body, Controller, HttpCode, Post, Req, UseGuards } from '@nestjs/common';
import { Request } from 'express';
import { JwtAuthGuard } from '../../common/auth/jwt-auth.guard';
import { JwtPayload } from '../../common/auth/jwt-payload.interface';
import { RbacGuard } from '../../common/rbac/rbac.guard';
import { RequireRoles } from '../../common/rbac/roles.decorator';
import { MapsLinkService } from './maps-link.service';

type Authed = Request & { user: JwtPayload };

/** "Paste Google Maps link" on the Field business form (17 Nov): pin + address, editable by the agent. */
@Controller('maps-link')
@UseGuards(JwtAuthGuard, RbacGuard)
export class MapsLinkController {
  constructor(private readonly maps: MapsLinkService) {}

  @Post('resolve')
  @HttpCode(200)
  @RequireRoles('field_agent')
  resolve(@Req() req: Authed, @Body() body: { url?: unknown }) {
    return this.maps.resolve(req.user.sub, body?.url);
  }
}
