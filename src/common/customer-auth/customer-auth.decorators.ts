import { applyDecorators, createParamDecorator, ExecutionContext, UseGuards } from '@nestjs/common';
import { Public } from '../rbac/public.decorator';
import { CustomerAuthGuard, CustomerPrincipal, CustomerRequest } from './customer-auth.guard';
import { CUSTOMER_ERROR_CODES, customerUnauthorized } from './customer-auth.errors';

export const CUSTOMER_ROUTE_REASON =
  'Customer app (separate realm): CustomerAuthGuard requires a customer access token; staff tokens are refused';

/**
 * Put on every customer API handler that needs a signed-in customer. It is
 * outside the staff login on purpose (marked @Public for the staff route
 * check), and CustomerAuthGuard is its door. Customer sign-in routes that run
 * before there is a token use @Public('...') with their own limits instead.
 */
export function CustomerRoute(): MethodDecorator & ClassDecorator {
  return applyDecorators(Public(CUSTOMER_ROUTE_REASON), UseGuards(CustomerAuthGuard));
}

/** The signed-in customer (set by CustomerAuthGuard). */
export const CurrentCustomer = createParamDecorator((_data: unknown, context: ExecutionContext): CustomerPrincipal => {
  const request = context.switchToHttp().getRequest<CustomerRequest>();
  if (!request.customer) {
    throw customerUnauthorized(CUSTOMER_ERROR_CODES.TOKEN_MISSING, 'Sign in to the Laboura app first');
  }
  return request.customer;
});
