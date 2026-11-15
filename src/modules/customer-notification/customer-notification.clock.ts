import { Injectable } from '@nestjs/common';

/** Injectable time for customer notifications (AGENTS.md section 9: tests move it). */
@Injectable()
export class CustomerNotificationClock {
  now(): Date {
    return new Date();
  }
}
