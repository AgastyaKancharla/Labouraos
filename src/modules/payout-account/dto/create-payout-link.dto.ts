export class CreatePayoutLinkDto {
  ownerType!: 'referral' | 'job_seeker' | 'business';
  ownerId!: string;
  /** "Send by SMS" (Finance's small button); otherwise WhatsApp first with SMS as backup (rev 211). */
  channel?: 'whatsapp' | 'sms';
}
