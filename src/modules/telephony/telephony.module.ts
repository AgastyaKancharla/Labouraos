import { Module } from '@nestjs/common';
import { TelephonyController } from './telephony.controller';
import { TelephonyService } from './telephony.service';
import { TELEPHONY_PROVIDER } from './telephony.interface';
import { MockTelephonyProvider } from './mock-telephony.provider';
import { RealTelephonyProvider } from './real-telephony.provider';
import { PrismaModule } from '../../common/prisma/prisma.module';
import { PrismaService } from '../../common/prisma/prisma.service';
import { AuditModule } from '../../common/audit/audit.module';
import { AuditService } from '../../common/audit/audit.service';

@Module({
  imports: [PrismaModule, AuditModule],
  controllers: [TelephonyController],
  providers: [
    {
      provide: TELEPHONY_PROVIDER,
      useFactory: (prisma: PrismaService, auditService: AuditService) => {
        const rawProvider = process.env.TELEPHONY_PROVIDER;
        const providerName =
          rawProvider && rawProvider !== 'undefined' ? rawProvider : 'mock';
        if (providerName === 'mock') {
          return new MockTelephonyProvider(prisma);
        }
        if (
          providerName === 'real' ||
          providerName === 'exotel' ||
          providerName === 'twilio'
        ) {
          return new RealTelephonyProvider(prisma, auditService);
        }
        throw new Error(`Unsupported telephony provider: ${providerName}`);
      },
      inject: [PrismaService, AuditService],
    },
    TelephonyService,
  ],
  exports: [TelephonyService, TELEPHONY_PROVIDER],
})
export class TelephonyModule {}
