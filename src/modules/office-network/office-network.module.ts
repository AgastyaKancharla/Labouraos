import { Module } from '@nestjs/common';
import { PrismaModule } from '../../common/prisma/prisma.module';
import { OfficeNetworkController } from './office-network.controller';
import { OfficeNetworkService } from './office-network.service';

@Module({
  imports: [PrismaModule],
  controllers: [OfficeNetworkController],
  providers: [OfficeNetworkService],
  exports: [OfficeNetworkService],
})
export class OfficeNetworkModule {}
