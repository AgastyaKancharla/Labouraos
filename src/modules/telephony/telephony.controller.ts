import {
  Body,
  Controller,
  Get,
  Headers,
  Param,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { Request } from 'express';
import { TelephonyService } from './telephony.service';
import { JwtAuthGuard } from '../../common/auth/jwt-auth.guard';
import { RbacGuard } from '../../common/rbac/rbac.guard';
import { RequirePermission } from '../../common/rbac/permissions.decorator';
import { RequireRoles } from '../../common/rbac/roles.decorator';
import { JwtPayload } from '../../common/auth/jwt-payload.interface';
import { Public } from '../../common/rbac/public.decorator';

@Controller('telephony')
export class TelephonyController {
  constructor(private readonly telephonyService: TelephonyService) {}

  @Post('inbound')
  @Public('webhook: the sender is checked by its signature, not a staff login')
  async handleInboundWebhook(
    @Body() body: Record<string, unknown>,
    @Req() req: Request & { rawBody?: Buffer },
    @Headers('x-telephony-signature') sig1?: string,
    @Headers('x-signature') sig2?: string,
  ) {
    const signature = sig1 || sig2;
    return this.telephonyService.handleInboundWebhook(body, signature, req.rawBody);
  }

  @Post('webhook/missed-call')
  @Public('webhook: the sender is checked by its signature, not a staff login')
  async handleMissedCallWebhook(
    @Body() body: Record<string, unknown>,
    @Req() req: Request & { rawBody?: Buffer },
    @Headers('x-telephony-signature') sig1?: string,
    @Headers('x-signature') sig2?: string,
  ) {
    const signature = sig1 || sig2;
    return this.telephonyService.handleInboundWebhook(body, signature, req.rawBody);
  }

  @Get('callbacks')
  @UseGuards(JwtAuthGuard, RbacGuard)
  @RequirePermission('job_seeker', 'read')
  @RequireRoles('call_agent', 'team_lead', 'manager', 'ceo')
  async getCallbackQueue(@Req() req: Request & { user: JwtPayload }, @Query('status') status?: string) {
    return this.telephonyService.getCallbackQueue({ status }, req.user);
  }

  @Post('callbacks/:id/assign')
  @UseGuards(JwtAuthGuard, RbacGuard)
  @RequirePermission('job_seeker', 'write')
  @RequireRoles('call_agent', 'team_lead', 'manager', 'ceo')
  async assignCallback(
    @Param('id') id: string,
    @Req() req: Request & { user: JwtPayload },
    @Body() body?: { staffId?: string },
  ) {
    const targetStaffId = body?.staffId || req.user.sub;
    return this.telephonyService.assignCallback(id, targetStaffId, req.user);
  }

  @Post('callbacks/:id/complete')
  @UseGuards(JwtAuthGuard, RbacGuard)
  @RequirePermission('job_seeker', 'write')
  @RequireRoles('call_agent', 'team_lead', 'manager', 'ceo')
  async completeCallback(@Param('id') id: string, @Req() req: Request & { user: JwtPayload }) {
    return this.telephonyService.completeCallback(id, req.user);
  }

  @Get('capacity')
  @UseGuards(JwtAuthGuard, RbacGuard)
  @RequirePermission('job_seeker', 'read')
  @RequireRoles('call_agent', 'team_lead', 'manager', 'ceo')
  getCapacity() {
    return this.telephonyService.getCapacity();
  }
}
