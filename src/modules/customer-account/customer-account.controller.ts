import { Body, Controller, Get, HttpCode, Patch, Put } from '@nestjs/common';
import { CUSTOMER_API_PREFIX } from '../../common/customer-auth/customer-app.constants';
import { CurrentCustomer, CustomerRoute } from '../../common/customer-auth/customer-auth.decorators';
import { CustomerPrincipal } from '../../common/customer-auth/customer-auth.guard';
import { CustomerAccountService } from './customer-account.service';

/** The signed-in customer's own account (docs/customer-app-api.md, "Account"). */
@Controller(CUSTOMER_API_PREFIX)
export class CustomerAccountController {
  constructor(private readonly accounts: CustomerAccountService) {}

  @Get('me')
  @CustomerRoute()
  me(@CurrentCustomer() customer: CustomerPrincipal) {
    return this.accounts.me(customer.accountId);
  }

  @Patch('me')
  @CustomerRoute()
  update(@CurrentCustomer() customer: CustomerPrincipal, @Body() body: Record<string, unknown>) {
    return this.accounts.update(customer.accountId, body ?? {});
  }

  @Put('me/last-profile')
  @HttpCode(204)
  @CustomerRoute()
  async lastProfile(@CurrentCustomer() customer: CustomerPrincipal, @Body() body: { profileId?: unknown }): Promise<void> {
    await this.accounts.setLastProfile(customer.accountId, body?.profileId);
  }
}
