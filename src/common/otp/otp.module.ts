import { Global, Module } from '@nestjs/common';
import { OTP_PROVIDER } from './otp.interface';
import { MockOtpProvider } from './mock-otp.provider';
import { RealOtpProvider } from './real-otp.provider';
import { OtpService } from './otp.service';
import { OtpController } from './otp.controller';

@Global()
@Module({
  controllers: [OtpController],
  providers: [
    {
      provide: OTP_PROVIDER,
      useFactory: () => {
        const rawProvider =
          process.env.OTP_PROVIDER_MODE || process.env.OTP_PROVIDER;
        const providerName =
          rawProvider && rawProvider !== 'undefined' ? rawProvider : 'mock';
        if (providerName === 'mock') {
          return new MockOtpProvider();
        }
        if (
          providerName === 'real' ||
          providerName === 'msg91' ||
          providerName === 'dlt'
        ) {
          return new RealOtpProvider();
        }
        throw new Error(`Unsupported OTP provider: ${providerName}`);
      },
    },
    OtpService,
  ],
  exports: [OTP_PROVIDER, OtpService],
})
export class OtpModule {}
