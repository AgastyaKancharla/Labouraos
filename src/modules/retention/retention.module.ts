import { Module } from '@nestjs/common';
import { PrismaModule } from '../../common/prisma/prisma.module';
import { AnonymisationModule } from '../../common/anonymisation/anonymisation.module';
import { CallModule } from '../call/call.module';
import { ConsentModule } from '../consent/consent.module';
import { RetentionService } from './retention.service';

@Module({
  imports: [PrismaModule, AnonymisationModule, CallModule, ConsentModule],
  providers: [RetentionService],
  exports: [RetentionService],
})
export class RetentionModule {}
