export class CreateStaffDto {
  name!: string;
  email!: string;
  role!: string;
  teamLeadId?: string; // call_agent / field_agent only
}
