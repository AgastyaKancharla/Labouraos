import { Inject, Injectable, Optional } from '@nestjs/common';
import { OTP_PROVIDER, OtpProvider } from './otp.interface';
import { AuditService } from '../audit/audit.service';

@Injectable()
export class OtpService {
  constructor(
    @Inject(OTP_PROVIDER)
    private readonly provider: OtpProvider,
    @Optional()
    private readonly auditService?: AuditService,
  ) {}

  async sendOtp(phone: string, actorId?: string): Promise<{ requestId: string }> {
    const result = await this.provider.sendOtp(phone);
    if (this.auditService && actorId) {
      await this.auditService.log({
        actorId,
        action: 'otp.send_attempt',
        entityType: 'otp_request',
        entityCode: result.requestId,
        after: {
          phone,
          requestId: result.requestId,
        },
        city: 'Bengaluru',
      });
    }
    return result;
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
