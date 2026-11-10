import { Global, Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { PublicLinkStoreModule } from '../public-link-store.module';
import { MessageModule } from '../../modules/message/message.module';
import { KycModule } from './kyc.module';
import { KycRecoveryService } from './kyc-recovery.service';

@Global()
@Module({
  imports: [PrismaModule, PublicLinkStoreModule, MessageModule, KycModule],
  providers: [KycRecoveryService],
  exports: [KycRecoveryService],
})
export class KycHealthModule {}
