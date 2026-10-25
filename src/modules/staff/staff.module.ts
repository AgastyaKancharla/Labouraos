import { Module } from '@nestjs/common';
import { StaffController } from './staff.controller';
import { StaffService } from './staff.service';
import { PrismaModule } from '../../common/prisma/prisma.module';
import { IdModule } from '../../common/id/id.module';

@Module({
  imports: [PrismaModule, IdModule],
  controllers: [StaffController],
  providers: [StaffService],
  exports: [StaffService],
})
export class StaffModule {}
