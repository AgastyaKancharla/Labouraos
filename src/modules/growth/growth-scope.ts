import { ForbiddenException } from '@nestjs/common';
import { ReportingScopeService } from '../staff/reporting-scope.service';

/** Who a person's growth lists cover: everyone (null) or these staff ids. */
export type StaffScope = string[] | null;

/**
 * CEO: everything. Manager: everyone in his tree. Team Lead: his own team. The person
 * himself is always included, so work he did himself shows too.
 */
export async function staffScopeFor(
  actor: { id: string; role: string },
  reportingScope: ReportingScopeService,
): Promise<StaffScope> {
  if (actor.role === 'ceo') return null;
  if (actor.role === 'manager' || actor.role === 'team_lead') {
    return [actor.id, ...(await reportingScope.peopleUnder(actor.id))];
  }
  throw new ForbiddenException('Only the CEO, Managers and Team Leads see this list');
}
