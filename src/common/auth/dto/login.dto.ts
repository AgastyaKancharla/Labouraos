export class LoginDto {
  email!: string;
  password!: string;
}

export class LoginResponseDto {
  accessToken!: string;
  staff!: {
    id: string;
    code: string;
    name: string;
    email: string;
    role: string;
    area: string | null;
  };
}
