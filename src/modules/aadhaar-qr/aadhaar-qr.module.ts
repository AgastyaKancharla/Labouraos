import { Module } from '@nestjs/common';
import { PrismaModule } from '../../common/prisma/prisma.module';
import { AuditModule } from '../../common/audit/audit.module';
import { ReviewFlagModule } from '../review-flag/review-flag.module';
import { ReportingScopeModule } from '../staff/reporting-scope.module';
import { IdCheckPhotoModule } from './id-check-photo.module';
import { AadhaarQrController } from './aadhaar-qr.controller';
import { AadhaarQrService } from './aadhaar-qr.service';

/** The in-house Aadhaar Secure QR check (guide, 14 Nov). The public link endpoints live with each link's controller. */
@Module({
  imports: [PrismaModule, AuditModule, ReviewFlagModule, ReportingScopeModule, IdCheckPhotoModule],
  controllers: [AadhaarQrController],
  providers: [AadhaarQrService],
  exports: [AadhaarQrService, IdCheckPhotoModule],
})
export class AadhaarQrModule {}
