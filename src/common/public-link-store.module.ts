import { Global, Module } from '@nestjs/common';
import { PrismaModule } from './prisma/prisma.module';
import { PublicLinkStoreService } from './public-link-store.service';
import { PublicOtpLimiter } from './public-otp-limiter.service';

@Global()
@Module({
  imports: [PrismaModule],
  providers: [PublicLinkStoreService, PublicOtpLimiter],
  exports: [PublicLinkStoreService, PublicOtpLimiter],
})
export class PublicLinkStoreModule {}
