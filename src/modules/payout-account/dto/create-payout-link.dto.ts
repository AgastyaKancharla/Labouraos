import { IsIn, IsNotEmpty, IsString } from 'class-validator';

export class CreatePayoutLinkDto {
  @IsIn(['referral', 'job_seeker', 'business'])
  ownerType!: 'referral' | 'job_seeker' | 'business';

  @IsString()
  @IsNotEmpty()
  ownerId!: string;
}
