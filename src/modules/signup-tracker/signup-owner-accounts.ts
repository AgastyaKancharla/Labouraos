import { Prisma } from '@prisma/client';
import { PrismaService } from '../../common/prisma/prisma.service';

/**
 * Owner accounts (owner decision 14 Nov): an owner's own call or field agent
 * account has no attendance, so for assignment it counts as on shift while it
 * is signed in. The `Staff.isOwnerAccount` column arrives with the owner
 * accounts change (PR #139). Until that column is in the schema this returns
 * no ids, so every agent is judged by attendance; once it is there, the owner
 * accounts are read from it. Reads only; never writes the column.
 */
export function schemaHasOwnerAccounts(): boolean {
  const staff = Prisma.dmmf.datamodel.models.find((m) => m.name === 'Staff');
  return Boolean(staff?.fields.some((f) => f.name === 'isOwnerAccount'));
}

export async function ownerAccountIds(prisma: PrismaService, staffIds: string[]): Promise<Set<string>> {
  if (staffIds.length === 0 || !schemaHasOwnerAccounts()) return new Set();
  const where = { id: { in: staffIds }, isOwnerAccount: true } as Prisma.StaffWhereInput;
  const rows = await prisma.staff.findMany({ where, select: { id: true } });
  return new Set(rows.map((r) => r.id));
}
