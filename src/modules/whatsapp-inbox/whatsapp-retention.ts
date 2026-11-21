import { Prisma } from '@prisma/client';
import { PrismaService } from '../../common/prisma/prisma.service';
import { getProfileRetentionCutoff } from '../retention/retention.policy';

/**
 * Keeping data for WhatsApp and partner leads (21 Nov review S7), run by the
 * nightly retention job (RetentionService step 9). Batched: a handful of
 * queries per run, never one per row.
 *
 * - Message text follows the call-recording rule: kept WHATSAPP_MESSAGE_BODY_RETENTION_MONTHS
 *   (owner to confirm), longer only while the person has an open dispute
 *   (an open replacement claim or bypass flag); then the text is removed and
 *   only that a message came or went is kept.
 * - A conversation whose person was anonymised, or a new lead nobody
 *   registered with no message for 23 months, loses its number and WhatsApp name.
 * - A partner's lead whose person or partner was anonymised, or closed /
 *   untouched for 23 months, loses its name, number, area and note; the app's
 *   own copy (CustomerReferralLead) loses its name, number and area too.
 */
export const WHATSAPP_MESSAGE_BODY_RETENTION_MONTHS = 12;

export interface WhatsAppRetentionResult {
  messagesCleared: number;
  conversationsAnonymised: number;
  referralLeadsAnonymised: number;
  appLeadsAnonymised?: number;
}

/** The kept subjects: "type:id" of people with an open dispute (their message text stays). */
type ProtectedSubjects = () => Promise<Set<string>>;

const PERSON_TYPES = ['job_seeker', 'business', 'referral'] as const;

function monthsBefore(now: Date, months: number): Date {
  const cutoff = new Date(now.getTime());
  cutoff.setUTCMonth(cutoff.getUTCMonth() - months);
  return cutoff;
}

/** "type:id" of every anonymised record among these. Three queries at most. */
async function anonymisedKeys(prisma: PrismaService, subjects: Array<{ type: string | null; id: string | null }>): Promise<Set<string>> {
  const out = new Set<string>();
  const ids = (type: string) => [...new Set(subjects.filter((s) => s.type === type && s.id).map((s) => s.id as string))];
  const [seekers, businesses, partners] = await Promise.all([
    ids('job_seeker').length ? prisma.jobSeeker.findMany({ where: { id: { in: ids('job_seeker') }, anonymisedAt: { not: null } }, select: { id: true } }) : [],
    ids('business').length ? prisma.business.findMany({ where: { id: { in: ids('business') }, anonymisedAt: { not: null } }, select: { id: true } }) : [],
    ids('referral').length ? prisma.referral.findMany({ where: { id: { in: ids('referral') }, anonymisedAt: { not: null } }, select: { id: true } }) : [],
  ]);
  for (const r of seekers) out.add(`job_seeker:${r.id}`);
  for (const r of businesses) out.add(`business:${r.id}`);
  for (const r of partners) out.add(`referral:${r.id}`);
  return out;
}

/**
 * People with an open dispute, the same rule as call recordings (RetentionService.isCallProtected):
 * an open replacement claim (its job seeker and business) or an open bypass_suspected flag.
 */
export async function openDisputeSubjects(prisma: PrismaService): Promise<Set<string>> {
  const [claims, flags] = await Promise.all([
    prisma.replacementClaim.findMany({
      where: { OR: [{ decision: null }, { decision: 'accepted', placement: { status: { in: ['dropped_out', 'active', 'confirmed'] } } }] },
      select: { placement: { select: { jobSeekerId: true, businessId: true } } },
    }),
    prisma.reviewFlag.findMany({ where: { kind: 'bypass_suspected', status: 'open' }, select: { subjectType: true, subjectId: true } }),
  ]);
  const out = new Set<string>();
  for (const c of claims) {
    if (c.placement?.jobSeekerId) out.add(`job_seeker:${c.placement.jobSeekerId}`);
    if (c.placement?.businessId) out.add(`business:${c.placement.businessId}`);
  }
  for (const f of flags) if ((PERSON_TYPES as readonly string[]).includes(f.subjectType)) out.add(`${f.subjectType}:${f.subjectId}`);
  return out;
}

