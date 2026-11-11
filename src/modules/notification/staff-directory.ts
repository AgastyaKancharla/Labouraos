/**
 * Everyone's reporting line, loaded once per sweep so working out who gets a
 * notification costs one query, not one per record. Walks the line exactly as
 * ReportingScopeService does: reportsToId, or teamLeadId for an agent.
 */
export interface DirectoryRow {
  id: string;
  code: string;
  name: string;
  role: string;
  status: string;
  reportsToId: string | null;
  teamLeadId: string | null;
}

export interface Chain {
  teamLead: DirectoryRow | null;
  manager: DirectoryRow | null;
  ceo: DirectoryRow | null;
}

const AGENT_ROLES = ['call_agent', 'field_agent'];

export class StaffDirectory {
  private readonly byId: Map<string, DirectoryRow>;

  constructor(readonly rows: DirectoryRow[]) {
    this.byId = new Map(rows.map((row) => [row.id, row]));
  }

  get(id: string | null | undefined): DirectoryRow | null {
    if (!id) return null;
    return this.byId.get(id) ?? null;
  }

  isActive(id: string | null | undefined): boolean {
    return this.get(id)?.status === 'active';
  }

  /** Active staff with this role, in code order. */
  active(role: string): DirectoryRow[] {
    return this.rows
      .filter((row) => row.role === role && row.status === 'active')
      .sort((a, b) => a.code.localeCompare(b.code));
  }

  parentId(row: DirectoryRow): string | null {
    if (row.reportsToId) return row.reportsToId;
    if (AGENT_ROLES.includes(row.role) && row.teamLeadId) return row.teamLeadId;
    return null;
  }

  /** The person's Team Lead, Manager and CEO, walking up the line. */
  chainOf(staffId: string): Chain {
    const chain: Chain = { teamLead: null, manager: null, ceo: null };
    const seen = new Set<string>([staffId]);
    let current = this.byId.get(staffId);
    for (let hop = 0; current && hop < 8; hop += 1) {
      const nextId = this.parentId(current);
      if (!nextId || seen.has(nextId)) break;
      seen.add(nextId);
      const next = this.byId.get(nextId);
      if (!next) break;
      if (next.role === 'team_lead' && !chain.teamLead) chain.teamLead = next;
      else if (next.role === 'manager' && !chain.manager) chain.manager = next;
      else if (next.role === 'ceo' && !chain.ceo) chain.ceo = next;
      current = next;
    }
    return chain;
  }

  /**
   * True when the person has the line the Master Guide requires: an agent →
   * an active Team Lead, a Team Lead → an active Manager, a Manager or Finance
   * → the CEO. The CEO needs none.
   */
  hasLine(row: DirectoryRow): boolean {
    if (row.role === 'ceo') return true;
    const parent = this.get(this.parentId(row));
    if (!parent || parent.status !== 'active') return false;
    if (AGENT_ROLES.includes(row.role)) return parent.role === 'team_lead';
    if (row.role === 'team_lead') return parent.role === 'manager';
    return parent.role === 'ceo';
  }

  /** Active CEOs; the fallback for anything that has nobody else. */
  ceos(): DirectoryRow[] {
    return this.active('ceo');
  }
}
