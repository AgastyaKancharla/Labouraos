import { Injectable } from '@nestjs/common';

@Injectable()
export class AttendanceClock {
  now(): Date {
    return new Date();
  }
}
