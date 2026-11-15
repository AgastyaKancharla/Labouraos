import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Req,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { Request } from 'express';
import { JwtAuthGuard } from '../../common/auth/jwt-auth.guard';
import { JwtPayload } from '../../common/auth/jwt-payload.interface';
import { RbacGuard } from '../../common/rbac/rbac.guard';
import { RequireRoles } from '../../common/rbac/roles.decorator';
import { STAFF_PHOTO_MAX_BYTES, StaffPhotoService, assertLiveCameraPhoto } from './staff-photo.service';

type AuthenticatedRequest = Request & { user: JwtPayload };
type UploadedPhoto = { buffer: Buffer; mimetype: string } | undefined;

const ALL_STAFF = ['ceo', 'manager', 'team_lead', 'call_agent', 'field_agent', 'finance'] as const;

/**
 * Staff photo (guide, "The login code screen", 14 Nov). The first-login
 * set-up (StaffSetupController) and the sign-in gate send a live camera
 * frame; the CEO can ask for a retake.
 */
@Controller('staff')
export class StaffPhotoController {
  constructor(private readonly photos: StaffPhotoService) {}

  /** Signed in: must I take a photo before going on (none yet, or the CEO asked for a new one)? */
  @Get('me/photo')
  @UseGuards(JwtAuthGuard, RbacGuard)
  @RequireRoles(...ALL_STAFF)
  myPhoto(@Req() req: AuthenticatedRequest) {
    return this.photos.status(req.user.sub);
  }

  /** Signed in: take my photo now (live camera only) — only when none is on file or the CEO asked for a new one. */
  @Post('me/photo')
  @HttpCode(HttpStatus.OK)
  @UseGuards(JwtAuthGuard, RbacGuard)
  @RequireRoles(...ALL_STAFF)
  @UseInterceptors(FileInterceptor('photo', { limits: { fileSize: STAFF_PHOTO_MAX_BYTES } }))
  async takeMyPhoto(@Req() req: AuthenticatedRequest, @UploadedFile() photo: UploadedPhoto, @Body() body: { captureSource?: string }) {
    const checked = assertLiveCameraPhoto(photo, body?.captureSource);
    const saved = await this.photos.save(req.user.sub, checked, req.user.sub, 'login');
    return { required: false, reason: null, photoTakenAt: saved.photoTakenAt, photoUrl: saved.photoUrl };
  }

  /** CEO: "Ask for a new photo" — they retake it at their next login. Audited. */
  @Post(':id/photo/retake')
  @HttpCode(HttpStatus.OK)
  @UseGuards(JwtAuthGuard, RbacGuard)
  @RequireRoles('ceo')
  requestRetake(@Param('id') id: string, @Req() req: AuthenticatedRequest, @Body() body: { reason?: unknown }) {
    return this.photos.requestRetake(id, { id: req.user.sub, role: req.user.role }, body?.reason);
  }
}
