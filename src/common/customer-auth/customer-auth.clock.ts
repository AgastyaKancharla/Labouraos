import { Injectable } from '@nestjs/common';

/** Injectable time for the customer realm (tests move it). */
@Injectable()
export class CustomerAuthClock {
  now(): Date {
    return new Date();
  }
}
