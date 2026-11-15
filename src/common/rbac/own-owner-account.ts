/**
 * A founder's own owner agent account (it reports to them): they may approve
 * for it (owner decision, as for its devices and login codes); the audit row
 * says so plainly.
 */
export function ownOwnerAccount(actorId: string, target: { isOwnerAccount?: boolean | null; reportsToId?: string | null; teamLeadId?: string | null }): boolean {
  return Boolean(target.isOwnerAccount) && (target.reportsToId === actorId || target.teamLeadId === actorId);
}
