import { Body, Controller, Delete, Get, Headers, HttpCode, HttpStatus, Param, ParseUUIDPipe, Post, Put, Query } from '@nestjs/common';
import { CUSTOMER_API_PREFIX } from '../../common/customer-auth/customer-app.constants';
import { CurrentCustomer, CustomerRoute } from '../../common/customer-auth/customer-auth.decorators';
import { CustomerPrincipal } from '../../common/customer-auth/customer-auth.guard';
import { CustomerInboxService } from './customer-inbox.service';
import { CustomerNotificationSettingsService } from './customer-notification-settings.service';
import { notificationError } from './customer-notification.errors';

/**
 * Inbox, push token and notification settings of the signed-in customer
 * (docs/customer-app-api.md section 9). Every route is the customer realm's
 * door (@CustomerRoute) and works only on the caller's own account.
 */
@Controller(CUSTOMER_API_PREFIX)
export class CustomerNotificationController {
  constructor(
    private readonly inbox: CustomerInboxService,
    private readonly settings: CustomerNotificationSettingsService,
  ) {}

  @Get('me/inbox')
  @CustomerRoute()
  list(@CurrentCustomer() customer: CustomerPrincipal, @Query('cursor') cursor?: string, @Query('limit') limit?: string) {
    return this.inbox.list(customer.accountId, { cursor, limit });
  }

  @Post('me/inbox/read-all')
  @CustomerRoute()
  @HttpCode(204)
  async readAll(@CurrentCustomer() customer: CustomerPrincipal): Promise<void> {
    await this.inbox.markAllRead(customer.accountId);
  }

  @Post('me/inbox/:messageId/read')
  @CustomerRoute()
  @HttpCode(204)
  async read(
    @CurrentCustomer() customer: CustomerPrincipal,
    @Param(
      'messageId',
      new ParseUUIDPipe({ exceptionFactory: () => notificationError(HttpStatus.NOT_FOUND, 'MESSAGE_NOT_FOUND', 'Message not found') }),
    )
    messageId: string,
  ): Promise<void> {
    await this.inbox.markRead(customer.accountId, messageId);
  }

  @Put('me/device')
  @CustomerRoute()
  @HttpCode(204)
  async putDevice(@CurrentCustomer() customer: CustomerPrincipal, @Body() body: unknown): Promise<void> {
    await this.inbox.putDevice(customer, body);
  }

  @Delete('me/device/push-token')
  @CustomerRoute()
  @HttpCode(204)
  async removePushToken(
    @CurrentCustomer() customer: CustomerPrincipal,
    @Headers('x-laboura-installation') installationId?: string,
  ): Promise<void> {
    await this.inbox.removePushToken(customer, typeof installationId === 'string' ? installationId.slice(0, 100) : undefined);
  }

  @Get('me/notification-settings')
  @CustomerRoute()
  getSettings(@CurrentCustomer() customer: CustomerPrincipal) {
    return this.settings.view(customer.accountId);
  }

  @Put('me/notification-settings')
  @CustomerRoute()
  putSettings(@CurrentCustomer() customer: CustomerPrincipal, @Body() body: unknown) {
    return this.settings.update(customer.accountId, body);
  }
}
