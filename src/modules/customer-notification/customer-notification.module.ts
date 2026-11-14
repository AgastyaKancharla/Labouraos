import { Module } from '@nestjs/common';

/**
 * Customer app notifications: inbox, push tokens, settings and quiet hours,
 * sending through Expo's push service (docs/customer-app-api.md, "Inbox",
 * "Push token", "Settings"). Agent C owns this folder. Empty shell, registered
 * in AppModule by the foundation so nobody else edits app.module.ts.
 */
@Module({})
export class CustomerNotificationModule {}
