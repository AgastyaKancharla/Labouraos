export class CreateStaffDto {
  name!: string;
  email!: string;
  role!: string;
  teamLeadId?: string; // call_agent / field_agent only; written to reportsToId as well
  reportsToId?: string;
  /** Call and field agents only: an intern carries the same targets as paid agents. */
  intern?: boolean;
  /** First working day, yyyy-mm-dd (IST calendar day). */
  startsOn?: string | null;
}
