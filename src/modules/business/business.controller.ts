import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Param,
  Post,
  Req,
  Res,
  UseGuards,
  UseInterceptors,
  UploadedFile,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { Request, Response } from 'express';
import { BusinessService } from './business.service';
import { CreateBusinessDto, RecordVisitDto } from './dto/create-business.dto';
import { JwtAuthGuard } from '../../common/auth/jwt-auth.guard';
import { RbacGuard } from '../../common/rbac/rbac.guard';
import { RequirePermission } from '../../common/rbac/permissions.decorator';
import { RequireRoles } from '../../common/rbac/roles.decorator';
import { PiiMaskingInterceptor } from '../../common/rbac/pii-masking.interceptor';
import { JwtPayload } from '../../common/auth/jwt-payload.interface';

import { VacancyService } from '../vacancy/vacancy.service';
import { CreateVacancyDto } from '../vacancy/dto/create-vacancy.dto';
import { ConsentLinkService } from '../consent/consent-link.service';
import {
  BusinessVerificationService,
  CreateVisitAssignmentDto,
} from './business-verification.service';
import { CandidateIntroductionService } from '../vacancy/candidate-introduction.service';

@Controller('businesses')
@UseGuards(JwtAuthGuard, RbacGuard)
@UseInterceptors(PiiMaskingInterceptor)
export class BusinessController {
  constructor(
    private readonly businessService: BusinessService,
    private readonly vacancyService: VacancyService,
    private readonly consentLinkService: ConsentLinkService,
    private readonly verificationService: BusinessVerificationService,
    private readonly candidateIntroductionService: CandidateIntroductionService,
  ) {}

  @Post()
  @RequireRoles('field_agent', 'call_agent', 'manager', 'ceo', 'team_lead')
  @RequirePermission('business', 'write')
  async create(
    @Body() body: CreateBusinessDto,
    @Req() req: Request & { user: JwtPayload },
  ) {
    return this.businessService.create(body, req.user.sub);
  }

  @Get()
  @RequireRoles('field_agent', 'call_agent', 'manager', 'ceo', 'finance', 'team_lead')
  @RequirePermission('business', 'read')
  async findAll(@Req() req: Request & { user: JwtPayload }) {
    return this.businessService.findAll(req.user.sub);
  }

  @Get('visit-assignments')
  @RequireRoles('field_agent', 'team_lead', 'manager', 'ceo')
  listVisitAssignments(@Req() req: Request & { user: JwtPayload }) {
    return this.verificationService.listAssignments(req.user.sub, req.user.role);
  }

  @Get(':id')
  @RequireRoles('field_agent', 'call_agent', 'manager', 'ceo', 'finance', 'team_lead')
  @RequirePermission('business', 'read')
  async findById(
    @Param('id') id: string,
  ) {
    return this.businessService.findById(id);
  }

  @Get(':id/introductions')
  @RequireRoles('team_lead', 'manager', 'ceo')
  @RequirePermission('business', 'read')
  listIntroductions(@Param('id') id: string) {
    return this.candidateIntroductionService.listForBusiness(id);
  }

  @Get(':id/agreement')
  @RequireRoles('team_lead', 'manager', 'ceo')
  @RequirePermission('business', 'read')
  async getSignedAgreement(@Param('id') id: string, @Res() res: Response) {
    const document = await this.consentLinkService.getSignedAgreementDocument(id);
    res.type('html').setHeader('Content-Security-Policy', "default-src 'none'; style-src 'unsafe-inline'");
    res.setHeader('X-Content-SHA256', document.termsHash);
    return res.send(document.body);
  }

  @Post(':id/agreement-links')
  @RequireRoles('call_agent', 'field_agent', 'team_lead', 'manager', 'ceo')
  @RequirePermission('business', 'write')
  createAgreementLink(
    @Param('id') businessId: string,
    @Body() body: { language?: string },
    @Req() req: Request & { user: JwtPayload },
  ) {
    return this.consentLinkService.createAgreementLink(businessId, req.user.sub, body?.language);
  }

  @Post(':id/visit-assignments')
  @RequireRoles('team_lead', 'manager', 'ceo')
  @RequirePermission('business', 'write')
  createVisitAssignment(
    @Param('id') businessId: string,
    @Body() body: CreateVisitAssignmentDto,
    @Req() req: Request & { user: JwtPayload },
  ) {
    return this.verificationService.createAssignment(businessId, req.user.sub, body);
  }

