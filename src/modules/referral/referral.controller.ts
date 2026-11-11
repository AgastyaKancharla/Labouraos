import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Req,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { Request } from 'express';
import { ReferralService } from './referral.service';
import { ConsentLinkService } from '../consent/consent-link.service';
import { JwtAuthGuard } from '../../common/auth/jwt-auth.guard';
import { RbacGuard } from '../../common/rbac/rbac.guard';
import { RequirePermission } from '../../common/rbac/permissions.decorator';
import { RequireRoles } from '../../common/rbac/roles.decorator';
import { PiiMaskingInterceptor } from '../../common/rbac/pii-masking.interceptor';
import { JwtPayload } from '../../common/auth/jwt-payload.interface';
import { CreateReferralDto } from './dto/create-referral.dto';

@Controller('referrals')
@UseGuards(JwtAuthGuard, RbacGuard)
@UseInterceptors(PiiMaskingInterceptor)
export class ReferralController {
  constructor(
    private readonly referralService: ReferralService,
    private readonly consentLinkService: ConsentLinkService,
  ) {}

  @Post(':id/terms-links')
  @RequireRoles('call_agent', 'manager', 'ceo', 'field_agent', 'team_lead')
  @RequirePermission('referral', 'write')
  async createTermsLink(
    @Param('id') referralId: string,
    @Body() body: { language?: string },
    @Req() req: Request & { user: JwtPayload },
  ) {
    return this.consentLinkService.createReferralTermsLink(
      referralId,
      req.user.sub,
      body?.language,
    );
  }

  @Post()
  @RequireRoles('call_agent', 'manager', 'ceo', 'field_agent', 'team_lead')
  @RequirePermission('referral', 'write')
  async create(
    @Body() body: CreateReferralDto,
    @Req() req: Request & { user: JwtPayload },
  ) {
    const referral = await this.referralService.create(body, req.user.sub);
    const registration = await this.consentLinkService.createReferralTermsLink(
      referral.id,
      req.user.sub,
      body.language,
    );
    return {
      ...referral,
      registrationLinkSent: registration.success,
      registrationLinkExpiresAt: registration.expiresAt,
    };
  }

  @Get()
  @RequireRoles('call_agent', 'manager', 'ceo', 'finance', 'field_agent', 'team_lead')
  @RequirePermission('referral', 'read')
  async findAll() {
    return this.referralService.findAll();
  }

  @Get(':id')
  @RequireRoles('call_agent', 'manager', 'ceo', 'finance', 'field_agent', 'team_lead')
  @RequirePermission('referral', 'read')
  async findById(@Param('id') id: string) {
    return this.referralService.findById(id);
  }

  @Patch(':id')
  @RequireRoles('call_agent', 'manager', 'ceo', 'field_agent', 'team_lead')
  @RequirePermission('referral', 'write')
  async update(
    @Param('id') id: string,
    @Body() body: Record<string, unknown>,
    @Req() req: Request & { user: JwtPayload },
  ) {
    return this.referralService.update(id, body, {
      id: req.user.sub,
      role: req.user.role,
      teamLeadId: req.user.teamLeadId,
    });
  }

  /** Pause a partner: CEO only, reason required, audited (guide, Referral partners). */
  @Post(':id/pause')
  @RequireRoles('ceo')
  @RequirePermission('referral', 'write')
  async pause(@Param('id') id: string, @Body('reason') reason: unknown, @Req() req: Request & { user: JwtPayload }) {
    return this.referralService.pause(id, req.user.sub, reason);
  }

  /** Unpause: the partner takes new referrals again. CEO only, audited. */
  @Post(':id/unpause')
  @RequireRoles('ceo')
  @RequirePermission('referral', 'write')
  async unpause(@Param('id') id: string, @Body('reason') reason: unknown, @Req() req: Request & { user: JwtPayload }) {
    return this.referralService.unpause(id, req.user.sub, reason);
  }
}
