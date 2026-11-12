import { Body, Controller, Get, Param, Post, Req, UseGuards } from '@nestjs/common';
import { Request } from 'express';
import { JwtAuthGuard } from '../../common/auth/jwt-auth.guard';
import { JwtPayload } from '../../common/auth/jwt-payload.interface';
import { RbacGuard } from '../../common/rbac/rbac.guard';
import { RequireRoles } from '../../common/rbac/roles.decorator';
import { BypassChargeService, RaiseBypassChargeBody } from './bypass-charge.service';

type AuthedRequest = Request & { user: JwtPayload };

/** The no-bypass charge: the CEO raises it; the CEO and Finance read it and its invoice. Never a Manager (company money). */
@Controller('bypass-charges')
@UseGuards(JwtAuthGuard, RbacGuard)
export class BypassChargeController {
  constructor(private readonly charges: BypassChargeService) {}

  @Get('business/:businessId')
  @RequireRoles('ceo', 'finance')
  list(@Param('businessId') businessId: string) {
    return this.charges.list(businessId);
  }

  @Get('business/:businessId/candidates')
  @RequireRoles('ceo')
  candidates(@Param('businessId') businessId: string) {
    return this.charges.candidates(businessId, new Date());
  }

  @Post('business/:businessId')
  @RequireRoles('ceo')
  raise(@Req() req: AuthedRequest, @Param('businessId') businessId: string, @Body() body: RaiseBypassChargeBody) {
    return this.charges.raise(req.user.sub, businessId, body ?? {}, new Date());
  }

  @Post(':id/cancel')
  @RequireRoles('ceo')
  cancel(@Req() req: AuthedRequest, @Param('id') id: string, @Body() body: { reason?: unknown }) {
    return this.charges.cancel(req.user.sub, id, body ?? {}, new Date());
  }

  @Get(':id/invoice')
  @RequireRoles('ceo', 'finance')
  invoice(@Param('id') id: string) {
    return this.charges.invoice(id);
  }
}
