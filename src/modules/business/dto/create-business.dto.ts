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
  selfieUrl?: string;
  selfieHash?: string;
}
