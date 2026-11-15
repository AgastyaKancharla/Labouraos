/**
 * Tests that charge a job seeker the activation fee: he must have a verified
 * ID first (POST /job-seekers/:id/activation-payment refuses otherwise, the same
 * rule as his own link). This gives him the row an approved other ID leaves:
 * type and last 4 only, name and 18+ confirmed by the Team Lead.
 */
interface IdentityVerificationWriter {
  identityVerification: { create(args: { data: Record<string, unknown> }): Promise<unknown> };
}

export async function giveVerifiedId(prisma: IdentityVerificationWriter, jobSeekerId: string): Promise<void> {
  await prisma.identityVerification.create({
    data: { jobSeekerId, method: 'pan', vendor: 'team_lead_check', status: 'verified', last4: '234F', nameMatches: true, isAdult: true, verifiedAt: new Date() },
  });
}
