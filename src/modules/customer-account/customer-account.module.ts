import { Module } from '@nestjs/common';
import { PrismaModule } from '../../common/prisma/prisma.module';
import { CustomerAccountController } from './customer-account.controller';
import { CustomerAccountService } from './customer-account.service';

/**
 * Customer app: sign-in (mobile + OTP, Google), sessions, account linking,
 * profiles and the account itself. Agent A owns this folder.
 */
@Module({
  imports: [PrismaModule],
  controllers: [CustomerAccountController],
  providers: [CustomerAccountService],
  exports: [CustomerAccountService],
})
export class CustomerAccountModule {}
