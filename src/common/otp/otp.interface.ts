export const OTP_PROVIDER = 'OTP_PROVIDER';

export interface OtpSendOptions {
  purpose?: string;
  requestId?: string;
}

export interface OtpSendResult {
  requestId: string;
  resendAvailableAt: string;
  resendsLeft: number;
  /**
   * OTP test mode only (mock sender, see otp-test-mode.ts): the code itself,
   * so testers can finish OTP steps. Never set by the real sender.
   */
  testModeCode?: string;
}

export interface OtpProvider {
  sendOtp(phone: string, options?: OtpSendOptions): Promise<OtpSendResult>;
  verifyOtp(requestId: string, code: string): Promise<boolean>;
  /** With `purpose`, the code must have been sent for that purpose (a code from one flow never opens another). */
  isVerified?(requestId: string, phone?: string, purpose?: string): Promise<boolean>;
  consumeVerified?(requestId: string, phone: string, purpose?: string): Promise<boolean>;
  /** The purpose a code was sent for, or null when the request is unknown. */
  getPurpose?(requestId: string): Promise<string | null>;
  getPhoneLast4?(requestId: string): Promise<string | null>;
}
