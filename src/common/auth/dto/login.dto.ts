export class LoginDto {
  staffCode?: string;
  password?: string;
  /** Required for every role. */
  deviceId?: string;
  /** Management accounts only. */
  totpCode?: string;
  /**
   * Accepted on the body only so a request that still sends an email can be
   * refused. It is never used to find an account.
   */
  email?: string;
}

export class VerifyLoginCodeDto {
  loginRequestId?: string;
  code?: string;
}

export class LoginResponseDto {
  accessToken!: string;
  sessionId?: string;
  /** True when the token is limited to TOTP enrolment (management, not enrolled yet). */
  totpEnrollmentRequired?: boolean;
  staff!: {
    id: string;
    code: string;
    name: string;
    email: string | null;
    role: string;
    area: string | null;
  };
}

/** Non-management login, after the device and office checks. No token yet. */
export class AwaitingCodeResponseDto {
  status!: 'awaiting_code';
  loginRequestId!: string;
  expiresAt!: Date;
}

export type LoginResult = LoginResponseDto | AwaitingCodeResponseDto;
