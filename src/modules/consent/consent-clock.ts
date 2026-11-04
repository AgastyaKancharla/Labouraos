import { Injectable } from '@nestjs/common';

@Injectable()
export class ConsentClock {
  now(): Date {
    return new Date();
  }
}
