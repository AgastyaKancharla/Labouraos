import { Injectable, OnModuleInit, Optional } from '@nestjs/common';
import { StaffSignInHooks } from '../../common/auth/sign-in-hooks';
import { AttendanceService } from './attendance.service';

/**
 * The attendance day opens at sign-in (Master Guide rev 206, decided 22 Nov):
 * the first successful sign-in of the IST day of a call agent, field agent,
 * Team Lead or Manager (web console or Laboura Field) starts their day in
 * Start of day. AttendanceService.openAtSignIn decides and never throws.
 */
@Injectable()
export class AttendanceSignInHook implements OnModuleInit {
  constructor(
    private readonly attendance: AttendanceService,
    @Optional() private readonly hooks?: StaffSignInHooks,
  ) {}

  onModuleInit(): void {
    this.hooks?.register('attendance day start', (event) => this.attendance.openAtSignIn(event.staffId, event.location));
  }
}
