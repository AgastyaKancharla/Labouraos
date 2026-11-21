import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from '@nestjs/common';
import type { Request } from 'express';
import { Observable, tap } from 'rxjs';
import { AttendanceClock } from './attendance-clock';
import { AttendanceService } from './attendance.service';
import { ATTENDANCE_ROLES } from './attendance-days.service';

/** One activity note per person at most this often (each is a few small writes). */
export const ACTIVITY_NOTE_INTERVAL_MS = 60_000;

const WRITE_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);
/** Attendance and sign-in calls say for themselves what they are (heartbeats, Log out). */
const NOT_ACTIVITY = [/^\/(api\/)?attendance(\/|$)/, /^\/(api\/)?auth(\/|$)/, /^\/(api\/)?live(\/|$)/];

/**
 * Decided 21 Nov: work saved counts as activity. Any write a signed-in person
 * who marks attendance makes successfully — saving a registration, marking a
 * candidate arrived at an interview, recording a selection, a visit, a call
 * note — tells attendance they are present and working: the "Still there?"
 * clock starts again and Idle ends. Reads (lists the screens poll) never count.
 * Never blocks or fails the request.
 */
@Injectable()
export class AttendanceActivityInterceptor implements NestInterceptor {
  private readonly lastNoted = new Map<string, number>();

  constructor(
    private readonly attendance: AttendanceService,
    private readonly clock: AttendanceClock,
  ) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    if (context.getType() !== 'http') return next.handle();
    const req = context.switchToHttp().getRequest<Request & { user?: { sub?: string; role?: string } }>();
    return next.handle().pipe(
      tap(() => {
        const staffId = shouldNote(req);
        if (!staffId) return;
        const now = this.clock.now().getTime();
        const last = this.lastNoted.get(staffId) ?? 0;
        if (now - last < ACTIVITY_NOTE_INTERVAL_MS) return;
        this.lastNoted.set(staffId, now);
        if (this.lastNoted.size > 5000) this.lastNoted.clear();
        void this.attendance.noteActivity(staffId);
      }),
    );
  }
}

/** The staff id to note activity for, or null when this request is not a person's own saved work. */
export function shouldNote(req: { method?: string; path?: string; originalUrl?: string; user?: { sub?: string; role?: string } }): string | null {
  if (!req?.method || !WRITE_METHODS.has(req.method.toUpperCase())) return null;
  const user = req.user;
  if (!user?.sub || typeof user.role !== 'string' || !ATTENDANCE_ROLES.includes(user.role)) return null;
  const path = (req.path ?? req.originalUrl ?? '').split('?')[0];
  if (NOT_ACTIVITY.some((pattern) => pattern.test(path))) return null;
  return user.sub;
}
