import { PrismaService } from '../../common/prisma/prisma.service';
import { phoneLast4 } from '../../common/phone/indian-mobile';
import { phoneHash } from '../call/contact-block';
import { getCalendarPartsInTimezone } from '../../common/time/period-boundary';

/**
 * "No WhatsApp" (Master Guide rev 211): a number Meta says cannot get WhatsApp
 * messages (error 131026, at sending or in a later "failed" status), or that a
 * call agent marked on the person's profile. Later messages to it go straight
 * by SMS. Kept per phone number (NoWhatsAppPhone, by the same hash as
 * ContactBlock): Meta answers per number, one number can be a job seeker, a
 * business owner and a partner at once, and a record whose number changes
 * starts fresh on its new number.
 */
type Db = Pick<PrismaService, 'noWhatsAppPhone'>;

export type NoWhatsAppSource = 'meta' | 'staff';

export async function isNoWhatsApp(db: Db, phone: string | null | undefined): Promise<boolean> {
  // A hand-built test double without the table: every number may get WhatsApp.
  if (!phone || !db.noWhatsAppPhone) return false;
  const row = await db.noWhatsAppPhone.findUnique({ where: { phoneHash: phoneHash(phone) }, select: { id: true } });
  return Boolean(row);
}

export async function noWhatsAppFor(db: Db, phone: string | null | undefined) {
  if (!phone || !db.noWhatsAppPhone) return null;
  return db.noWhatsAppPhone.findUnique({
    where: { phoneHash: phoneHash(phone) },
    select: { source: true, errorCode: true, createdAt: true, markedByStaffId: true },
  });
}

/** Marks the number (once; a repeat changes nothing). True when it was newly marked. */
export async function markNoWhatsApp(
  db: Db,
  phone: string,
  mark: { source: NoWhatsAppSource; errorCode?: string | null; staffId?: string | null },
): Promise<boolean> {
  if (!db.noWhatsAppPhone) return false;
  try {
    await db.noWhatsAppPhone.create({
      data: {
        phoneHash: phoneHash(phone),
        phoneLast4: phoneLast4(phone),
        source: mark.source,
        errorCode: mark.errorCode ?? null,
        markedByStaffId: mark.staffId ?? null,
      },
    });
    return true;
  } catch (err: unknown) {
    if ((err as { code?: string })?.code === 'P2002') return false;
    throw err;
  }
}

/** Takes the mark off (a call agent found the person does have WhatsApp). True when there was one. */
export async function clearNoWhatsApp(db: Db, phone: string): Promise<boolean> {
  if (!db.noWhatsAppPhone) return false;
  const { count } = await db.noWhatsAppPhone.deleteMany({ where: { phoneHash: phoneHash(phone) } });
  return count > 0;
}

/** Messages go out between 9 AM and 9 PM IST; the backup hour counts only that time. */
export const WORKING_START_HOUR = 9;
export const WORKING_END_HOUR = 21;
const HOUR_MS = 60 * 60 * 1000;
const IST_OFFSET_MS = (5 * 60 + 30) * 60 * 1000;

function istDayStartUtc(at: Date): number {
  const ist = at.getTime() + IST_OFFSET_MS;
  return Math.floor(ist / (24 * HOUR_MS)) * 24 * HOUR_MS - IST_OFFSET_MS;
}

/**
 * The moment `ms` of working time (9 AM–9 PM IST) has passed after `from`:
 * a WhatsApp sent at 8:30 PM with a 1-hour wait is due at 9:30 AM the next
 * day; one sent at 7 AM is due at 10 AM.
 */
export function addWorkingTime(from: Date, ms: number): Date {
  let remaining = ms;
  let cursor = from.getTime();
  for (let guard = 0; guard < 400; guard += 1) {
    const dayStart = istDayStartUtc(new Date(cursor));
    const open = dayStart + WORKING_START_HOUR * HOUR_MS;
    const close = dayStart + WORKING_END_HOUR * HOUR_MS;
    if (cursor < open) cursor = open;
    if (cursor >= close) {
      cursor = dayStart + 24 * HOUR_MS + WORKING_START_HOUR * HOUR_MS;
      continue;
    }
    const available = close - cursor;
    if (remaining <= available) return new Date(cursor + remaining);
    remaining -= available;
    cursor = dayStart + 24 * HOUR_MS + WORKING_START_HOUR * HOUR_MS;
  }
  return new Date(cursor);
}

/** True between 9 AM and 9 PM IST. */
export function inWorkingHours(at: Date): boolean {
  const hour = getCalendarPartsInTimezone(at, 'Asia/Kolkata').hour;
  return hour >= WORKING_START_HOUR && hour < WORKING_END_HOUR;
}
