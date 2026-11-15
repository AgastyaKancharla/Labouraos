import { Module } from '@nestjs/common';
import { PrismaModule } from '../../common/prisma/prisma.module';
import { CustomerAuthModule } from '../../common/customer-auth/customer-auth.module';
import { CustomerInboxService } from './customer-inbox.service';
import { CustomerNotificationClock } from './customer-notification.clock';
import { CustomerNotificationController } from './customer-notification.controller';
import { CustomerNotificationHooks } from './customer-notification-hooks.service';
import { CustomerNotificationService } from './customer-notification.service';
import { CustomerNotificationSettingsService } from './customer-notification-settings.service';
import { CustomerPushKick } from './customer-push-kick';
import { CustomerPushSenderService } from './customer-push-sender.service';
import { createCustomerPushProvider, CUSTOMER_PUSH_PROVIDER } from './push-provider';

/**
 * Customer app notifications: inbox, push tokens, settings and quiet hours,
 * sending through Expo's push service from the background worker
 * (docs/customer-app-api.md section 9). Agent C owns this folder.
 *
 * Other modules import this module and call CustomerNotificationService
 * (notify) or CustomerNotificationHooks (their existing events). It imports
 * only PrismaModule and the customer sign-in module, so importing it can
 * never make a module cycle.
 */
@Module({
  // CustomerAuthModule is global in the app; imported here too so a test that
  // builds only one module (PaymentModule, VacancyModule…) still has the guard.
  imports: [PrismaModule, CustomerAuthModule],
  controllers: [CustomerNotificationController],
  providers: [
    CustomerNotificationClock,
    CustomerNotificationSettingsService,
    CustomerNotificationService,
    CustomerNotificationHooks,
    CustomerInboxService,
    CustomerPushKick,
    CustomerPushSenderService,
    { provide: CUSTOMER_PUSH_PROVIDER, useFactory: () => createCustomerPushProvider() },
  ],
  exports: [CustomerNotificationService, CustomerNotificationHooks, CustomerPushSenderService, CUSTOMER_PUSH_PROVIDER],
})
export class CustomerNotificationModule {}
