export class RecordDropoutDto {
  eligibility!: 'employee_left' | 'business_breach';
  dropoutReportedAt?: string;
  reason?: string;
}
