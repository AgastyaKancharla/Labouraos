import { Injectable } from '@nestjs/common';

/** The time the WhatsApp inbox and event messages use; tests replace it to move the clock. */
@Injectable()
export class WhatsAppInboxClock {
  now(): Date {
    return new Date();
  }
}
