import { otpChannel } from '../../common/otp/otp.controller';
import { LINK_SENDING_ROLES, linkChannel } from '../message/link-channel';
import { withoutLinkToken } from '../../common/public-link-response';
import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Param,
  Patch,
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
import { STAFF_PHOTO_MAX_BYTES } from '../../common/upload-limits';
import { BusinessOwnerPhotoService, parseOwnerPhotoLocation, parseOwnerPhotoSlot, parseShopVariant } from './business-owner-photo.service';
import { BusinessOwnerCheckService } from './business-owner-check.service';

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
    private readonly ownerPhotos: BusinessOwnerPhotoService,
    private readonly ownerChecks: BusinessOwnerCheckService,
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
    @Req() req: Request & { user: JwtPayload },
  ) {
    return this.businessService.findById(id, { id: req.user.sub, role: req.user.role });
  }

  @Patch(':id')
  @RequireRoles('field_agent', 'call_agent', 'manager', 'ceo', 'team_lead')
  @RequirePermission('business', 'write')
  async update(
    @Param('id') id: string,
    @Body() body: Record<string, unknown>,
    @Req() req: Request & { user: JwtPayload },
  ) {
    return this.businessService.update(id, body, {
      id: req.user.sub,
      role: req.user.role,
      teamLeadId: req.user.teamLeadId,
    });
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
  // Rev 211: only agents press send buttons; Team Leads, Managers and the CEO keep the stuck view.
  @RequireRoles(...LINK_SENDING_ROLES)
  @RequirePermission('business', 'write')
  async createAgreementLink(
    @Param('id') businessId: string,
    @Body() body: { language?: string; channel?: string },
    @Req() req: Request & { user: JwtPayload },
  ) {
    // AC-3: the link goes to the owner (WhatsApp first, SMS as backup; or "Send by SMS"); staff never get its token.
    // Rev 188: smsSent tells the screen whether the SMS went (false: offer "Resend agreement link").
    const { linkId: _linkId, ...issued } = await this.consentLinkService.createAgreementLink(businessId, req.user.sub, body?.language, { channel: linkChannel(body?.channel), sentByStaffId: req.user.sub });
    void _linkId;
    return withoutLinkToken(issued);
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
    @Body('channel') channel?: unknown,
  ) {
    // "Send by SMS" (rev 211) after 30 seconds; otherwise WhatsApp first.
    return this.verificationService.sendOwnerOtp(businessId, assignmentId, req.user.sub, otpChannel(channel));
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

  @Post(':id/pause')
  @RequireRoles('team_lead', 'manager', 'ceo')
  @RequirePermission('business', 'write')
  pause(
    @Param('id') businessId: string,
    @Body('reason') reason: string,
    @Req() req: Request & { user: JwtPayload },
  ) {
    return this.verificationService.pause(businessId, req.user.sub, reason);
  }

  @Post(':id/unpause')
  @RequireRoles('team_lead', 'manager', 'ceo')
  @RequirePermission('business', 'write')
  unpause(
    @Param('id') businessId: string,
    @Body('reason') reason: string,
    @Req() req: Request & { user: JwtPayload },
  ) {
    return this.verificationService.unpause(businessId, req.user.sub, reason);
  }

  /** Rev 193: office staff set the legal minimum wage zone (1, 2 or 3), with a reason. */
  @Patch(':id/minimum-wage-zone')
  @RequireRoles('team_lead', 'manager', 'ceo')
  @RequirePermission('business', 'write')
  setMinimumWageZone(
    @Param('id') businessId: string,
    @Body('zone') zone: unknown,
    @Body('reason') reason: string,
    @Req() req: Request & { user: JwtPayload },
  ) {
    return this.verificationService.setMinimumWageZone(businessId, req.user.sub, zone, reason);
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
  // Visits are done in person by field agents (guide: call agents work by
  // phone), so call agents are refused. Field agents keep their own scope
  // (account businesses, their open visit assignment, their own active lead),
  // Team Leads their own team's businesses (RbacGuard, :id).
  @RequireRoles('field_agent', 'manager', 'ceo', 'team_lead')
  @RequirePermission('business', 'write')
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
  // L1: a size limit like every other upload, so a huge file cannot fill the memory.
  @UseInterceptors(FileInterceptor('photo', { limits: { fileSize: STAFF_PHOTO_MAX_BYTES, files: 1 } }))
  uploadStorefrontPhoto(
    @Param('id') businessId: string,
    @UploadedFile() photo: { buffer: Buffer; mimetype: string } | undefined,
    @Req() req: Request & { user: JwtPayload },
    @Body('source') source?: string,
  ) {
    if (!photo) {
      throw new BadRequestException('A storefront photo is required');
    }
    // Guide: the storefront photo is taken live (camera only), as on the field-visit path.
    if (source !== 'live_camera') {
      throw new BadRequestException("Only a photo taken with the app's own camera is accepted");
    }
    return this.businessService.uploadStorefrontPhoto(
      businessId,
      photo.buffer,
      photo.mimetype,
      req.user.sub,
    );
  }

  /**
   * 25 Nov (rev 211, B2): add a missing proof (GST, FSSAI / trade licence / Shop and
   * Establishment / Udyam number, or the Google Maps link); the automatic check runs again.
   * Scope: the business write permission (an agent's own account or lead, a Team Lead's team).
   */
  @Post(':id/proofs')
  @RequireRoles('field_agent', 'call_agent', 'team_lead', 'manager', 'ceo')
  @RequirePermission('business', 'write')
  addProofs(@Param('id') businessId: string, @Body() body: Record<string, unknown>, @Req() req: Request & { user: JwtPayload }) {
    return this.businessService.addProofs(businessId, body ?? {}, req.user.sub);
  }

  /**
   * 25 Nov (rev 211, B1): in Laboura Field (FA07b) the field agent takes the owner's live selfie
   * (kind=selfie) and the shop photo (kind=shop: the name board, or for a home business the owner
   * holding the FSSAI licence) before the owner signs, with the phone's GPS on the shop photo.
   * Camera only. Scope: the field agent's own account (business write permission).
   */
  @Post(':id/owner-photos')
  @RequireRoles('field_agent')
  @RequirePermission('business', 'write')
  @UseInterceptors(FileInterceptor('photo', { limits: { fileSize: STAFF_PHOTO_MAX_BYTES, files: 1 } }))
  async ownerPhoto(
    @Param('id') businessId: string,
    @UploadedFile() photo: { buffer: Buffer; mimetype: string } | undefined,
    @Body() body: Record<string, unknown>,
    @Req() req: Request & { user: JwtPayload },
  ) {
    const saved = await this.ownerPhotos.save(businessId, {
      slot: parseOwnerPhotoSlot(body?.kind),
      shopVariant: parseShopVariant(body?.shopVariant),
      photo: photo?.buffer ?? Buffer.alloc(0),
      captureSource: typeof body?.captureSource === 'string' ? body.captureSource : undefined,
      location: parseOwnerPhotoLocation(body ?? {}),
      takenVia: 'field_app',
      takenByStaffId: req.user.sub,
      auditActorId: req.user.sub,
    });
    // A photo added after the owner signed may complete the automatic check.
    await this.verificationService.advanceToPendingTlCheckIfReady(businessId, req.user.sub);
    return { ...saved, ownerPhotos: await this.ownerPhotos.state(businessId) };
  }

  // ---- 25 Nov (rev 212, B9): the Team Lead's small-business checks ----

  /** The owner's ID card photo (PAN, driving licence, voter ID): approve or reject; the photo is deleted. */
  @Post(':id/small-business/owner-id')
  @RequireRoles('team_lead', 'manager', 'ceo')
  @RequirePermission('business', 'write')
  decideOwnerId(@Param('id') businessId: string, @Body() body: { decision?: unknown; reason?: unknown }, @Req() req: Request & { user: JwtPayload }) {
    return this.ownerChecks.decideOwnerId(businessId, { id: req.user.sub, role: req.user.role }, body?.decision, body?.reason);
  }

  /** The address proof: approve with the address as matched, or reject; the image is deleted. */
  @Post(':id/small-business/address-proof')
  @RequireRoles('team_lead', 'manager', 'ceo')
  @RequirePermission('business', 'write')
  decideAddress(@Param('id') businessId: string, @Body() body: { decision?: unknown; addressMatched?: unknown; reason?: unknown }, @Req() req: Request & { user: JwtPayload }) {
    return this.ownerChecks.decideAddress(businessId, { id: req.user.sub, role: req.user.role }, body?.decision, body?.addressMatched, body?.reason);
  }

  /** "Video call done": the Team Lead saw the workspace on a short video call through Laboura (with a note). */
  @Post(':id/small-business/video-call')
  @RequireRoles('team_lead', 'manager', 'ceo')
  @RequirePermission('business', 'write')
  videoCall(@Param('id') businessId: string, @Body() body: { note?: unknown }, @Req() req: Request & { user: JwtPayload }) {
    return this.ownerChecks.recordVideoCall(businessId, { id: req.user.sub, role: req.user.role }, body?.note);
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

