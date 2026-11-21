import { StaffPhotoModule } from '../staff/staff-photo.module';
import { Module } from '@nestjs/common';
import { PrismaModule } from '../../common/prisma/prisma.module';
import { PricingModule } from '../pricing/pricing.module';
import { ReportingScopeModule } from '../staff/reporting-scope.module';
import { LoginCodeController } from './login-code.controller';
import { Clock, LoginCodeService } from './login-code.service';
import { NotificationModule } from '../notification/notification.module';
import { SignInBellsService } from './sign-in-bells.service';

@Module({
  imports: [PrismaModule, PricingModule, ReportingScopeModule, StaffPhotoModule, NotificationModule],
  controllers: [LoginCodeController],
  providers: [LoginCodeService, Clock, SignInBellsService],
  exports: [LoginCodeService, SignInBellsService],
})
export class LoginCodeModule {}
