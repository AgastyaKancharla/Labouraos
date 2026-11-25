/**
 * Gives a job seeker the row an approved other ID leaves (type and last 4 only,
 * name and 18+ confirmed by the Team Lead). Since rev 211 (25 Nov) payment no
 * longer needs it, but his 30 days start only once he is paid AND ID-verified:
 * tests that expect an active job seeker after the ₹499 give him this first.
 */
interface IdentityVerificationWriter {
  identityVerification: { create(args: { data: Record<string, unknown> }): Promise<unknown> };
}

export async function giveVerifiedId(prisma: IdentityVerificationWriter, jobSeekerId: string): Promise<void> {
  await prisma.identityVerification.create({
    data: { jobSeekerId, method: 'pan', vendor: 'team_lead_check', status: 'verified', last4: '234F', nameMatches: true, isAdult: true, verifiedAt: new Date() },
  });
}
