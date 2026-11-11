import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Headers,
  Param,
  Patch,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { Request } from 'express';
import { JwtAuthGuard } from '../../common/auth/jwt-auth.guard';
import { JwtPayload } from '../../common/auth/jwt-payload.interface';
import { RbacGuard } from '../../common/rbac/rbac.guard';
import { RequireRoles } from '../../common/rbac/roles.decorator';
import { CallService } from './call.service';
import { Public } from '../../common/rbac/public.decorator';

type AuthenticatedRequest = Request & { user: JwtPayload; rawBody?: Buffer };

@Controller()
export class CallController {
  constructor(private readonly calls: CallService) {}

  @Post('telephony/webhook/call-status')
  @Public('webhook: the sender is checked by its signature, not a staff login')
  applyStatus(
    @Req() req: Request & { rawBody?: Buffer },
    @Headers('x-telephony-signature') sig1?: string,
    @Headers('x-signature') sig2?: string,
  ) {
    const signature = sig1 || sig2;
    return this.calls.applyWebhook(req.rawBody, signature);
  }

  @Get('calls/:id/recording')
  @UseGuards(JwtAuthGuard, RbacGuard)
  @RequireRoles('team_lead', 'manager', 'ceo')
  recording(@Param('id') id: string, @Req() req: AuthenticatedRequest) {
    return this.calls.recordingLink({ id: req.user.sub, role: req.user.role }, id);
  }

  @Get('calls/:id')
  @UseGuards(JwtAuthGuard, RbacGuard)
  @RequireRoles('call_agent', 'field_agent', 'team_lead', 'manager', 'ceo')
  getOne(@Param('id') id: string, @Req() req: AuthenticatedRequest) {
    return this.calls.getOne({ id: req.user.sub, role: req.user.role }, id);
  }

  @Get('calls')
  @UseGuards(JwtAuthGuard, RbacGuard)
  @RequireRoles('call_agent', 'field_agent', 'team_lead', 'manager', 'ceo')
  list(
    @Req() req: AuthenticatedRequest,
    @Query('subjectType') subjectType?: string,
    @Query('subjectId') subjectId?: string,
  ) {
    if (!subjectType || !subjectId) {
      throw new BadRequestException('subjectType and subjectId are required');
    }
    return this.calls.list({ id: req.user.sub, role: req.user.role }, subjectType, subjectId);
  }

  @Post('calls')
  @UseGuards(JwtAuthGuard, RbacGuard)
  @RequireRoles('call_agent', 'field_agent', 'team_lead', 'manager', 'ceo')
  place(
    @Body()
    body: {
      subjectType?: string;
      subjectId?: string;
      purpose?: string;
      relatedType?: string;
      relatedId?: string;
    },
    @Req() req: AuthenticatedRequest,
  ) {
    return this.calls.place({ id: req.user.sub, role: req.user.role }, body);
  }

  @Post('calls/:id/outcome')
  @UseGuards(JwtAuthGuard, RbacGuard)
  @RequireRoles('call_agent', 'field_agent', 'team_lead', 'manager', 'ceo')
  outcome(
    @Param('id') id: string,
    @Body() body: { agentOutcome?: string; reason?: string },
    @Req() req: AuthenticatedRequest,
  ) {
    return this.calls.recordOutcome({ id: req.user.sub, role: req.user.role }, id, body);
  }

  @Patch('calls/:id')
  @UseGuards(JwtAuthGuard, RbacGuard)
  @RequireRoles('call_agent', 'field_agent', 'team_lead', 'manager', 'ceo')
  updateNotes(
    @Param('id') id: string,
    @Body() body: { notes?: string; agentOutcomeReason?: string; reason?: string },
    @Req() req: AuthenticatedRequest,
  ) {
    return this.calls.updateNotes(
      { id: req.user.sub, role: req.user.role, teamLeadId: req.user.teamLeadId },
      id,
      body,
    );
  }
}