  @Post(':businessId/visit-assignments/:assignmentId/assign')
  @RequireRoles('team_lead', 'manager', 'ceo')
  @RequirePermission('business', 'write')
  assignVisit(
    @Param('assignmentId') assignmentId: string,
    @Body('assignedStaffId') assignedStaffId: string,
    @Req() req: Request & { user: JwtPayload },
  ) {
    return this.verificationService.assign(assignmentId, req.user.sub, assignedStaffId);
  }

  @Post(':businessId/visit-assignments/:assignmentId/owner-otp')
  @RequireRoles('field_agent')
  sendVisitOwnerOtp(
    @Param('businessId') businessId: string,
    @Param('assignmentId') assignmentId: string,
    @Req() req: Request & { user: JwtPayload },
  ) {
    return this.verificationService.sendOwnerOtp(businessId, assignmentId, req.user.sub);
  }

  @Post(':id/verification/approve')
  @RequireRoles('team_lead', 'manager', 'ceo')
  @RequirePermission('business', 'write')
  approveVerification(
    @Param('id') businessId: string,
    @Body('accountAgentId') accountAgentId: string | undefined,
    @Req() req: Request & { user: JwtPayload },
  ) {
    return this.verificationService.approve(businessId, req.user.sub, accountAgentId);
  }

  @Post(':id/verification/reject')
  @RequireRoles('team_lead', 'manager', 'ceo')
  @RequirePermission('business', 'write')
  rejectVerification(
    @Param('id') businessId: string,
    @Body('reason') reason: string,
    @Req() req: Request & { user: JwtPayload },
  ) {
    return this.verificationService.reject(businessId, req.user.sub, reason);
  }

  @Post(':id/account-agent')
  @RequireRoles('team_lead', 'manager', 'ceo')
  @RequirePermission('business', 'write')
  reassignAccountAgent(
    @Param('id') businessId: string,
    @Body('accountAgentId') accountAgentId: string,
    @Req() req: Request & { user: JwtPayload },
  ) {
    return this.verificationService.reassignAccountAgent(businessId, req.user.sub, accountAgentId);
  }

  @Post(':id/vacancies')
  @RequireRoles('field_agent', 'call_agent', 'manager', 'ceo', 'team_lead')
  @RequirePermission('vacancy', 'write')
  async createVacancy(
    @Param('id') businessId: string,
    @Body() body: CreateVacancyDto,
    @Req() req: Request & { user: JwtPayload },
  ) {
    return this.vacancyService.create(businessId, body, req.user.sub);
  }

  @Get(':id/vacancies')
  @RequireRoles('field_agent', 'call_agent', 'manager', 'ceo', 'finance', 'team_lead')
  @RequirePermission('vacancy', 'read')
  async findVacanciesByBusiness(
    @Param('id') businessId: string,
  ) {
    return this.vacancyService.findByBusiness(businessId);
  }

  @Post(':id/visits')
  @RequireRoles('field_agent', 'call_agent', 'manager', 'ceo', 'team_lead')
  async recordVisit(
    @Param('id') businessId: string,
    @Body() body: RecordVisitDto,
    @Req() req: Request & { user: JwtPayload },
  ) {
    return this.businessService.recordVisit(businessId, body, req.user.sub);
  }

  @Post(':id/storefront-photo')
  @RequireRoles('field_agent', 'call_agent', 'manager', 'ceo', 'team_lead')
  @RequirePermission('business', 'write')
  @UseInterceptors(FileInterceptor('photo'))
  uploadStorefrontPhoto(
    @Param('id') businessId: string,
    @UploadedFile() photo: { buffer: Buffer; mimetype: string } | undefined,
    @Req() req: Request & { user: JwtPayload },
  ) {
    if (!photo) {
      throw new BadRequestException('A storefront photo is required');
    }
    return this.businessService.uploadStorefrontPhoto(
      businessId,
      photo.buffer,
      photo.mimetype,
      req.user.sub,
    );
  }

  @Post(':id/erase')
  @RequireRoles('ceo', 'manager')
  @RequirePermission('business', 'write')
  async erase(
    @Param('id') id: string,
    @Req() req: Request & { user: JwtPayload },
  ) {
    return this.businessService.erase(id, req.user.sub);
  }
}

