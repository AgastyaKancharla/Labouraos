export class ReportClaimDto {
  workerLeftOn!: string;
  reason!: string;
  callRecordId!: string;
  evidencePaths?: string[];
  exitCallRecordId?: string;
}
