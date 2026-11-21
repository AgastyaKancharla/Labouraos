import { createHash } from 'crypto';
import { PrismaService } from '../../common/prisma/prisma.service';
import { isIndianMobile, nationalMobileDigits } from '../../common/phone/indian-mobile';

/**
 * "Wrong number" and "do not call" (21 Nov fixes, Master Guide rev 202, "Call
 * results"): both stop automatic retries and messages to the person; "do not
 * call" also blocks calls. A wrong number stops applying by itself once the
 * number on the record changes.
 *
 * Messaging (src/modules/message) should ask `messagesBlocked` before any
 * automatic message; call places ask `callsBlocked`.
 */
export const CONTACT_BLOCK_KINDS = ['wrong_number', 'do_not_call'] as const;
export type ContactBlockKind = (typeof CONTACT_BLOCK_KINDS)[number];

export type BlockSubject = { subjectType: string; subjectId: string };

type Db = Pick<PrismaService, 'contactBlock' | 'jobSeeker' | 'business' | 'referral'>;

function tenDigits(phone: string): string {
  return isIndianMobile(phone) ? nationalMobileDigits(phone) : phone.replace(/\D/g, '').slice(-10);
}

export function phoneHash(phone: string | null | undefined): string {
  return createHash('sha256').update(tenDigits(String(phone ?? ''))).digest('hex');
}

export function liveKeyOf(subject: BlockSubject, kind: ContactBlockKind): string {
  return `${subject.subjectType}|${subject.subjectId}|${kind}`;
}

async function currentPhone(db: Db, subject: BlockSubject): Promise<string | null> {
  if (subject.subjectType === 'job_seeker') {
    return (await db.jobSeeker.findUnique({ where: { id: subject.subjectId }, select: { phone: true } }))?.phone ?? null;
  }
  if (subject.subjectType === 'business') {
    return (await db.business.findUnique({ where: { id: subject.subjectId }, select: { phone: true } }))?.phone ?? null;
  }
  if (subject.subjectType === 'referral') {
    return (await db.referral.findUnique({ where: { id: subject.subjectId }, select: { phone: true } }))?.phone ?? null;
  }
  return null;
}

/**
 * The live blocks for some people, by "subjectType:subjectId". A wrong number
 * recorded on an older phone no longer counts.
 */
export async function liveBlocks(db: Db, subjects: BlockSubject[]): Promise<Map<string, Set<ContactBlockKind>>> {
  const out = new Map<string, Set<ContactBlockKind>>();
  // A hand-built test double without the table has no blocks.
  if (subjects.length === 0 || !db.contactBlock) return out;
  const rows = await db.contactBlock.findMany({
    where: {
      liftedAt: null,
      OR: subjects.map((s) => ({ subjectType: s.subjectType, subjectId: s.subjectId })),
    },
    select: { subjectType: true, subjectId: true, kind: true, phoneHash: true },
  });
  for (const row of rows) {
    if (row.kind === 'wrong_number') {
      const phone = await currentPhone(db, row);
      if (phoneHash(phone) !== row.phoneHash) continue;
    }
    const key = `${row.subjectType}:${row.subjectId}`;
    const set = out.get(key) ?? new Set<ContactBlockKind>();
    set.add(row.kind as ContactBlockKind);
    out.set(key, set);
  }
  return out;
}

export async function blocksFor(db: Db, subject: BlockSubject): Promise<Set<ContactBlockKind>> {
  return (await liveBlocks(db, [subject])).get(`${subject.subjectType}:${subject.subjectId}`) ?? new Set();
}

/** No call may be placed (do not call). */
export async function callsBlocked(db: Db, subject: BlockSubject): Promise<boolean> {
  return (await blocksFor(db, subject)).has('do_not_call');
}

/** No automatic retry or message (wrong number or do not call). */
export async function messagesBlocked(db: Db, subject: BlockSubject): Promise<boolean> {
  return (await blocksFor(db, subject)).size > 0;
}
