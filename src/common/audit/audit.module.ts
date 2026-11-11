import { Global, Module } from '@nestjs/common';
import { AuditService } from './audit.service';
import { AuditInterceptor } from './audit.interceptor';
import { AuditController } from './audit.controller';
import { PrismaModule } from '../prisma/prisma.module';
import { IdModule } from '../id/id.module';
import { ReportingScopeModule } from '../../modules/staff/reporting-scope.module';

@Global()
@Module({
  imports: [PrismaModule, IdModule, ReportingScopeModule],
  controllers: [AuditController],
  providers: [AuditService, AuditInterceptor],
  exports: [AuditService, AuditInterceptor],
})
export class AuditModule {}
