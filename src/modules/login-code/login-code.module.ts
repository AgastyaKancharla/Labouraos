import { Module } from '@nestjs/common';
import { PrismaModule } from '../../common/prisma/prisma.module';
import { PricingModule } from '../pricing/pricing.module';
import { ReportingScopeModule } from '../staff/reporting-scope.module';
import { LoginCodeController } from './login-code.controller';
import { Clock, LoginCodeService } from './login-code.service';

@Module({
  imports: [PrismaModule, PricingModule, ReportingScopeModule],
  controllers: [LoginCodeController],
  providers: [LoginCodeService, Clock],
  exports: [LoginCodeService],
})
export class LoginCodeModule {}
