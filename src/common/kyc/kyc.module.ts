import { Global, Module } from '@nestjs/common';
import { KYC_PROVIDER } from './kyc.interface';
import { MockKycProvider } from './mock-kyc.provider';
import { KycService } from './kyc.service';

@Global()
@Module({
  providers: [
    {
      provide: KYC_PROVIDER,
      useFactory: () => {
        const rawProvider = process.env.KYC_PROVIDER;
        const providerName =
          rawProvider && rawProvider !== 'undefined' ? rawProvider : 'mock';
        if (providerName === 'mock') {
          return new MockKycProvider();
        }
        throw new Error(`Unsupported KYC provider: ${providerName}`);
      },
    },
    KycService,
  ],
  exports: [KYC_PROVIDER, KycService],
})
export class KycModule {}
