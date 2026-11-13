import {
  Body,
  CanActivate,
  Controller,
  ExecutionContext,
  Get,
  HttpCode,
  HttpStatus,
  Injectable,
  Param,
  Post,
  Req,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { Throttle } from '@nestjs/throttler';
import { Request } from 'express';
import { JwtAuthGuard } from '../../common/auth/jwt-auth.guard';
import { AuthThrottlerGuard } from '../../common/auth/auth-throttler.guard';
import { JwtPayload } from '../../common/auth/jwt-payload.interface';
import { RbacGuard } from '../../common/rbac/rbac.guard';
import { RequireRoles } from '../../common/rbac/roles.decorator';
import { Public } from '../../common/rbac/public.decorator';
import { StaffService } from './staff.service';
import { STAFF_PHOTO_MAX_BYTES, StaffPhotoService, assertLiveCameraPhoto } from './staff-photo.service';

type AuthenticatedRequest = Request & { user: JwtPayload };
type UploadedPhoto = { buffer: Buffer; mimetype: string } | undefined;

const ALL_STAFF = ['ceo', 'manager', 'team_lead', 'call_agent', 'field_agent', 'finance'] as const;

/**
 * Checks the invite token in the address BEFORE the photo is read (as the
 * public selfie pages do, M4), so a wrong or dead link never buffers a file.
 */
@Injectable()
export class InviteTokenUploadGuard implements CanActivate {
  constructor(private readonly staff: StaffService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<Request>();
    await this.staff.staffForInvitePhoto((request.params as Record<string, string | undefined>).token);
    return true;
  }
}

/**
 * Staff photo (guide, "The login code screen", 14 Nov). The invite page and
 * the sign-in gate send a live camera frame; the CEO can ask for a retake.
 */
@Controller('staff')
export class StaffPhotoController {
  constructor(
    private readonly staff: StaffService,
    private readonly photos: StaffPhotoService,
  ) {}

  /** Invite page: the new hire takes their selfie with the one-time invite token (before or after the password). */
  @Post('accept-invite/:token/photo')
  @Public('invite page: the new hire takes their live camera staff photo with the one-time invite token')
  @HttpCode(HttpStatus.OK)
  @UseGuards(AuthThrottlerGuard, InviteTokenUploadGuard)
  @Throttle({ default: { limit: 5, ttl: 60000 } })
  @UseInterceptors(FileInterceptor('photo', { limits: { fileSize: STAFF_PHOTO_MAX_BYTES } }))
  async invitePhoto(@Param('token') token: string, @UploadedFile() photo: UploadedPhoto, @Body() body: { captureSource?: string }) {
    const { id } = await this.staff.staffForInvitePhoto(token);
    assertLiveCameraPhoto(photo, body?.captureSource);
    const saved = await this.photos.save(id, photo, id, 'invite');
    return { photoTakenAt: saved.photoTakenAt };
  }

  /** Signed in: must I take a photo before going on (none yet, or the CEO asked for a new one)? */
  @Get('me/photo')
  @UseGuards(JwtAuthGuard, RbacGuard)
  @RequireRoles(...ALL_STAFF)
  myPhoto(@Req() req: AuthenticatedRequest) {
    return this.photos.status(req.user.sub);
  }

  /** Signed in: take my photo now (live camera only). */
  @Post('me/photo')
  @HttpCode(HttpStatus.OK)
  @UseGuards(JwtAuthGuard, RbacGuard)
  @RequireRoles(...ALL_STAFF)
  @UseInterceptors(FileInterceptor('photo', { limits: { fileSize: STAFF_PHOTO_MAX_BYTES } }))
  async takeMyPhoto(@Req() req: AuthenticatedRequest, @UploadedFile() photo: UploadedPhoto, @Body() body: { captureSource?: string }) {
    assertLiveCameraPhoto(photo, body?.captureSource);
    const saved = await this.photos.save(req.user.sub, photo, req.user.sub, 'login');
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
