import { Controller, Get } from '@nestjs/common';
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
}
