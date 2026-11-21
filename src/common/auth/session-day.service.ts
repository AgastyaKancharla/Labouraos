import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { PricingService } from '../../modules/pricing/pricing.service';
import { getCalendarPartsInTimezone } from '../time/period-boundary';
import { istClockOn, shiftEndOn, shiftFor } from '../../modules/attendance/staff-shift';
import { minutesToMs, sessionLifetimeEnd, type SessionLifetimeEnd } from './session-lifetime';

/**
 * Hard safety cap on a day-long session: this long after the end of the
 * person's own shift (decided 21 Nov: "keep a hard safety cap, e.g. end of
 * shift + 2 h"). Never shorter than the old limit counted from the sign-in.
 */
export const DAY_SESSION_CAP_AFTER_SHIFT_MS = 2 * 60 * 60 * 1000;

export interface SessionForDayRule {
  staffId: string;
  deviceId: string | null;
  createdAt: Date;
  lastActivityAt: Date;
  absoluteExpiresAt: Date;
}

function istDay(at: Date): string {
  const p = getCalendarPartsInTimezone(at);
  return `${p.year}-${p.month}-${p.day}`;
}

function istDateKey(at: Date): Date {
  const p = getCalendarPartsInTimezone(at);
  return new Date(Date.UTC(p.year, p.month - 1, p.day));
}

/**
 * Staying signed in (Master Guide rev 202, decided 21 Nov): the login code is
 * needed once, at the first sign-in of the day; after that the person stays
 * signed in on that approved device for the whole working day, until they
 * press Log out — no 1-hour-idle or 2-hour sign-out while their attendance day
 * is open. The same for owner accounts and for Team Leads, Managers, Finance
 * and the CEO (the CEO marks no attendance: his day is the IST day he signed in).
 *
 * A session keeps going past the old limits only while all of these hold:
 * - it is on a device id that is still approved for the person;
 * - the person's attendance day is open now (logged in, not logged out or
 *   closed) — for the CEO, the session began today (IST);
 * - it is before the safety cap: the end of the person's own shift + 2 hours
 *   (or the old limit from the sign-in, whichever is later).
 * Log out, a closed day, a removed device, a password change or reset, a lock
 * or a senior ending the session still end it (they revoke it or make the
 * checks above fail; then the old 1-hour/2-hour rule applies again).
 */
@Injectable()
export class SessionDayService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly pricing: PricingService,
  ) {}

  /**
   * Why the session must end now, or null while it may go on: the old idle /
   * maximum-length rule, unless the day-long rule above keeps it going.
   */
  async endFor(session: SessionForDayRule, now: Date): Promise<SessionLifetimeEnd | null> {
    const policy = await this.pricing.current();
    const end = sessionLifetimeEnd(session, now, policy.idleLogoutMinutes);
    if (!end) return null;
    const until = await this.dayLongUntil(session, now);
    return until ? null : end;
  }

  /** The safety cap while the day-long rule applies to this session now, or null when it does not. */
  async dayLongUntil(session: SessionForDayRule, now: Date): Promise<Date | null> {
    if (!session.deviceId) return null;
    const staff = await this.prisma.staff.findUnique({
      where: { id: session.staffId },
      select: { role: true, status: true, shiftStart: true, shiftEnd: true },
    });
    if (!staff || staff.status !== 'active') return null;
    const device = await this.prisma.staffDevice.findUnique({
      where: { staffId_deviceId: { staffId: session.staffId, deviceId: session.deviceId } },
      select: { status: true },
    });
    if (device?.status !== 'approved') return null;
    if (staff.role === 'ceo') {
      if (istDay(session.createdAt) !== istDay(now)) return null;
    } else {
      const day = await this.prisma.attendanceDay.findFirst({
        where: { staffId: session.staffId, date: istDateKey(now), loginAt: { not: null }, logoutAt: null, dayType: 'open' },
        select: { id: true },
      });
      if (!day) return null;
    }
    const policy = await this.pricing.current();
    const shiftCap = shiftEndOn(now, shiftFor(staff, policy)).getTime() + DAY_SESSION_CAP_AFTER_SHIFT_MS;
    const fromSignIn = session.createdAt.getTime() + minutesToMs(policy.maxSessionMinutes);
    // Never past the end of the IST day the session is checked on.
    const endOfDay = istClockOn(now, '23:59').getTime() + 60_000;
    const cap = Math.min(Math.max(shiftCap, fromSignIn), Math.max(endOfDay, fromSignIn));
    return now.getTime() <= cap ? new Date(cap) : null;
  }
}
