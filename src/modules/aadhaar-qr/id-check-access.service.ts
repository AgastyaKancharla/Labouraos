import { Injectable, NotFoundException } from '@nestjs/common';
import { ReportingScopeService } from '../staff/reporting-scope.service';

export interface IdCheckActor {
  id: string;
  role: string;
}

/**
 * Who may see a person's ID check: the CEO; a Manager or Team Lead only for
 * registrations made by themselves or by people under them (reporting lines).
 * Agents and Finance never.
 */
@Injectable()
export class IdCheckAccessService {
  constructor(private readonly scope: ReportingScopeService) {}

  async canView(actor: IdCheckActor, registeredByStaffId: string | null): Promise<boolean> {
    if (actor.role === 'ceo') return true;
    if (actor.role !== 'manager' && actor.role !== 'team_lead') return false;
    if (!registeredByStaffId) return false;
    if (registeredByStaffId === actor.id) return true;
    return (await this.scope.peopleUnder(actor.id)).includes(registeredByStaffId);
  }

  async assertCanView(actor: IdCheckActor, registeredByStaffId: string | null): Promise<void> {
    if (!(await this.canView(actor, registeredByStaffId))) throw new NotFoundException('Not a registration in your teams');
  }
}
