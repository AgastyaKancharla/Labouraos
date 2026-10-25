import { Body, Controller, Post, Req, UseGuards, BadRequestException } from '@nestjs/common';
import { Request } from 'express';
import { Throttle } from '@nestjs/throttler';
import { OtpService } from './otp.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { JwtPayload } from '../auth/jwt-payload.interface';
import { AuthThrottlerGuard } from '../auth/auth-throttler.guard';

@Controller('otp')
@UseGuards(JwtAuthGuard, AuthThrottlerGuard)
export class OtpController {
  constructor(private readonly otpService: OtpService) {}

  @Throttle({ default: { limit: 5, ttl: 60000 } })
  @Post('send')
  async sendOtp(
    @Body() body: { phone: string },
    @Req() req?: Request & { user?: JwtPayload },
  ) {
    if (!body || !body.phone) {
      throw new BadRequestException('Phone number is required');
    }
    const result = await this.otpService.sendOtp(body.phone, req?.user?.sub);
    return {
      success: true,
      requestId: result.requestId,
    };
  }

  @Throttle({ default: { limit: 5, ttl: 60000 } })
  @Post('verify')
  async verifyOtp(@Body() body: { requestId: string; code: string }) {
    if (!body || !body.requestId || !body.code) {
      throw new BadRequestException('requestId and code are required');
    }
    const verified = await this.otpService.verifyOtp(body.requestId, body.code);
    if (!verified) {
      throw new BadRequestException('Invalid or expired OTP code');
    }
    return {
      verified: true,
      requestId: body.requestId,
    };
  }
}
