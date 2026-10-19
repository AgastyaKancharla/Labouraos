export class RespondPlacementDto {
  response!: 'accepted' | 'rejected';
  rejectionReason?: string;
  note?: string;
}
