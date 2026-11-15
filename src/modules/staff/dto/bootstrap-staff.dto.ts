export class BootstrapStaffDto {
  name!: string;
  /** Optional for every role (rev 174–175). */
  email?: string;
  secret?: string;
  bootstrapSecret?: string;
}
