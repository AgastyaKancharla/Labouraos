import { Body, Controller, Get, Param, Post, Req, UploadedFile, UseGuards, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { Request } from 'express';
import { JwtAuthGuard } from '../../common/auth/jwt-auth.guard';
import { JwtPayload } from '../../common/auth/jwt-payload.interface';
import { RbacGuard } from '../../common/rbac/rbac.guard';
import { RequireRoles } from '../../common/rbac/roles.decorator';
import { PiiMaskingInterceptor } from '../../common/rbac/pii-masking.interceptor';
import { MAX_PHOTO_BYTES } from './field-visit.constants';
import { FieldVisitService, OutcomeBody, PhotoFields, UploadedPhoto } from './field-visit.service';

type Authed = Request & { user: JwtPayload };
const photoUpload = FileInterceptor('photo', { limits: { fileSize: MAX_PHOTO_BYTES, files: 1 } });

/**
 * Shop visits from Laboura Field (FA20–FA22, FA06, FA06c). Field agents only,
 * each on their own visits. The writes are sent through the app's offline
 * queue with an Idempotency-Key; the owner's-code step needs signal.
 */
@Controller('field-visits')
@UseGuards(JwtAuthGuard, RbacGuard)
@UseInterceptors(PiiMaskingInterceptor)
export class FieldVisitController {
  constructor(private readonly visits: FieldVisitService) {}

  /** FA20 / FA06 step 2: outside — GPS and the live name-board photo; starts the timer. */
  @Post()
  @RequireRoles('field_agent')
  @UseInterceptors(photoUpload)
  start(@Req() req: Authed, @Body() body: PhotoFields, @UploadedFile() photo?: UploadedPhoto) {
    return this.visits.start(req.user.sub, body ?? {}, photo);
  }

  @Get(':id')
  @RequireRoles('field_agent')
  get(@Req() req: Authed, @Param('id') id: string) {
    return this.visits.get(req.user.sub, id);
  }

  /** FA21 / FA06c: how the visit went (or "onboard now", which leads to the proof). */
  @Post(':id/outcome')
  @RequireRoles('field_agent')
  outcome(@Req() req: Authed, @Param('id') id: string, @Body() body: OutcomeBody) {
    return this.visits.recordOutcome(req.user.sub, id, body ?? {});
  }

  /** FA22 / FA06: selfie with the shop board and the second GPS check. */
  @Post(':id/proof')
  @RequireRoles('field_agent')
  @UseInterceptors(photoUpload)
  proof(@Req() req: Authed, @Param('id') id: string, @Body() body: PhotoFields, @UploadedFile() photo?: UploadedPhoto) {
    return this.visits.recordProof(req.user.sub, id, body ?? {}, photo);
  }

  /** FA06 step 3: the owner's OTP completes a verification visit. */
  @Post(':id/verify')
  @RequireRoles('field_agent')
  verify(@Req() req: Authed, @Param('id') id: string, @Body() body: { ownerOtpRequestId?: string; ownerOtpCode?: string }) {
    return this.visits.completeVerification(req.user.sub, id, body ?? {});
  }

  /** Interview day: "candidate arrived", with GPS at the shop. */
  @Post('interviews/:interviewId/arrived')
  @RequireRoles('field_agent')
  arrived(@Req() req: Authed, @Param('interviewId') interviewId: string, @Body() body: { latitude?: unknown; longitude?: unknown; accuracy?: unknown }) {
    return this.visits.candidateArrived(req.user.sub, interviewId, body ?? {});
  }
}
