import { IsIn, IsNotEmpty, IsOptional, IsString } from 'class-validator';

export class SubmitPayoutAccountDto {
  @IsString()
  @IsNotEmpty()
  token!: string;

  @IsString()
  @IsNotEmpty()
  otpRequestId!: string;

  @IsString()
  @IsNotEmpty()
  otpCode!: string;

  @IsIn(['upi', 'bank'])
  method!: 'upi' | 'bank';

  @IsString()
  @IsOptional()
  upiId?: string;

  @IsString()
  @IsOptional()
  accountNumber?: string;

  @IsString()
  @IsOptional()
  ifsc?: string;
}
