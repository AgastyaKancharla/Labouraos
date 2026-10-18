export type HitReason = 'no_pickup' | 'offer_rejected' | 'interview_no_show';

export interface RecordHitDto {
  reason: HitReason;
  note?: string;
  [key: string]: unknown;
}
