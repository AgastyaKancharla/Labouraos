import {
  Body,
  Controller,
  Get,
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

@Controller('telephony')
export class TelephonyController {
  constructor(private readonly telephonyService: TelephonyService) {}

  @Post('inbound')
  async handleInboundWebhook(@Body() body: Record<string, unknown>) {
    return this.telephonyService.handleInboundWebhook(body);
  }

  @Post('webhook/missed-call')
  async handleMissedCallWebhook(@Body() body: Record<string, unknown>) {
    return this.telephonyService.handleInboundWebhook(body);
  }

  @Get('callbacks')
  @UseGuards(JwtAuthGuard, RbacGuard)
  @RequirePermission('job_seeker', 'read')
  @RequireRoles('call_agent', 'team_lead', 'manager', 'ceo')
  async getCallbackQueue(@Query('status') status?: string) {
    return this.telephonyService.getCallbackQueue({ status });
  }

  @Post('callbacks/:id/assign')
  @UseGuards(JwtAuthGuard, RbacGuard)
  @RequirePermission('job_seeker', 'write')
  @RequireRoles('call_agent', 'team_lead', 'manager', 'ceo')
  async assignCallback(
    @Param('id') id: string,
    @Req() req: Request & { user: JwtPayload },
  ) {
    return this.telephonyService.assignCallback(id, req.user.sub);
  }

  @Post('callbacks/:id/complete')
  @UseGuards(JwtAuthGuard, RbacGuard)
  @RequirePermission('job_seeker', 'write')
  @RequireRoles('call_agent', 'team_lead', 'manager', 'ceo')
  async completeCallback(@Param('id') id: string) {
    return this.telephonyService.completeCallback(id);
  }

  @Post('outbound/click-to-call')
  @UseGuards(JwtAuthGuard, RbacGuard)
  @RequirePermission('job_seeker', 'write')
  @RequireRoles('call_agent', 'team_lead', 'manager', 'ceo')
  async initiateClickToCall(
    @Body()
    body: {
      agentPhone: string;
      customerPhone: string;
      recordCall?: boolean;
    },
  ) {
    return this.telephonyService.initiateOutboundCall(
      body.agentPhone,
      body.customerPhone,
      body.recordCall,
    );
  }

  @Get('capacity')
  @UseGuards(JwtAuthGuard, RbacGuard)
  @RequirePermission('job_seeker', 'read')
  @RequireRoles('call_agent', 'team_lead', 'manager', 'ceo')
  getCapacity() {
    return this.telephonyService.getCapacity();
  }
}
