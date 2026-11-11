import { Global, Module } from '@nestjs/common';
import { OTP_PROVIDER } from './otp.interface';
import { MockOtpProvider } from './mock-otp.provider';
import { RealOtpProvider } from './real-otp.provider';
import { OtpService } from './otp.service';
import { OtpController } from './otp.controller';
import { AuditModule } from '../audit/audit.module';
import { PrismaModule } from '../prisma/prisma.module';
import { PrismaService } from '../prisma/prisma.service';

@Global()
@Module({
  imports: [AuditModule, PrismaModule],
  controllers: [OtpController],
  providers: [
    {
      provide: OTP_PROVIDER,
      inject: [PrismaService],
      useFactory: (prisma: PrismaService) => {
        const rawProvider = process.env.OTP_PROVIDER_MODE;
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
          const provider = new RealOtpProvider();
          provider.setPrismaService(prisma);
          return provider;
        }
        throw new Error(`Unsupported OTP provider: ${providerName}`);
      },
    },
    OtpService,
  ],
  exports: [OTP_PROVIDER, OtpService],
})
export class OtpModule {}
