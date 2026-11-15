import { Prisma } from '@prisma/client';
import { PrismaService } from '../../common/prisma/prisma.service';

/**
 * The consent a partner's ID check runs under (S2, rev 176): the separate
 * `aadhaar_verification` tick of Referral Partner Terms v1.0. A partner who
 * signed the older short terms accepts v1.0 by re-consent first (the ID check
 * answers RECONSENT_REQUIRED until then). Returns the consent row id, or null.
 */
export async function partnerIdCheckConsentId(prisma: PrismaService | Prisma.TransactionClient, referralId: string): Promise<string | null> {
  const active = { subjectType: 'referral', subjectId: referralId, granted: true, grantedAt: { not: null }, withdrawnAt: null } as const;
  const idConsent = await prisma.consent.findFirst({ where: { ...active, purpose: 'aadhaar_verification' }, orderBy: { grantedAt: 'desc' }, select: { id: true } });
  return idConsent?.id ?? null;
}
