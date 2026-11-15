import {
  Body,
  CanActivate,
  Controller,
  ExecutionContext,
  HttpCode,
  HttpStatus,
  Injectable,
  Post,
  Req,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { Throttle } from '@nestjs/throttler';
import { Request } from 'express';
import { Staff } from '@prisma/client';
import { AuthThrottlerGuard } from '../../common/auth/auth-throttler.guard';
import { Public } from '../../common/rbac/public.decorator';
import { STAFF_PHOTO_MAX_BYTES, assertLiveCameraPhoto } from './staff-photo.service';
import { SetupCompleteInput, StaffSetupService } from './staff-setup.service';

type UploadedPhoto = { buffer: Buffer; mimetype: string } | undefined;
type TicketRequest = Request & { setupHolder?: Staff };

/** The set-up ticket and device id travel in headers on the photo upload, so they are checked before the file is read. */
export const SETUP_TICKET_HEADER = 'x-setup-ticket';
export const SETUP_DEVICE_HEADER = 'x-device-id';

/**
 * Checks the set-up ticket BEFORE the photo is read (as the public selfie
 * pages do, M4), so a wrong or ended ticket never buffers a file.
 */
@Injectable()
export class SetupTicketUploadGuard implements CanActivate {
  constructor(private readonly setup: StaffSetupService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<TicketRequest>();
    request.setupHolder = await this.setup.holderOf(request.headers[SETUP_TICKET_HEADER], request.headers[SETUP_DEVICE_HEADER]);
    return true;
  }
}

/**
 * First-login set-up (Master Guide rev 174–175): reached only with the set-up
 * ticket that signing in with the temporary password gave this device. Not a
 * session: no other route accepts the ticket, and these routes accept nothing
 * else. Throttled like login.
 */
@Controller('auth/setup')
export class StaffSetupController {
  constructor(private readonly setup: StaffSetupService) {}

  /** Step 1: the live camera selfie (only when none is on file or the CEO asked for a new one). */
  @Post('photo')
  @Public('first-login set-up: the set-up ticket from the temporary password sign-in is the proof; live camera selfie only')
  @HttpCode(HttpStatus.OK)
  @UseGuards(AuthThrottlerGuard, SetupTicketUploadGuard)
  @Throttle({ default: { limit: 5, ttl: 60000 } })
  @UseInterceptors(FileInterceptor('photo', { limits: { fileSize: STAFF_PHOTO_MAX_BYTES } }))
  async photo(@Req() req: TicketRequest, @UploadedFile() photo: UploadedPhoto, @Body() body: { captureSource?: string }) {
    const holder = await this.setup.holderOf(req.headers[SETUP_TICKET_HEADER], req.headers[SETUP_DEVICE_HEADER]);
    const checked = assertLiveCameraPhoto(photo, body?.captureSource);
    return this.setup.takePhoto(holder, checked);
  }

  /** CEO, Manager, Finance, Team Lead without an authenticator: the QR code to scan. */
  @Post('authenticator')
  @Public('first-login set-up: the set-up ticket from the temporary password sign-in is the proof')
  @HttpCode(HttpStatus.OK)
  @UseGuards(AuthThrottlerGuard)
  @Throttle({ default: { limit: 5, ttl: 60000 } })
  authenticator(@Body() body: { setupTicket?: unknown; deviceId?: unknown }) {
    return this.setup.startAuthenticator(body?.setupTicket, body?.deviceId);
  }

  /** New password twice (+ the authenticator code): switches the account on; then sign in normally. */
  @Post('complete')
  @Public('first-login set-up: the set-up ticket from the temporary password sign-in is the proof')
  @HttpCode(HttpStatus.OK)
  @UseGuards(AuthThrottlerGuard)
  @Throttle({ default: { limit: 5, ttl: 60000 } })
  complete(@Body() body: SetupCompleteInput) {
    return this.setup.complete(body);
  }
}
