import { IsArray, IsISO8601, IsNotEmpty, IsOptional, IsString } from 'class-validator';

export class ReportClaimDto {
  @IsNotEmpty()
  @IsISO8601()
  workerLeftOn!: string;

  @IsNotEmpty()
  @IsString()
  reason!: string;

  @IsNotEmpty()
  @IsString()
  callRecordId!: string;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  evidencePaths?: string[];

  @IsOptional()
  @IsString()
  exitCallRecordId?: string;
}
