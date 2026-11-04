import { IsIn, IsOptional, IsString, IsBoolean, Matches } from 'class-validator';

export class CreateIdentityVerificationDto {
  @IsString()
  @IsIn(['digilocker', 'aadhaar_qr', 'pan', 'driving_licence', 'voter_id'])
  method: string;

  @IsString()
  @IsOptional()
  vendor?: string;

  @IsString()
  @IsOptional()
  vendorReference?: string;

  @IsString()
  @IsOptional()
  @IsIn(['pending', 'verified', 'failed'])
  status?: string;

  @IsString()
  @IsOptional()
  @Matches(/^\d{4}$/, { message: 'last4 must be exactly 4 digits' })
  last4?: string;

  @IsBoolean()
  @IsOptional()
  nameMatches?: boolean;

  @IsBoolean()
  @IsOptional()
  isAdult?: boolean;

  @IsString()
  @IsOptional()
  failureReason?: string;
}
