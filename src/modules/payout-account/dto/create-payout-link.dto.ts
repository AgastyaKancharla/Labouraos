export class CreatePayoutLinkDto {
  ownerType!: 'referral' | 'job_seeker' | 'business';
  ownerId!: string;
}
