import { Module } from '@nestjs/common';
import { PrismaModule } from '../../common/prisma/prisma.module';
import { CustomerAccountController } from './customer-account.controller';
import { CustomerAccountService } from './customer-account.service';
import { CustomerAuthController } from './customer-auth.controller';
import { CustomerLinkingService } from './customer-linking.service';
import { CustomerOtpLimiter } from './customer-otp-limiter.service';
import { CustomerSignInService } from './customer-sign-in.service';
import { GoogleIdTokenVerifier } from './google-id-token.verifier';

/**
 * Customer app: sign-in (mobile + OTP, Google), sessions, account linking,
 * profiles and the account itself. Agent A owns this folder.
 */
@Module({
  imports: [PrismaModule],
  controllers: [CustomerAuthController, CustomerAccountController],
  providers: [CustomerAccountService, CustomerSignInService, CustomerLinkingService, CustomerOtpLimiter, GoogleIdTokenVerifier],
  exports: [CustomerAccountService, CustomerSignInService, CustomerLinkingService],
})
export class CustomerAccountModule {}
