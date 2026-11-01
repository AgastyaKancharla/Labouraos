export class CreateTargetDto {
  staffId!: string;
  year!: number;
  month!: number;
  candidatesActivated?: number | null;
  refundRate?: number | null;
  vacanciesCaptured?: number | null;
  placementsClosed?: number | null;
  replacementsInside15Days?: number | null;
  repeatBusinesses?: number | null;
}
