import { UnauthorizedException } from '@nestjs/common';
import { JwtModule, JwtService } from '@nestjs/jwt';
import { Test, TestingModule } from '@nestjs/testing';
import * as bcrypt from 'bcrypt';
import { AuthService } from './auth.service';
import { TotpService } from './totp.service';
import { PrismaService } from '../prisma/prisma.service';
import { JwtPayload } from './jwt-payload.interface';

describe('Staff Authentication', () => {
  let authService: AuthService;
  let jwtService: JwtService;
  let prisma: PrismaService;
  let testStaffId: string;
  const testEmail = `staff_auth_${Date.now()}@laboura.local`;
  const rawPassword = 'StrongPassword123!';

  beforeAll(async () => {
    prisma = new PrismaService();
    await prisma.$connect();

    const module: TestingModule = await Test.createTestingModule({
      imports: [
        JwtModule.register({
          secret: 'test_jwt_secret_key_minimum_32_characters_length',
          signOptions: { expiresIn: '1h' },
        }),
      ],
      providers: [
        AuthService,
        TotpService,
        {
          provide: PrismaService,
          useValue: prisma,
        },
      ],
    }).compile();

    authService = module.get<AuthService>(AuthService);
    jwtService = module.get<JwtService>(JwtService);

    // Seed staff member with hashed password
    const passwordHash = await authService.hashPassword(rawPassword);

    // Verify hash is not plain text
    expect(passwordHash).not.toBe(rawPassword);
    expect(await bcrypt.compare(rawPassword, passwordHash)).toBe(true);

    const staff = await prisma.staff.create({
      data: {
        code: `CA-${Date.now()}`,
        name: 'Auth Test Agent',
        email: testEmail,
        passwordHash,
        role: 'call_agent',
        area: 'Koramangala',
        city: 'Bengaluru',
      },
    });

    testStaffId = staff.id;
  });

  afterAll(async () => {
    if (testStaffId) {
      await prisma.staff.delete({ where: { id: testStaffId } });
    }
    await prisma.$disconnect();
  });

  it('valid login succeeds and returns a valid token carrying id and role', async () => {
    const response = await authService.login({
      email: testEmail,
      password: rawPassword,
    });

    expect(response).toBeDefined();
    expect(response.accessToken).toBeDefined();
    expect(typeof response.accessToken).toBe('string');

    // Token carries id and role
    const decoded = jwtService.decode(response.accessToken) as JwtPayload;
    expect(decoded).toBeDefined();
    expect(decoded.sub).toBe(testStaffId);
    expect(decoded.role).toBe('call_agent');

    // Password must never appear in response
    const jsonString = JSON.stringify(response);
    expect(jsonString).not.toContain(rawPassword);
    expect(jsonString).not.toContain('passwordHash');
    expect(jsonString).not.toContain('$2b$');
  });

  it('wrong password fails with UnauthorizedException', async () => {
    await expect(
      authService.login({
        email: testEmail,
        password: 'WrongPassword!',
      }),
    ).rejects.toThrow(UnauthorizedException);
  });

  it('non-existent email fails with UnauthorizedException', async () => {
    await expect(
      authService.login({
        email: 'nobody@laboura.local',
        password: rawPassword,
      }),
    ).rejects.toThrow(UnauthorizedException);
  });

  it('expired token is rejected', async () => {
    // Generate an already expired token (-1 second)
    const expiredToken = await jwtService.signAsync(
      { sub: testStaffId, role: 'call_agent' },
      { expiresIn: '-1s' },
    );

    await expect(authService.verifyToken(expiredToken)).rejects.toThrow(
      UnauthorizedException,
    );
  });

  it('ensures password is never logged or exposed in returned staff profile', async () => {
    const response = await authService.login({
      email: testEmail,
      password: rawPassword,
    });

    const staffObj = response.staff;
    expect((staffObj as Record<string, unknown>).password).toBeUndefined();
    expect((staffObj as Record<string, unknown>).passwordHash).toBeUndefined();
    expect(staffObj.id).toBe(testStaffId);
    expect(staffObj.role).toBe('call_agent');
  });
});
