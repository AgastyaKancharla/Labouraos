import { Module } from '@nestjs/common';
import { StaffController } from './staff.controller';
import { StaffDeviceController } from './staff-device.controller';
import { StaffDeviceService } from './staff-device.service';
import { StaffService } from './staff.service';
import { PrismaModule } from '../../common/prisma/prisma.module';
import { IdModule } from '../../common/id/id.module';

@Module({
  imports: [PrismaModule, IdModule],
  controllers: [StaffController, StaffDeviceController],
  providers: [StaffService, StaffDeviceService],
  exports: [StaffService, StaffDeviceService],
})
export class StaffModule {}
