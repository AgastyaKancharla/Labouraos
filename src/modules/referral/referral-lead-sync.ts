import { PrismaService } from '../../common/prisma/prisma.service';
import { mobileLookupValues } from '../../common/phone/indian-mobile';

/**
 * The Laboura app's "Send a lead" (customer session, `CustomerReferralLead`,
 * docs/customer-app-api.md §7.3b) and the office's partner lead list
 * (`ReferralLead`) are one queue: every new app lead is picked up into
 * `ReferralLead` (source `app`) by the WhatsApp sweep, assigned like a missed
 * call, and its status follows the office lead (contacted when an agent has
 * it, then registered / not_interested / closed) so the partner's app shows
 * the right stage.
 */
export function lookingForOf(kind: string | null): string {
  if (kind === 'business') return 'staff';
  if (kind === 'job_seeker') return 'job';
  return 'unknown';
}

/** Picks up new app leads (oldest first). Returns how many became office leads. */
export async function pickUpAppLeads(prisma: PrismaService, now: Date): Promise<number> {
  const fresh = await prisma.customerReferralLead.findMany({
    where: { status: 'new' },
    orderBy: { createdAt: 'asc' },
    take: 200,
    select: { id: true, referralId: true, kind: true, name: true, phone: true, area: true, createdAt: true },
  });
  let picked = 0;
  for (const lead of fresh) {
    const already = await prisma.referralLead.findUnique({ where: { customerLeadId: lead.id }, select: { id: true } });
    if (already) continue;
    // The same person already sent from the share link page: one lead, now tied to the app row.
    const open = await prisma.referralLead.findFirst({
      where: { referralId: lead.referralId, phone: { in: mobileLookupValues(lead.phone) }, status: 'open', customerLeadId: null },
      select: { id: true },
    });
    if (open) {
      await prisma.referralLead.update({ where: { id: open.id }, data: { customerLeadId: lead.id } });
      continue;
    }
    try {
      await prisma.referralLead.create({
        data: {
          referralId: lead.referralId,
          name: lead.name,
          phone: lead.phone,
          lookingFor: lookingForOf(lead.kind),
          area: lead.area,
          source: 'app',
          status: 'open',
          customerLeadId: lead.id,
          createdAt: lead.createdAt,
        },
      });
      picked += 1;
    } catch (error) {
      if ((error as { code?: string })?.code !== 'P2002') throw error;
    }
  }
  void now;
  return picked;
}

/** An agent has it: the app shows "with our team" (contacted). */
export async function markAppLeadContacted(prisma: PrismaService, customerLeadId: string | null | undefined): Promise<void> {
  if (!customerLeadId) return;
  await prisma.customerReferralLead.updateMany({ where: { id: customerLeadId, status: 'new' }, data: { status: 'contacted' } });
}

/** The office closed the lead: the app row follows (registered with the record, not_interested or closed). */
export async function closeAppLead(
  prisma: PrismaService,
  customerLeadId: string | null | undefined,
  outcome: string,
  subject: { type: string; id: string } | null,
): Promise<void> {
  if (!customerLeadId) return;
  const status = outcome === 'registered' || outcome === 'already_registered' ? 'registered' : outcome === 'not_interested' ? 'not_interested' : 'closed';
  await prisma.customerReferralLead.updateMany({
    where: { id: customerLeadId },
    data: { status, subjectType: subject?.type ?? null, subjectId: subject?.id ?? null },
  });
}
