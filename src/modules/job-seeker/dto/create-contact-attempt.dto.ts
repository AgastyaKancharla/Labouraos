export interface CreateContactAttemptDto {
  channel: 'call' | 'whatsapp' | 'sms';
  outcome: 'picked_up' | 'no_pickup';
  attemptedAt?: string | Date;
  timeOfDay: 'am' | 'pm';
  [key: string]: unknown;
}
