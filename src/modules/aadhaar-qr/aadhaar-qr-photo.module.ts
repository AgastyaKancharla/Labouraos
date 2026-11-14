import { Module } from '@nestjs/common';
import { PrismaModule } from '../../common/prisma/prisma.module';
import { AuditModule } from '../../common/audit/audit.module';
import { AadhaarQrPhotoService } from './aadhaar-qr-photo.service';

/**
 * The QR photo's storage, deletion and short-lived links, on its own so the
 * Team Lead screens and the daily retention job can use it without the rest.
 * The candidate-photo storage comes from the global AnonymisationModule.
 */
@Module({
  imports: [PrismaModule, AuditModule],
  providers: [AadhaarQrPhotoService],
  exports: [AadhaarQrPhotoService],
})
export class AadhaarQrPhotoModule {}
