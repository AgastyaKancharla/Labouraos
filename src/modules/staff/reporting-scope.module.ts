import { Module } from '@nestjs/common';
import { PrismaModule } from '../../common/prisma/prisma.module';
import { ReportingScopeService } from './reporting-scope.service';

@Module({
  imports: [PrismaModule],
  providers: [ReportingScopeService],
  exports: [ReportingScopeService],
})
export class ReportingScopeModule {}
