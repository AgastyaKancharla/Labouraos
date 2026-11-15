import { Injectable } from '@nestjs/common';

/** "Now" for the sign-up tracker, so tests can fix the time. */
@Injectable()
export class SignupTrackerClock {
  now(): Date {
    return new Date();
  }
}
