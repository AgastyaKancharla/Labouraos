import { Injectable } from '@nestjs/common';

@Injectable()
export class CallClock {
  now(): Date {
    return new Date();
  }
}
