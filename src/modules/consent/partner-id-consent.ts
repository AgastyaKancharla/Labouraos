import { Prisma } from '@prisma/client';
import { PrismaService } from '../../common/prisma/prisma.service';

/**
 * The consent a partner's ID check runs under (S2, rev 176): the separate
 * `aadhaar_verification` tick of Referral Partner Terms v1.0. A partner who
 * signed before that tick existed (agreed terms, nothing in the new
 * LegalAcceptance record) keeps working under the agreed terms until they
 * accept v1.0 by re-consent. Returns the consent row id, or null.
 */
export async function partnerIdCheckConsentId(prisma: PrismaService | Prisma.TransactionClient, referralId: string): Promise<string | null> {
  const active = { subjectType: 'referral', subjectId: referralId, granted: true, grantedAt: { not: null }, withdrawnAt: null } as const;
  const idConsent = await prisma.consent.findFirst({ where: { ...active, purpose: 'aadhaar_verification' }, orderBy: { grantedAt: 'desc' }, select: { id: true } });
  if (idConsent) return idConsent.id;
  const accepted = await prisma.legalAcceptance.findFirst({ where: { subjectType: 'referral', subjectId: referralId, documentKey: 'referral_terms' }, select: { id: true } });
  if (accepted) return null;
  const legacy = await prisma.consent.findFirst({ where: { ...active, purpose: 'agreement_terms' }, orderBy: { grantedAt: 'desc' }, select: { id: true } });
  return legacy?.id ?? null;
}
