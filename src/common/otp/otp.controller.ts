import { Body, Controller, Post, Req, UseGuards, BadRequestException } from '@nestjs/common';
import { Request } from 'express';
import { Throttle } from '@nestjs/throttler';
import { OtpService } from './otp.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { JwtPayload } from '../auth/jwt-payload.interface';
import { AuthThrottlerGuard } from '../auth/auth-throttler.guard';
import { OTP_PURPOSES, OtpPurpose } from './otp.service';

@Controller('otp')
@UseGuards(JwtAuthGuard, AuthThrottlerGuard)
export class OtpController {
  constructor(private readonly otpService: OtpService) {}

  @Throttle({ default: { limit: 5, ttl: 60000 } })
  @Post('send')
  async sendOtp(
    @Body() body: { phone: string; purpose: OtpPurpose; requestId?: string },
    @Req() req: Request & { user: JwtPayload },
  ) {
    if (!body || !body.phone || !body.purpose) {
      throw new BadRequestException('phone and purpose are required');
    }
    if (!(OTP_PURPOSES as readonly string[]).includes(body.purpose)) {
      throw new BadRequestException('Unsupported OTP purpose');
    }
    const result = await this.otpService.sendOtp(
      body.phone,
      body.purpose,
      req.user.sub,
      req.user.role,
      body.requestId,
    );
    if ('alreadyRegistered' in result) return result;
    return {
      success: true,
      requestId: result.requestId,
      resendAvailableAt: result.resendAvailableAt,
      resendsLeft: result.resendsLeft,
    };
  }

  @Throttle({ default: { limit: 5, ttl: 60000 } })
  @Post('verify')
  async verifyOtp(
    @Body() body: { requestId: string; code: string },
    @Req() req: Request & { user: JwtPayload },
  ) {
    if (!body || !body.requestId || !body.code) {
      throw new BadRequestException('requestId and code are required');
    }
    const verified = await this.otpService.verifyOtp(body.requestId, body.code, req.user.sub);
    if (!verified) {
      throw new BadRequestException(
        'Wrong code or inactive request. After five wrong codes, request a fresh OTP.',
      );
    }
    return {
      verified: true,
      requestId: body.requestId,
    };
  }
}
