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
  staff!: {
    id: string;
    code: string;
    name: string;
    email: string;
    role: string;
    area: string | null;
  };
}
