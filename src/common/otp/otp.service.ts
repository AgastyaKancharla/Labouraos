import { Inject, Injectable } from '@nestjs/common';
import { OTP_PROVIDER, OtpProvider } from './otp.interface';

@Injectable()
export class OtpService {
  constructor(
    @Inject(OTP_PROVIDER)
    private readonly provider: OtpProvider,
  ) {}

  async sendOtp(phone: string): Promise<{ requestId: string }> {
    return this.provider.sendOtp(phone);
  }

  async verifyOtp(requestId: string, code: string): Promise<boolean> {
    return this.provider.verifyOtp(requestId, code);
  }

  async isVerified(requestId: string, phone?: string): Promise<boolean> {
    if (this.provider.isVerified) {
      return this.provider.isVerified(requestId, phone);
    }
    return false;
  }

  getProvider(): OtpProvider {
    return this.provider;
  }
}
