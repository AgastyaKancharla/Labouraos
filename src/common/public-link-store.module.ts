import { Global, Module } from '@nestjs/common';
import { PrismaModule } from './prisma/prisma.module';
import { PublicLinkStoreService } from './public-link-store.service';

@Global()
@Module({
  imports: [PrismaModule],
  providers: [PublicLinkStoreService],
  exports: [PublicLinkStoreService],
})
export class PublicLinkStoreModule {}
