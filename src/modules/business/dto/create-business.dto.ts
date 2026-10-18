export class VisitDto {
  latitude!: number;
  longitude!: number;
  selfieUrl?: string;
  selfieHash?: string;
  visitedAt?: string | Date;
}

export class CreateBusinessDto {
  name!: string;
  address?: string;
  area?: string;
  contactPerson?: string;
  contactName?: string;
  phone?: string;
  mobileNumber?: string;
  otpRequestId?: string;
  gstNumber?: string;
  city?: string;
  latitude?: number;
  longitude?: number;
  businessLatitude?: number;
  businessLongitude?: number;
  visitLatitude?: number;
  visitLongitude?: number;
  selfieUrl?: string;
  selfieHash?: string;
  visitedAt?: string | Date;
  visit?: VisitDto;
}

export class RecordVisitDto {
  latitude!: number;
  longitude!: number;
  selfieUrl?: string;
  selfieHash?: string;
  visitedAt?: string | Date;
}
