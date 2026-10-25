export class LoginDto {
  email!: string;
  password!: string;
  totpCode?: string;
  deviceId?: string;
  stepUpTotpCode?: string;
}

export class LoginResponseDto {
  accessToken!: string;
  sessionId?: string;
  /** True when the token is limited to TOTP enrolment (account not enrolled yet). */
  totpEnrollmentRequired?: boolean;
  staff!: {
    id: string;
    code: string;
    name: string;
    email: string;
    role: string;
    area: string | null;
  };
}
