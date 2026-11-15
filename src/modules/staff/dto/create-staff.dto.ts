export class CreateStaffDto {
  name!: string;
  /** Optional for every role (rev 174–175). */
  email?: string;
  role!: string;
  teamLeadId?: string; // call_agent / field_agent only; written to reportsToId as well
  /** The boss: active or not signed in yet. An owner agent account may report to a CEO. */
  reportsToId?: string;
  /** Call and field agents only: an intern carries the same targets as paid agents. */
  intern?: boolean;
  /**
   * CEO only, call and field agents only: an owner's own agent account. Its
   * work counts in the lists, but not in targets, leaderboard, attendance or salary.
   */
  ownerAccount?: boolean;
  /** Joining date, yyyy-mm-dd (IST calendar day); payroll counts from it. */
  joinedOn?: string | null;
}
