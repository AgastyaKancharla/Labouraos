export class VisitDto {
  latitude!: number;
  longitude!: number;
  selfieUrl?: string;
  selfieHash?: string;
  visitedAt?: string | Date;
}

export class CreateBusinessDto {
  name!: string;
  legalName?: string;
  ownerName?: string;
  address?: string;
  locality?: string;
  area?: string;
  contactPerson?: string;
  contactName?: string;
  additionalContactName?: string;
  additionalContactPhone?: string;
  phone?: string;
  mobileNumber?: string;
  otpRequestId?: string;
  gstNumber?: string;
  businessType?: string;
  employeeCount?: number;
  staffNeeded?: string[];
  licenceNumber?: string;
  shopEstablishmentNumber?: string;
  udyamNumber?: string;
  pan?: string;
  yearsInOperation?: number;
  hiringFrequency?: string;
  billingName?: string;
  billingAddress?: string;
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
