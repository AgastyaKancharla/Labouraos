import { Module } from '@nestjs/common';
import { PrismaModule } from '../../common/prisma/prisma.module';
import { ReportingScopeModule } from '../staff/reporting-scope.module';
import { StaffPhotoModule } from '../staff/staff-photo.module';
import { StaffModule } from '../staff/staff.module';
import { PasswordResetApprovalController, PasswordResetPublicController } from './password-reset.controller';
import { PasswordResetService } from './password-reset.service';

/** "Forgot password" by a senior's reset code (Master Guide rev 174–175). */
@Module({
  imports: [PrismaModule, ReportingScopeModule, StaffPhotoModule, StaffModule],
  controllers: [PasswordResetPublicController, PasswordResetApprovalController],
  providers: [PasswordResetService],
  exports: [PasswordResetService],
})
export class PasswordResetModule {}
