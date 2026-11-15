import { ForbiddenException } from '@nestjs/common';
import { ReportingScopeService } from '../staff/reporting-scope.service';
import { PrismaService } from '../../common/prisma/prisma.service';
import { OwnTeam } from '../../common/rbac/own-team';

/** Who a person's growth lists cover: everyone (null) or these staff ids. */
export type StaffScope = string[] | null;

/**
 * CEO: everything. Manager: everyone in his tree. Team Lead: his own team. The person
 * himself is always included, so work he did himself shows too.
 */
export async function staffScopeFor(
  actor: { id: string; role: string },
  reportingScope: ReportingScopeService,
  prisma?: PrismaService,
): Promise<StaffScope> {
  if (actor.role === 'ceo') return null;
  // A Team Lead: the shared own-team definition (OwnTeam), when the caller can supply Prisma.
  if (actor.role === 'team_lead' && prisma) {
    return new OwnTeam(prisma).memberIds(actor.id);
  }
  if (actor.role === 'manager' || actor.role === 'team_lead') {
    return [actor.id, ...(await reportingScope.peopleUnder(actor.id))];
  }
  throw new ForbiddenException('Only the CEO, Managers and Team Leads see this list');
}
