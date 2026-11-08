export class SubmitPayoutAccountDto {
  token!: string;
  otpRequestId!: string;
  otpCode!: string;
  method!: 'upi' | 'bank';
  upiId?: string;
  accountNumber?: string;
  ifsc?: string;
}
