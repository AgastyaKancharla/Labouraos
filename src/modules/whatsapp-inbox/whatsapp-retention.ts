import { PrismaService } from '../../common/prisma/prisma.service';
import { getProfileRetentionCutoff } from '../retention/retention.policy';

/**
 * Keeping data for WhatsApp and partner leads (21 Nov review S7), run by the
 * nightly retention job (RetentionService step 9).
 *
 * - Message text follows the call-recording rule: kept WHATSAPP_MESSAGE_BODY_RETENTION_MONTHS
 *   (owner to confirm), longer only while the person has an open dispute
 *   (an open replacement claim or bypass flag); then the text is removed and
 *   only that a message came or went is kept.
 * - A conversation whose person was anonymised, or a new lead nobody
 *   registered with no message for 23 months, loses its number and WhatsApp name.
 * - A partner's lead whose record was anonymised, or closed / untouched for 23
 *   months, loses its name, number, area and note.
 */
export const WHATSAPP_MESSAGE_BODY_RETENTION_MONTHS = 12;

export interface WhatsAppRetentionResult {
  messagesCleared: number;
  conversationsAnonymised: number;
  referralLeadsAnonymised: number;
}

type Protected = (subjectType: string, subjectId: string) => Promise<boolean>;

function monthsBefore(now: Date, months: number): Date {
  const cutoff = new Date(now.getTime());
  cutoff.setUTCMonth(cutoff.getUTCMonth() - months);
  return cutoff;
}

async function anonymised(prisma: PrismaService, subjectType: string | null, subjectId: string | null): Promise<boolean> {
  if (!subjectType || !subjectId) return false;
  const where = { where: { id: subjectId }, select: { anonymisedAt: true } } as const;
  const row = subjectType === 'job_seeker'
    ? await prisma.jobSeeker.findUnique(where)
    : subjectType === 'business'
      ? await prisma.business.findUnique(where)
      : subjectType === 'referral'
        ? await prisma.referral.findUnique(where)
        : null;
  return Boolean(row?.anonymisedAt);
}

export async function cleanupWhatsAppData(prisma: PrismaService, now: Date, dryRun: boolean, isProtected: Protected): Promise<WhatsAppRetentionResult> {
  const result: WhatsAppRetentionResult = { messagesCleared: 0, conversationsAnonymised: 0, referralLeadsAnonymised: 0 };
  const bodyCutoff = monthsBefore(now, WHATSAPP_MESSAGE_BODY_RETENTION_MONTHS);
  const profileCutoff = getProfileRetentionCutoff(now);

  // 1. Old message text (not while a dispute about the person is open).
  const withOld = await prisma.whatsAppConversation.findMany({
    where: { messages: { some: { createdAt: { lte: bodyCutoff }, body: { not: null } } } },
    select: { id: true, subjectType: true, subjectId: true },
  });
  for (const c of withOld) {
    if (c.subjectType && c.subjectId && (await isProtected(c.subjectType, c.subjectId))) continue;
    if (dryRun) {
      result.messagesCleared += await prisma.whatsAppMessage.count({ where: { conversationId: c.id, createdAt: { lte: bodyCutoff }, body: { not: null } } });
      continue;
    }
    const done = await prisma.whatsAppMessage.updateMany({
      where: { conversationId: c.id, createdAt: { lte: bodyCutoff }, body: { not: null } },
      data: { body: null },
    });
    result.messagesCleared += done.count;
  }

  // 2. Conversations of anonymised people, and new leads silent for 23 months.
  const conversations = await prisma.whatsAppConversation.findMany({
    where: { NOT: { phone: { startsWith: 'anon:' } } },
    select: { id: true, subjectType: true, subjectId: true, lastInboundAt: true, createdAt: true },
  });
  for (const c of conversations) {
    const gone = await anonymised(prisma, c.subjectType, c.subjectId);
    const stale = !c.subjectId && (c.lastInboundAt ?? c.createdAt) <= profileCutoff;
    if (!gone && !stale) continue;
    result.conversationsAnonymised += 1;
    if (dryRun) continue;
    await prisma.whatsAppMessage.updateMany({ where: { conversationId: c.id }, data: { body: null } });
    await prisma.whatsAppConversation.update({
      where: { id: c.id },
      data: { phone: `anon:${c.id}`, profileName: null, outcomeNote: null, status: 'closed', waitingSince: null },
    });
  }

  // 3. Partner leads: of anonymised records, or closed / untouched for 23 months.
  const leads = await prisma.referralLead.findMany({
    where: { NOT: { phone: { startsWith: 'anon:' } } },
    select: { id: true, subjectType: true, subjectId: true, referralId: true, closedAt: true, createdAt: true, updatedAt: true },
  });
  for (const l of leads) {
    const gone = (await anonymised(prisma, l.subjectType, l.subjectId)) || (await anonymised(prisma, 'referral', l.referralId));
    const stale = (l.closedAt ?? l.updatedAt ?? l.createdAt) <= profileCutoff;
    if (!gone && !stale) continue;
    result.referralLeadsAnonymised += 1;
    if (dryRun) continue;
    await prisma.referralLead.update({
      where: { id: l.id },
      data: { name: 'Anonymised', phone: `anon:${l.id}`, area: null, note: null, outcomeNote: null, status: 'closed' },
    });
  }
  return result;
}
