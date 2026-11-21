import { Module } from '@nestjs/common';
import { StaffController } from './staff.controller';
import { StaffDeviceController } from './staff-device.controller';
import { StaffDeviceService } from './staff-device.service';
import { StaffService } from './staff.service';
import { PrismaModule } from '../../common/prisma/prisma.module';
import { IdModule } from '../../common/id/id.module';
import { ReportingScopeModule } from './reporting-scope.module';
import { StaffPhotoModule } from './staff-photo.module';
import { StaffPhotoController } from './staff-photo.controller';
import { NotificationModule } from '../notification/notification.module';
import { LoginCodeModule } from '../login-code/login-code.module';
import { ResetAftermathService } from './reset-aftermath.service';
import { StaffSetupService } from './staff-setup.service';
import { SetupTicketUploadGuard, StaffSetupController } from './staff-setup.controller';

@Module({
  imports: [PrismaModule, IdModule, ReportingScopeModule, StaffPhotoModule, NotificationModule, LoginCodeModule],
  controllers: [StaffController, StaffDeviceController, StaffPhotoController, StaffSetupController],
  providers: [StaffService, StaffDeviceService, StaffSetupService, ResetAftermathService, SetupTicketUploadGuard],
  exports: [StaffService, StaffDeviceService, ResetAftermathService],
})
export class StaffModule {}
