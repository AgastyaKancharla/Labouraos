import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Req,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { Request } from 'express';
import { JobSeekerService } from './job-seeker.service';
import { JwtAuthGuard } from '../../common/auth/jwt-auth.guard';
import { RbacGuard } from '../../common/rbac/rbac.guard';
import { RequirePermission } from '../../common/rbac/permissions.decorator';
import { RequireRoles } from '../../common/rbac/roles.decorator';
import { PiiMaskingInterceptor } from '../../common/rbac/pii-masking.interceptor';
import { JwtPayload } from '../../common/auth/jwt-payload.interface';
import { CreateJobSeekerDto } from './dto/create-job-seeker.dto';
import { RecordHitDto } from './dto/record-hit.dto';
import { ApproveJobSeekerRefundDto } from './dto/approve-refund.dto';
import { UpdateJobSeekerProfileDto } from './dto/update-job-seeker-profile.dto';
import {
  CreateJobSeekerTradeDto,
  UpdateJobSeekerTradeDto,
} from './dto/job-seeker-trade.dto';
import {
  CreateJobSeekerLanguageDto,
  UpdateJobSeekerLanguageDto,
} from './dto/job-seeker-language.dto';

@Controller('job-seekers')
@UseGuards(JwtAuthGuard, RbacGuard)
@UseInterceptors(PiiMaskingInterceptor)
export class JobSeekerController {
  constructor(private readonly jobSeekerService: JobSeekerService) {}

  /**
   * ANTI-FRAUD NOTE: Candidate onboarding already carries mobile-number OTP verification,
   * which is the control that makes field-agent candidate capture safe.
   * Do not remove or weaken it, and do not add a bypass for field agents.
   */
  @Post()
  @RequireRoles('call_agent', 'manager', 'ceo', 'field_agent', 'team_lead')
  @RequirePermission('job_seeker', 'write')
  async create(
    @Body() body: CreateJobSeekerDto,
    @Req() req: Request & { user: JwtPayload },
  ) {
    return this.jobSeekerService.create(body, req.user.sub);
  }

  @Get()
  @RequireRoles('call_agent', 'manager', 'ceo', 'finance', 'field_agent', 'team_lead')
  @RequirePermission('job_seeker', 'read')
  async findAll() {
    return this.jobSeekerService.findAll();
  }

  @Get(':id')
  @RequireRoles('call_agent', 'manager', 'ceo', 'finance', 'field_agent', 'team_lead')
  @RequirePermission('job_seeker', 'read')
  async findById(@Param('id') id: string) {
    return this.jobSeekerService.findById(id);
  }

  @Post(':id/activation-payment')
  @RequireRoles('call_agent', 'manager', 'ceo', 'field_agent', 'team_lead')
  @RequirePermission('job_seeker', 'write')
  async createActivationPayment(
    @Param('id') id: string,
    @Req() req: Request & { user?: JwtPayload },
  ) {
    return this.jobSeekerService.createActivationPayment(id, req.user?.sub);
  }

  @Post(':id/kyc')
  @RequireRoles('call_agent', 'manager', 'ceo', 'field_agent', 'team_lead')
  @RequirePermission('job_seeker', 'write')
  async submitKyc(
    @Param('id') id: string,
    @Body() body: Record<string, unknown>,
    @Req() req: Request & { user: JwtPayload },
  ) {
    return this.jobSeekerService.updateKyc(id, body, req.user.sub);
  }

  @Post(':id/identity-verification')
  @RequireRoles('call_agent', 'manager', 'ceo', 'field_agent', 'team_lead')
  @RequirePermission('job_seeker', 'write')
  async requestIdentityVerification(
    @Param('id') id: string,
    @Body() body: Record<string, unknown>,
    @Req() req: Request & { user: JwtPayload },
  ) {
    return this.jobSeekerService.createIdentityVerification(id, body, req.user.sub);
  }

  @Get(':id/identity-verifications')
  @RequireRoles('call_agent', 'manager', 'ceo', 'field_agent', 'team_lead', 'finance')
  @RequirePermission('job_seeker', 'read')
  async listIdentityVerifications(@Param('id') id: string) {
    return this.jobSeekerService.getIdentityVerifications(id);
  }

  @Post(':id/hits')
  @RequireRoles('call_agent', 'manager', 'ceo', 'field_agent', 'team_lead')
  @RequirePermission('job_seeker', 'write')
  async recordHit(
    @Param('id') id: string,
    @Body() body: RecordHitDto,
    @Req() req: Request & { user: JwtPayload },
  ) {
    return this.jobSeekerService.recordHit(
      id,
      body.reason,
      body.note,
      req.user.sub,
      req.user.role,
      { interviewId: body.interviewId, callRecordId: body.callRecordId },
    );
  }

  @Get(':id/hits')
  @RequireRoles('call_agent', 'manager', 'ceo', 'field_agent', 'team_lead', 'finance')
  @RequirePermission('job_seeker', 'read')
  async listHits(@Param('id') id: string) {
    return this.jobSeekerService.listHits(id);
  }

  @Post(':id/reactivate')
  @RequireRoles('call_agent', 'manager', 'ceo', 'field_agent', 'team_lead')
  @RequirePermission('job_seeker', 'write')
  async reactivate(
    @Param('id') id: string,
    @Req() req: Request & { user: JwtPayload },
  ) {
    return this.jobSeekerService.reactivate(id, req.user.sub);
  }

