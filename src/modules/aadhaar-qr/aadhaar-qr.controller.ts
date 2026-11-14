import { BadRequestException, Body, Controller, Get, HttpCode, HttpStatus, Inject, NotFoundException, Param, Post, Req, UseGuards } from '@nestjs/common';
import { Request } from 'express';
import { JwtAuthGuard } from '../../common/auth/jwt-auth.guard';
import { JwtPayload } from '../../common/auth/jwt-payload.interface';
import { RbacGuard } from '../../common/rbac/rbac.guard';
import { RequirePermission } from '../../common/rbac/permissions.decorator';
import { RequireRoles } from '../../common/rbac/roles.decorator';
import { PrismaService } from '../../common/prisma/prisma.service';
import { ReportingScopeService } from '../staff/reporting-scope.service';
import { CANDIDATE_PHOTO_LINK_TTL_SECONDS, CANDIDATE_PHOTO_STORAGE, CandidatePhotoStorage } from '../job-seeker/photo-storage';
import { AadhaarQrPhotoService } from './aadhaar-qr-photo.service';
import { AadhaarQrService } from './aadhaar-qr.service';

type Authed = Request & { user: JwtPayload };

@Controller()
@UseGuards(JwtAuthGuard, RbacGuard)
export class AadhaarQrController {
  constructor(
    private readonly qr: AadhaarQrService,
    private readonly qrPhotos: AadhaarQrPhotoService,
    private readonly prisma: PrismaService,
    private readonly scope: ReportingScopeService,
    @Inject(CANDIDATE_PHOTO_STORAGE) private readonly photos: CandidatePhotoStorage,
  ) {}

  /**
   * Laboura Field, "Scan Aadhaar QR": the field agent scans the QR on the job
   * seeker's card live with the app's camera (no gallery, nothing saved on the
   * phone); only the QR's text comes here. His aadhaar_verification consent
   * must already be recorded through his link. The answer says verified, the
   * name match and the masked reference — nothing read from the card.
   */
  @Post('field-work/job-seekers/:id/aadhaar-qr')
  @HttpCode(HttpStatus.OK)
  @RequireRoles('field_agent')
  @RequirePermission('job_seeker', 'write')
  async fieldScan(@Req() req: Authed, @Param('id') id: string, @Body() body: { qrText?: unknown; captureSource?: string }) {
    if (body?.captureSource !== 'live_camera') throw new BadRequestException('Scan the QR live with the camera');
    return this.qr.checkJobSeeker(id, body.qrText, { channel: 'field', staffId: req.user.sub });
  }

  /**
   * The ID check of a job seeker for the Team Lead (own team), the Manager and
   * the CEO: the badge, the masked reference, the name match, phone linked or
   * not, and — while it is kept — the QR photo next to the live selfie, both
   * through 5-minute signed links. Agents never get this.
   */
  @Get('identity/job-seekers/:id/aadhaar-check')
  @RequireRoles('team_lead', 'manager', 'ceo')
  async view(@Req() req: Authed, @Param('id') id: string) {
    const seeker = await this.prisma.jobSeeker.findUnique({
      where: { id },
      select: { id: true, registeredByStaffId: true, photoStoragePath: true, anonymisedAt: true },
    });
    if (!seeker || seeker.anonymisedAt) throw new NotFoundException('Job seeker not found');
    if (req.user.role === 'team_lead') {
      const owner = seeker.registeredByStaffId;
      const inTeam = owner && (owner === req.user.sub || (await this.scope.peopleUnder(req.user.sub)).includes(owner));
      if (!inTeam) throw new NotFoundException('Not a registration from your team');
    }
    const check = await this.qrPhotos.latestForJobSeeker(seeker.id);
    const qrPhoto = check?.photo.kept ? await this.qrPhotos.photoLink(check.verificationId, req.user.sub) : null;
    const selfieUrl = seeker.photoStoragePath ? await this.photos.signedUrl(seeker.photoStoragePath, CANDIDATE_PHOTO_LINK_TTL_SECONDS) : null;
    return {
      check,
      qrPhotoUrl: qrPhoto?.url ?? null,
      selfieUrl,
      expiresInSeconds: CANDIDATE_PHOTO_LINK_TTL_SECONDS,
    };
  }
}
