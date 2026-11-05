import { Injectable } from '@nestjs/common';

@Injectable()
export class BusinessClock {
  now(): Date {
    return new Date();
  }
}
