import { BadRequestException, Body, Controller, Get, HttpCode, HttpStatus, Inject, NotFoundException, Param, Post, Req, UploadedFile, UseGuards, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { Request } from 'express';
import { JwtAuthGuard } from '../../common/auth/jwt-auth.guard';
import { JwtPayload } from '../../common/auth/jwt-payload.interface';
import { RbacGuard } from '../../common/rbac/rbac.guard';
import { RequirePermission } from '../../common/rbac/permissions.decorator';
import { RequireRoles } from '../../common/rbac/roles.decorator';
import { PrismaService } from '../../common/prisma/prisma.service';
import { AuditService } from '../../common/audit/audit.service';
import { CANDIDATE_PHOTO_LINK_TTL_SECONDS, CANDIDATE_PHOTO_STORAGE, CandidatePhotoStorage } from '../job-seeker/photo-storage';
import { IdCheckPhotoService } from './id-check-photo.service';
import { IdCheckAccessService } from './id-check-access.service';
import { AadhaarQrService } from './aadhaar-qr.service';
import { OtherIdService } from './other-id.service';
import { OtherIdApprovalService } from './other-id-approval.service';
import { ReviewFlagService } from '../review-flag/review-flag.service';
import { StopSubjectType, Under18StopService } from './under18-stop.service';

type Authed = Request & { user: JwtPayload };

const SUBJECT_TYPES: Record<string, StopSubjectType> = { 'job-seekers': 'job_seeker', referrals: 'referral' };

function subjectTypeOf(segment: string): StopSubjectType {
  const type = SUBJECT_TYPES[segment];
  if (!type) throw new NotFoundException('Not found');
  return type;
}

@Controller()
@UseGuards(JwtAuthGuard, RbacGuard)
export class AadhaarQrController {
  constructor(
    private readonly qr: AadhaarQrService,
    private readonly otherIds: OtherIdService,
    private readonly idPhotos: IdCheckPhotoService,
    private readonly access: IdCheckAccessService,
    private readonly stops: Under18StopService,
    private readonly approvals: OtherIdApprovalService,
    private readonly flags: ReviewFlagService,
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    @Inject(CANDIDATE_PHOTO_STORAGE) private readonly photos: CandidatePhotoStorage,
  ) {}

  /** Laboura Field works only on the job seekers this field agent registered himself. */
  private async assertOwnRegistration(req: Authed, jobSeekerId: string): Promise<void> {
    const seeker = await this.prisma.jobSeeker.findUnique({ where: { id: jobSeekerId }, select: { registeredByStaffId: true, anonymisedAt: true } });
    if (!seeker || seeker.anonymisedAt || seeker.registeredByStaffId !== req.user.sub) throw new NotFoundException('Not a job seeker you registered');
  }

  /**
   * Laboura Field, "Scan Aadhaar QR": the field agent scans the QR on the job
   * seeker's card live with the app's camera (no gallery, nothing saved on the
   * phone); only the QR's text comes here. Only for a job seeker he registered
   * himself. His aadhaar_verification consent must already be recorded through
   * his link. The answer says verified, the name match and the masked
   * reference — nothing read from the card. (The app's live-camera rule is how
   * the screen works; the server checks the QR itself — UIDAI's signature —
   * not how it was captured.)
   */
  @Post('field-work/job-seekers/:id/aadhaar-qr')
  @HttpCode(HttpStatus.OK)
  @RequireRoles('field_agent')
  // RbacGuard checks the job seeker named by :id against the field agent's role scope; the rule that
  // it is a job seeker he registered himself is assertOwnRegistration below.
  @RequirePermission('job_seeker', 'write', { kind: 'job_seeker', from: 'param:id' })
  async fieldScan(@Req() req: Authed, @Param('id') id: string, @Body() body: { qrText?: unknown; captureSource?: string }) {
    await this.assertOwnRegistration(req, id);
    if (body?.captureSource !== 'live_camera') throw new BadRequestException('Scan the QR live with the camera');
    return this.qr.checkJobSeeker(id, body.qrText, { channel: 'field', staffId: req.user.sub });
  }

  /**
   * Laboura Field, "Photo of another ID": a live camera photo of the PAN,
   * driving licence or voter ID card and the number typed, for a job seeker
   * this field agent registered himself. Pending until the Team Lead checks it.
   */
  @Post('field-work/job-seekers/:id/other-id')
  @HttpCode(HttpStatus.OK)
  @RequireRoles('field_agent')
  // RbacGuard checks the job seeker named by :id against the field agent's role scope; the rule that
  // it is a job seeker he registered himself is assertOwnRegistration below.
  @RequirePermission('job_seeker', 'write', { kind: 'job_seeker', from: 'param:id' })
  @UseInterceptors(FileInterceptor('photo', { limits: { fileSize: 5 * 1024 * 1024 } }))
  async fieldOtherId(
    @Req() req: Authed,
    @Param('id') id: string,
    @UploadedFile() photo: { buffer: Buffer; mimetype: string } | undefined,
    @Body() body: { idType?: unknown; idNumber?: unknown; captureSource?: unknown; captureNonce?: unknown },
  ) {
    await this.assertOwnRegistration(req, id);
    return this.otherIds.submitForJobSeeker(
      id,
      { idType: body?.idType, idNumber: body?.idNumber, captureSource: body?.captureSource, captureNonce: body?.captureNonce, photo },
      { channel: 'field', staffId: req.user.sub },
    );
  }

  /**
   * Laboura Field opens the camera for the photo of another ID card: a one-time token for that
   * photo (2 minutes, one upload, this job seeker and this field agent).
   */
  @Post('field-work/job-seekers/:id/other-id/capture-nonce')
  @HttpCode(HttpStatus.OK)
  @RequireRoles('field_agent')
  // RbacGuard checks :id against the field agent's role scope; assertOwnRegistration checks it is his registration.
  @RequirePermission('job_seeker', 'write', { kind: 'job_seeker', from: 'param:id' })
  async fieldCaptureNonce(@Req() req: Authed, @Param('id') id: string) {
    await this.assertOwnRegistration(req, id);
    return this.otherIds.issueCaptureNonce('job_seeker', id, { staffId: req.user.sub });
  }

  /**
   * The ID check of a job seeker or referral partner for the Team Lead and
   * the Manager (registrations in their teams) and the CEO: the badge, the
   * masked reference or the last 4 of another ID, the name match, phone linked
   * or not, the under-18 stop, and — while it is kept — the ID photo (from the
   * QR, or of the card) next to the live selfie, both through 5-minute signed
   * links. Every view is audited. Agents never get this.
   */
  /**
   * Rev 169, the fallback: pending other IDs (PAN, driving licence, voter ID) that no other Team
   * Lead of the city can check, for a Manager of that city or the CEO. Never their own registrations.
   */
  @Get('identity/other-id/waiting')
  @RequireRoles('manager', 'ceo')
  async waitingForManager(@Req() req: Authed) {
    const actor = { id: req.user.sub, role: req.user.role };
    const waiting = await this.approvals.waitingFor(actor, 'manager_or_ceo');
    const rows = [];
    for (const item of waiting) {
      const select = { id: true, code: true, name: true, city: true, photoStoragePath: true, registeredByStaffId: true, createdAt: true } as const;
      const person = item.subjectType === 'job_seeker' ? await this.prisma.jobSeeker.findUnique({ where: { id: item.id }, select }) : await this.prisma.referral.findUnique({ where: { id: item.id }, select });
      const check = person ? await this.idPhotos.latestFor(item.subjectType, item.id) : null;
      if (!person || !check) continue;
      const registeredBy = person.registeredByStaffId ? await this.prisma.staff.findUnique({ where: { id: person.registeredByStaffId }, select: { name: true, role: true } }) : null;
      rows.push({
        subjectType: item.subjectType,
        person: { id: person.id, code: person.code, name: person.name, city: person.city },
        registeredBy,
        hasSelfie: Boolean(person.photoStoragePath),
        method: check.method,
        idNumberLast4: check.idNumberLast4,
        sentAt: check.checkedAt,
        photoKept: check.photo.kept,
      });
    }
    return { rows };
  }

  /**
   * Rev 169, the fallback decision by a Manager or the CEO: "Looks right" or "Fake · flag it" on a
   * pending other ID that no other Team Lead of the city can check. Same rules as T-Verify (never
   * one's own registration, the photo must be kept and opened first, one decision wins, refused
   * while an under-18 stop stands); "Fake" opens a flag for the Manager.
   */
  @Post('identity/:subjects/:id/other-id/decision')
  @HttpCode(HttpStatus.OK)
  @RequireRoles('manager', 'ceo')
  async decideOtherId(@Req() req: Authed, @Param('subjects') subjects: string, @Param('id') id: string, @Body() body: { verdict?: unknown; note?: unknown }) {
    const subjectType = subjectTypeOf(subjects);
    const verdict = body?.verdict === 'ok' ? 'ok' : body?.verdict === 'fake' ? 'fake' : null;
    if (!verdict) throw new BadRequestException('verdict is ok or fake');
    const note = typeof body?.note === 'string' ? body.note.trim().slice(0, 500) : '';
    if (verdict === 'fake' && !note) throw new BadRequestException('Say what looks fake');
    const actor = { id: req.user.sub, role: req.user.role };
    const pendingWhere = { status: 'pending', vendor: 'team_lead_check' };
    const pending =
      subjectType === 'job_seeker'
        ? await this.prisma.identityVerification.findFirst({ where: { jobSeekerId: id, ...pendingWhere }, select: { id: true } })
        : await this.prisma.referralIdentityVerification.findFirst({ where: { referralId: id, ...pendingWhere }, select: { id: true } });
    if (!pending) throw new NotFoundException('No ID card waiting for a check');
    const decided = await this.otherIds.recordDecision(subjectType, id, verdict, actor);
    let flagId: string | null = null;
    if (verdict === 'fake') {
      const person =
        subjectType === 'job_seeker'
          ? await this.prisma.jobSeeker.findUnique({ where: { id }, select: { code: true, registeredByStaffId: true } })
          : await this.prisma.referral.findUnique({ where: { id }, select: { code: true, registeredByStaffId: true } });
      const flag = await this.flags.raise({
        kind: 'registration_suspect',
        subjectType,
        subjectId: id,
        raisedForStaffId: person?.registeredByStaffId ?? null,
        details: { [subjectType === 'referral' ? 'referralCode' : 'jobSeekerCode']: person?.code ?? null, note, decidedBy: actor.role },
        owner: { role: 'manager' },
      });
      flagId = flag.id;
    }
    return { verdict, flagId, ...decided };
  }

  @Get('identity/:subjects/:id/aadhaar-check')
  @RequireRoles('team_lead', 'manager', 'ceo')
  async view(@Req() req: Authed, @Param('subjects') subjects: string, @Param('id') id: string) {
    const subjectType = subjectTypeOf(subjects);
    const subject =
      subjectType === 'job_seeker'
        ? await this.prisma.jobSeeker.findUnique({ where: { id }, select: { id: true, code: true, city: true, registeredByStaffId: true, photoStoragePath: true, anonymisedAt: true } })
        : await this.prisma.referral.findUnique({ where: { id }, select: { id: true, code: true, city: true, registeredByStaffId: true, photoStoragePath: true, anonymisedAt: true } });
    if (!subject || subject.anonymisedAt) throw new NotFoundException('Not found');
    const actor = { id: req.user.sub, role: req.user.role };
    const check = await this.idPhotos.latestFor(subjectType, subject.id);
    // Rev 169: whoever may decide a pending other ID (another Team Lead of the city, or a Manager /
    // the CEO where there is none) may open it too, besides the usual team scope.
    const pendingOtherId = check?.status === 'pending' && check.method !== 'aadhaar_qr';
    const right = pendingOtherId ? await this.approvals.rightFor(actor, subject) : null;
    if (!right?.allowed) await this.access.assertCanView(actor, subject.registeredByStaffId);
    const idPhoto = check?.photo.kept ? await this.idPhotos.photoLink(check.verificationId) : null;
    const selfieUrl = subject.photoStoragePath ? await this.photos.signedUrl(subject.photoStoragePath, CANDIDATE_PHOTO_LINK_TTL_SECONDS) : null;
    await this.audit.log({
      actorId: req.user.sub,
      action: 'identity.id_check_viewed',
      entityType: subjectType,
      entityCode: subject.code,
      after: { verificationId: check?.verificationId ?? null, idPhotoLinkIssued: Boolean(idPhoto), selfieLinkIssued: Boolean(selfieUrl), role: req.user.role },
      changedFields: [],
      reason: 'ID check opened (signed links last 5 minutes)',
      city: subject.city,
    });
    return {
      check,
      /** Whether this viewer may decide the pending other ID, and why not. */
      decision: right ? { canDecide: right.allowed, mode: right.mode, reason: right.reason } : null,
      idPhotoUrl: idPhoto?.url ?? null,
      /** Kept for older screens: the same link as idPhotoUrl. */
      qrPhotoUrl: idPhoto?.url ?? null,
      selfieUrl,
      expiresInSeconds: CANDIDATE_PHOTO_LINK_TTL_SECONDS,
    };
  }

  /**
   * Lift a standing under-18 stop (a signed Aadhaar QR showed under 18): only
   * a Manager (registrations in their teams) or the CEO, with a written reason;
   * audited.
   */
  @Post('identity/:subjects/:id/under-18/lift')
  @HttpCode(HttpStatus.OK)
  @RequireRoles('manager', 'ceo')
  async liftUnder18(@Req() req: Authed, @Param('subjects') subjects: string, @Param('id') id: string, @Body() body: { reason?: unknown }) {
    return this.stops.lift({ id: req.user.sub, role: req.user.role }, subjectTypeOf(subjects), id, body?.reason);
  }
}
