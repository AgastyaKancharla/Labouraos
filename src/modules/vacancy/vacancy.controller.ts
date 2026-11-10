import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Query,
  Req,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { Request } from 'express';
import { VacancyService } from './vacancy.service';
import { CreateVacancyDto } from './dto/create-vacancy.dto';
import { JwtAuthGuard } from '../../common/auth/jwt-auth.guard';
import { RbacGuard } from '../../common/rbac/rbac.guard';
import { RequirePermission } from '../../common/rbac/permissions.decorator';
import { RequireRoles } from '../../common/rbac/roles.decorator';
import { PiiMaskingInterceptor } from '../../common/rbac/pii-masking.interceptor';
import { JwtPayload } from '../../common/auth/jwt-payload.interface';
import { MatchingService } from './matching.service';
import { CandidateIntroductionService } from './candidate-introduction.service';
import { VacancyConfirmationService } from './vacancy-confirmation.service';

@Controller('vacancies')
@UseGuards(JwtAuthGuard, RbacGuard)
@UseInterceptors(PiiMaskingInterceptor)
export class VacancyController {
  constructor(
    private readonly vacancyService: VacancyService,
    private readonly matchingService: MatchingService,
    private readonly candidateIntroductionService: CandidateIntroductionService,
    private readonly confirmationService: VacancyConfirmationService,
  ) {}

  @Post()
  @RequireRoles('field_agent', 'call_agent', 'manager', 'ceo', 'team_lead')
  @RequirePermission('vacancy', 'write')
  async createVacancy(
    @Body() body: CreateVacancyDto & { businessId: string },
    @Req() req: Request & { user: JwtPayload },
  ) {
    if (!body || !body.businessId) {
      throw new BadRequestException('businessId is required');
    }
    return this.vacancyService.create(body.businessId, body, req.user.sub);
  }

  @Get()
  @RequireRoles('field_agent', 'call_agent', 'manager', 'ceo', 'finance', 'team_lead')
  @RequirePermission('vacancy', 'read')
  async findAll(
    @Req() req: Request & { user: JwtPayload },
    @Query('status') status?: string,
  ) {
    return this.vacancyService.findAll(req.user.sub, status);
  }

  @Get('below-legal-minimum')
  @RequireRoles('team_lead', 'manager', 'ceo')
  @RequirePermission('vacancy', 'read')
  async belowLegalMinimum(@Req() req: Request & { user: JwtPayload }) {
    return this.confirmationService.belowLegalMinimum({ id: req.user.sub, role: req.user.role });
  }

  @Post(':id/submit-for-confirmation')
  @RequireRoles('field_agent', 'call_agent', 'manager', 'ceo', 'team_lead')
  @RequirePermission('vacancy', 'write')
  async submitForConfirmation(
    @Param('id') id: string,
    @Body() body: { ownerToldMinimumWage?: boolean },
    @Req() req: Request & { user: JwtPayload },
  ) {
    return this.vacancyService.submitForConfirmation(id, body ?? {}, req.user.sub);
  }

  @Post(':id/confirmation/send-code')
  @RequireRoles('field_agent', 'call_agent', 'manager', 'ceo', 'team_lead')
  @RequirePermission('vacancy', 'write')
  async sendConfirmationCode(
    @Param('id') id: string,
    @Body() body: { otpRequestId?: string },
    @Req() req: Request & { user: JwtPayload },
  ) {
    return this.confirmationService.sendCode(id, { id: req.user.sub, role: req.user.role }, body?.otpRequestId);
  }

  @Post(':id/confirm')
  @RequireRoles('field_agent', 'call_agent', 'manager', 'ceo', 'team_lead')
  @RequirePermission('vacancy', 'write')
  async confirm(
    @Param('id') id: string,
    @Body() body: { otpRequestId?: string; code?: string; method?: string },
    @Req() req: Request & { user: JwtPayload },
  ) {
    return this.confirmationService.confirmWithCode(id, body ?? {}, { id: req.user.sub, role: req.user.role });
  }

  @Post(':id/confirmation-link')
  @RequireRoles('field_agent', 'call_agent', 'manager', 'ceo', 'team_lead')
  @RequirePermission('vacancy', 'write')
  async sendConfirmationLink(
    @Param('id') id: string,
    @Req() req: Request & { user: JwtPayload },
  ) {
    return this.confirmationService.sendLink(id, { id: req.user.sub, role: req.user.role });
  }

  @Get(':id/candidates')
  @RequireRoles('field_agent', 'call_agent', 'manager', 'ceo', 'finance', 'team_lead')
  @RequirePermission('vacancy', 'read')
  async getCandidates(
    @Param('id') id: string,
    @Req() req: Request & { user: JwtPayload },
  ) {
    return this.vacancyService.getCandidates(id, req.user.sub);
  }

  @Get(':id/shortlist')
  @RequireRoles('field_agent', 'call_agent', 'manager', 'ceo', 'finance', 'team_lead')
  @RequirePermission('vacancy', 'read')
  async getShortlist(
    @Param('id') id: string,
    @Query('page') pageQuery?: string,
  ) {
    const page = pageQuery === undefined ? 1 : Number(pageQuery);
    if (!Number.isInteger(page) || page < 1) {
      throw new BadRequestException('page must be a positive integer');
    }
    return this.matchingService.match(id, { page });
  }

  @Post(':id/introductions/in-person')
  @RequireRoles('field_agent', 'call_agent', 'team_lead', 'manager', 'ceo')
  @RequirePermission('vacancy', 'write')
  async showCandidatesInPerson(
    @Param('id') id: string,
    @Body() body: { jobSeekerIds?: string[] },
    @Req() req: Request & { user: JwtPayload },
  ) {
    return this.candidateIntroductionService.showInPerson(id, body?.jobSeekerIds ?? [], req.user.sub);
  }

  @Post(':id/introductions')
  @RequireRoles('field_agent', 'call_agent', 'team_lead', 'manager', 'ceo')
  @RequirePermission('vacancy', 'write')
  async shareCandidates(
    @Param('id') id: string,
    @Body() body: { jobSeekerIds?: string[]; channel?: 'sms' | 'whatsapp' },
    @Req() req: Request & { user: JwtPayload },
  ) {
    return this.candidateIntroductionService.shareByLink(
      id,
      body?.jobSeekerIds ?? [],
      req.user.sub,
      body?.channel ?? 'sms',
    );
  }

  @Get(':id')
  @RequireRoles('field_agent', 'call_agent', 'manager', 'ceo', 'finance', 'team_lead')
  @RequirePermission('vacancy', 'read')
  async findById(
    @Param('id') id: string,
  ) {
    return this.vacancyService.findById(id);
  }

  @Patch(':id')
  @RequireRoles('field_agent', 'call_agent', 'manager', 'ceo', 'team_lead')
  @RequirePermission('vacancy', 'write')
  async update(
    @Param('id') id: string,
    @Body() body: Record<string, unknown>,
    @Req() req: Request & { user: JwtPayload },
  ) {
    return this.vacancyService.update(id, body, {
      id: req.user.sub,
      role: req.user.role,
      teamLeadId: req.user.teamLeadId,
    });
  }
}

