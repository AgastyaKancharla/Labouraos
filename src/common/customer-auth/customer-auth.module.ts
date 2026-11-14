import { Global, Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { CustomerAuthClock } from './customer-auth.clock';
import { CustomerAuthGuard } from './customer-auth.guard';
import { CustomerTokenService } from './customer-token.service';
import { CustomerScopeService } from './customer-scope.service';

/**
 * The customer sign-in realm (job seekers, businesses, referral partners).
 * Global so every customer module can use CustomerAuthGuard / @CustomerRoute().
 * Completely separate from src/common/auth (staff): its own key, audience,
 * sessions and guard.
 */
@Global()
@Module({
  imports: [PrismaModule],
  providers: [CustomerAuthClock, CustomerTokenService, CustomerAuthGuard, CustomerScopeService],
  exports: [CustomerAuthClock, CustomerTokenService, CustomerAuthGuard, CustomerScopeService],
})
export class CustomerAuthModule {}
