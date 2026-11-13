import { ForgotPasswordService } from './forgot-password.service';
import { Module } from '@nestjs/common';
import { StaffController } from './staff.controller';
import { StaffDeviceController } from './staff-device.controller';
import { StaffDeviceService } from './staff-device.service';
import { StaffService } from './staff.service';
import { PrismaModule } from '../../common/prisma/prisma.module';
import { IdModule } from '../../common/id/id.module';
import { ReportingScopeModule } from './reporting-scope.module';
import { StaffPhotoModule } from './staff-photo.module';
import { InviteTokenUploadGuard, StaffPhotoController } from './staff-photo.controller';

@Module({
  imports: [PrismaModule, IdModule, ReportingScopeModule, StaffPhotoModule],
  controllers: [StaffController, StaffDeviceController, StaffPhotoController],
  providers: [StaffService, StaffDeviceService, ForgotPasswordService, InviteTokenUploadGuard],
  exports: [StaffService, StaffDeviceService],
})
export class StaffModule {}