  @Post(':id/refund')
  @RequireRoles('ceo', 'manager')
  @RequirePermission('payment', 'write')
  async approveRefund(
    @Param('id') id: string,
    @Body() body: ApproveJobSeekerRefundDto,
    @Req() req: Request & { user: JwtPayload },
  ) {
    return this.jobSeekerService.approveRefund(id, body, req.user.sub);
  }

  @Post(':id/erase')
  @RequireRoles('ceo', 'manager')
  @RequirePermission('job_seeker', 'write')
  async erase(
    @Param('id') id: string,
    @Req() req: Request & { user: JwtPayload },
  ) {
    return this.jobSeekerService.erase(id, req.user.sub);
  }

  @Patch(':id/profile')
  @RequireRoles('call_agent', 'manager', 'ceo', 'field_agent', 'team_lead')
  @RequirePermission('job_seeker', 'write')
  async updateProfile(
    @Param('id') id: string,
    @Body() body: UpdateJobSeekerProfileDto,
    @Req() req: Request & { user: JwtPayload },
  ) {
    return this.jobSeekerService.updateProfile(id, body, req.user.sub);
  }

  @Post(':id/status')
  @RequireRoles('call_agent', 'manager', 'ceo', 'field_agent', 'team_lead')
  @RequirePermission('job_seeker', 'write')
  async transitionStatus(
    @Param('id') id: string,
    @Body('status') status: string,
    @Req() req: Request & { user: JwtPayload },
  ) {
    return this.jobSeekerService.transitionStatus(id, status, req.user.sub);
  }

  // --- Trades (Phase 12 Task 3) ---

  @Post(':id/trades')
  @RequireRoles('call_agent', 'manager', 'ceo', 'field_agent', 'team_lead')
  @RequirePermission('job_seeker', 'write')
  async addTrade(
    @Param('id') id: string,
    @Body() body: CreateJobSeekerTradeDto,
    @Req() req: Request & { user: JwtPayload },
  ) {
    return this.jobSeekerService.addTrade(id, body, req.user.sub);
  }

  @Get(':id/trades')
  @RequireRoles('call_agent', 'manager', 'ceo', 'finance', 'field_agent', 'team_lead')
  @RequirePermission('job_seeker', 'read')
  async getTrades(@Param('id') id: string) {
    return this.jobSeekerService.getTrades(id);
  }

  @Patch(':id/trades/:tradeId')
  @RequireRoles('call_agent', 'manager', 'ceo', 'field_agent', 'team_lead')
  @RequirePermission('job_seeker', 'write')
  async updateTrade(
    @Param('id') id: string,
    @Param('tradeId') tradeId: string,
    @Body() body: UpdateJobSeekerTradeDto,
    @Req() req: Request & { user: JwtPayload },
  ) {
    return this.jobSeekerService.updateTrade(id, tradeId, body, req.user.sub);
  }

  @Delete(':id/trades/:tradeId')
  @RequireRoles('call_agent', 'manager', 'ceo', 'field_agent', 'team_lead')
  @RequirePermission('job_seeker', 'write')
  async deleteTrade(
    @Param('id') id: string,
    @Param('tradeId') tradeId: string,
    @Req() req: Request & { user: JwtPayload },
  ) {
    return this.jobSeekerService.deleteTrade(id, tradeId, req.user.sub);
  }

  // --- Languages (Phase 12 Task 3) ---

  @Post(':id/languages')
  @RequireRoles('call_agent', 'manager', 'ceo', 'field_agent', 'team_lead')
  @RequirePermission('job_seeker', 'write')
  async addLanguage(
    @Param('id') id: string,
    @Body() body: CreateJobSeekerLanguageDto,
    @Req() req: Request & { user: JwtPayload },
  ) {
    return this.jobSeekerService.addLanguage(id, body, req.user.sub);
  }

  @Get(':id/languages')
  @RequireRoles('call_agent', 'manager', 'ceo', 'finance', 'field_agent', 'team_lead')
  @RequirePermission('job_seeker', 'read')
  async getLanguages(@Param('id') id: string) {
    return this.jobSeekerService.getLanguages(id);
  }

  @Patch(':id/languages/:languageId')
  @RequireRoles('call_agent', 'manager', 'ceo', 'field_agent', 'team_lead')
  @RequirePermission('job_seeker', 'write')
  async updateLanguage(
    @Param('id') id: string,
    @Param('languageId') languageId: string,
    @Body() body: UpdateJobSeekerLanguageDto,
    @Req() req: Request & { user: JwtPayload },
  ) {
    return this.jobSeekerService.updateLanguage(id, languageId, body, req.user.sub);
  }

  @Delete(':id/languages/:languageId')
  @RequireRoles('call_agent', 'manager', 'ceo', 'field_agent', 'team_lead')
  @RequirePermission('job_seeker', 'write')
  async deleteLanguage(
    @Param('id') id: string,
    @Param('languageId') languageId: string,
    @Req() req: Request & { user: JwtPayload },
  ) {
    return this.jobSeekerService.deleteLanguage(id, languageId, req.user.sub);
  }
}



