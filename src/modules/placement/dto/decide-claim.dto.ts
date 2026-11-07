import { IsIn, IsNotEmpty, IsString } from 'class-validator';

export class DecideClaimDto {
  @IsNotEmpty()
  @IsIn(['accepted', 'rejected'])
  decision!: 'accepted' | 'rejected';

  @IsNotEmpty()
  @IsString()
  decisionReason!: string;
}
