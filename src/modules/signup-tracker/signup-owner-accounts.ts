import { PrismaService } from '../../common/prisma/prisma.service';

/**
 * Owner accounts (owner decision 14 Nov, src/modules/staff/owner-account.ts):
 * an owner's own call or field agent account has no attendance, so for
 * sign-up assignment it counts as on shift while it is signed in.
 */
export async function ownerAccountIds(prisma: PrismaService, staffIds: string[]): Promise<Set<string>> {
  if (staffIds.length === 0) return new Set();
  const rows = await prisma.staff.findMany({ where: { id: { in: staffIds }, isOwnerAccount: true }, select: { id: true } });
  return new Set(rows.map((r) => r.id));
}
