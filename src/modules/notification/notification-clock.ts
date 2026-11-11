import { Injectable } from '@nestjs/common';

/** The time the bells use; tests replace it to move the clock. */
@Injectable()
export class NotificationClock {
  now(): Date {
    return new Date();
  }
}
