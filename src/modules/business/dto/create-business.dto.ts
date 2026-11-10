export class VisitDto {
  latitude!: number;
  longitude!: number;
  selfieUrl?: string;
  selfieHash?: string;
  visitedAt?: string | Date;
}

export class BusinessBranchDto {
  name!: string;
  shopNumber?: string;
  street?: string;
  landmark?: string;
  address?: string;
  locality?: string;
  pincode?: string;
  latitude?: number;
  longitude?: number;
  contactPersonName!: string;
  contactPersonRole!: string;
  contactPersonPhone!: string;
  contactWhatsAppPhone?: string;
  contactLanguage?: string;
  otpRequestId!: string;
}

export class BusinessStaffNeedDto {
  trade!: string;
  headcount!: number;
  salaryMinPaise!: number;
  salaryMaxPaise!: number;
  shift!: string;
  startDate!: string;
  branchName?: string;
  salaryPeriod?: string;
}

export class CreateBusinessDto {
  name!: string;
  legalName?: string;
  familyName?: string;
  ownerName?: string;
  address?: string;
  locality?: string;
  contactPerson?: string;
  additionalContactName?: string;
  additionalContactPhone?: string;
  phone?: string;
  mobileNumber?: string;
  otpRequestId?: string;
  gstNumber?: string;
  businessType?: string;
  employeeCount?: number;
  staffNeeded?: string[];
  staffNeededRows?: BusinessStaffNeedDto[];
  branches?: BusinessBranchDto[];
  contactPersonName?: string;
  contactPersonRole?: string;
  contactWhatsAppPhone?: string;
  contactLanguage?: string;
  employeeCountBand?: string;
  yearsInOperationBand?: string;
  openingTime?: string;
  closingTime?: string;
  workingDays?: string[];
  shopNumber?: string;
  street?: string;
  landmark?: string;
  pincode?: string;
  licenceNumber?: string;
  shopEstablishmentNumber?: string;
  udyamNumber?: string;
  pan?: string;
  fssaiNumber?: string;
  noDocuments?: boolean;
  yearsInOperation?: number;
  hiringFrequency?: string;
  billingName?: string;
  billingAddress?: string;
  billingEmail?: string;
  heardFrom?: string;
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
  purpose?: string;
  ownerOtpRequestId?: string;
  ownerOtpCode?: string;
  assignmentId?: string;
}