export async function cleanupWhatsAppData(prisma: PrismaService, now: Date, dryRun: boolean, protectedSubjects: ProtectedSubjects): Promise<WhatsAppRetentionResult> {
  const result: WhatsAppRetentionResult = { messagesCleared: 0, conversationsAnonymised: 0, referralLeadsAnonymised: 0, appLeadsAnonymised: 0 };
  const bodyCutoff = monthsBefore(now, WHATSAPP_MESSAGE_BODY_RETENTION_MONTHS);
  const profileCutoff = getProfileRetentionCutoff(now);

  // 1. Old message text, except for people with an open dispute.
  const withOld = await prisma.whatsAppConversation.findMany({
    where: { messages: { some: { createdAt: { lte: bodyCutoff }, body: { not: null } } } },
    select: { id: true, subjectType: true, subjectId: true },
  });
  if (withOld.length) {
    const kept = await protectedSubjects();
    const ids = withOld.filter((c) => !(c.subjectType && c.subjectId && kept.has(`${c.subjectType}:${c.subjectId}`))).map((c) => c.id);
    if (ids.length) {
      const where = { conversationId: { in: ids }, createdAt: { lte: bodyCutoff }, body: { not: null } };
      result.messagesCleared = dryRun
        ? await prisma.whatsAppMessage.count({ where })
        : (await prisma.whatsAppMessage.updateMany({ where: { conversationId: { in: ids }, createdAt: { lte: bodyCutoff }, body: { not: null } }, data: { body: null } })).count;
    }
  }

  // 2. Conversations of anonymised people, and new leads silent for 23 months.
  const conversations = await prisma.whatsAppConversation.findMany({
    where: { NOT: { phone: { startsWith: 'anon:' } }, OR: [{ subjectId: { not: null } }, { subjectId: null, OR: [{ lastInboundAt: { lte: profileCutoff } }, { lastInboundAt: null, createdAt: { lte: profileCutoff } }] }] },
    select: { id: true, subjectType: true, subjectId: true },
  });
  const goneConvKeys = await anonymisedKeys(prisma, conversations.map((c) => ({ type: c.subjectType, id: c.subjectId })));
  const convIds = conversations.filter((c) => !c.subjectId || goneConvKeys.has(`${c.subjectType}:${c.subjectId}`)).map((c) => c.id);
  result.conversationsAnonymised = convIds.length;
  if (!dryRun && convIds.length) {
    await prisma.whatsAppMessage.updateMany({ where: { conversationId: { in: convIds } }, data: { body: null } });
    await prisma.$executeRaw`
      UPDATE "WhatsAppConversation"
      SET "phone" = 'anon:' || "id", "profileName" = NULL, "outcomeNote" = NULL, "status" = 'closed', "waitingSince" = NULL, "updatedAt" = NOW()
      WHERE "id" IN (${Prisma.join(convIds)})`;
  }

  // 3. Partner leads: of anonymised people or partners, or closed / untouched for 23 months.
  const leads = await prisma.referralLead.findMany({
    where: { NOT: { phone: { startsWith: 'anon:' } } },
    select: { id: true, subjectType: true, subjectId: true, referralId: true, closedAt: true, updatedAt: true, customerLeadId: true },
  });
  const goneLeadKeys = await anonymisedKeys(prisma, [
    ...leads.map((l) => ({ type: l.subjectType, id: l.subjectId })),
    ...leads.map((l) => ({ type: 'referral', id: l.referralId })),
  ]);
  const leadRows = leads.filter((l) =>
    (l.subjectType && l.subjectId && goneLeadKeys.has(`${l.subjectType}:${l.subjectId}`))
    || goneLeadKeys.has(`referral:${l.referralId}`)
    || (l.closedAt ?? l.updatedAt) <= profileCutoff);
  const leadIds = leadRows.map((l) => l.id);
  result.referralLeadsAnonymised = leadIds.length;
  if (!dryRun && leadIds.length) {
    await prisma.$executeRaw`
      UPDATE "ReferralLead"
      SET "name" = 'Anonymised', "phone" = 'anon:' || "id", "area" = NULL, "note" = NULL, "outcomeNote" = NULL, "status" = 'closed', "updatedAt" = NOW()
      WHERE "id" IN (${Prisma.join(leadIds)})`;
  }

  // 4. The app's copy of a lead (customer session's table): with its office lead, or its person anonymised.
  const appLeads = await prisma.customerReferralLead.findMany({
    where: { NOT: { phone: { startsWith: 'anon:' } }, OR: [{ subjectId: { not: null } }, { id: { in: leadRows.map((l) => l.customerLeadId).filter((v): v is string => Boolean(v)) } }] },
    select: { id: true, subjectType: true, subjectId: true },
  });
  const goneApp = await anonymisedKeys(prisma, appLeads.map((a) => ({ type: a.subjectType, id: a.subjectId })));
  const fromOffice = new Set(leadRows.map((l) => l.customerLeadId).filter((v): v is string => Boolean(v)));
  const appIds = appLeads.filter((a) => fromOffice.has(a.id) || (a.subjectType && a.subjectId && goneApp.has(`${a.subjectType}:${a.subjectId}`))).map((a) => a.id);
  result.appLeadsAnonymised = appIds.length;
  if (!dryRun && appIds.length) {
    await prisma.$executeRaw`
      UPDATE "CustomerReferralLead"
      SET "name" = 'Anonymised', "phone" = 'anon:' || "id", "area" = NULL, "updatedAt" = NOW()
      WHERE "id" IN (${Prisma.join(appIds)})`;
  }
  return result;
}
