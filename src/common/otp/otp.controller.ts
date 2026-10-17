import { Body, Controller, Post, UseGuards, BadRequestException } from '@nestjs/common';
import { OtpService } from './otp.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';

@Controller('otp')
@UseGuards(JwtAuthGuard)
export class OtpController {
  constructor(private readonly otpService: OtpService) {}

  @Post('send')
  async sendOtp(@Body() body: { phone: string }) {
    if (!body || !body.phone) {
      throw new BadRequestException('Phone number is required');
    }
    const result = await this.otpService.sendOtp(body.phone);
    return {
      success: true,
      requestId: result.requestId,
    };
  }

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
