export class CreateStaffDto {
  name!: string;
  email!: string;
  role!: string;
  area?: string; // required for field_agent
  teamLeadId?: string; // call_agent / field_agent only
}
