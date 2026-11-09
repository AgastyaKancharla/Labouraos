import { UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Test, TestingModule } from '@nestjs/testing';
import { AppModule } from '../../app.module';
import { AuthService } from './auth.service';
import { PrismaService } from '../prisma/prisma.service';
import { JwtPayload } from './jwt-payload.interface';
import { loginCodeFor } from '../../modules/login-code/login-code.crypto';

describe('Staff Authentication', () => {
  let authService: AuthService;
  let jwtService: JwtService;
  let prisma: PrismaService;
  let testStaffId: string;
  let testStaffCode: string;
  const testEmail = `staff_auth_${Date.now()}@laboura.local`;
  const rawPassword = 'StrongPassword123!';
  const deviceId = 'auth-spec-device';

  beforeAll(async () => {
    const module: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    authService = module.get<AuthService>(AuthService);
    jwtService = module.get<JwtService>(JwtService);
    prisma = module.get(PrismaService);

    const passwordHash = await authService.hashPassword(rawPassword);

    expect(passwordHash).not.toBe(rawPassword);

    const staff = await prisma.staff.create({
      data: {
        code: `CA-${Date.now()}`,
        name: 'Auth Test Agent',
        email: testEmail,
        passwordHash,
        role: 'call_agent',
        city: 'Bengaluru',
      },
    });
    await prisma.staffDevice.create({
      data: {
        staffId: staff.id,
        deviceId,
        label: 'Auth spec',
        platform: 'web',
        status: 'approved',
        approvedAt: new Date(),
      },
    });

    testStaffId = staff.id;
    testStaffCode = staff.code;
  });

  afterAll(async () => {
    if (testStaffId) {
      await prisma.loginCodeRequest.deleteMany({ where: { staffId: testStaffId } });
      await prisma.staffDevice.deleteMany({ where: { staffId: testStaffId } });
      await prisma.staffSession.deleteMany({ where: { staffId: testStaffId } });
      await prisma.auditLog.deleteMany({ where: { actorId: testStaffId } });
      await prisma.staff.delete({ where: { id: testStaffId } });
    }
    await prisma.$disconnect();
  });

  it('valid login succeeds and returns a valid token carrying id and role', async () => {
    const waiting = await authService.login({
      staffCode: testStaffCode,
      password: rawPassword,
      deviceId,
    });
    expect(waiting).toMatchObject({ status: 'awaiting_code' });
    if (!('loginRequestId' in waiting)) {
      throw new Error('expected a login code');
    }
    const response = await authService.verifyLoginCode(
      waiting.loginRequestId,
      loginCodeFor(waiting.loginRequestId),
    );

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
        staffCode: testStaffCode,
        password: 'WrongPassword!',
        deviceId,
      }),
    ).rejects.toThrow(UnauthorizedException);
  });

  it('non-existent email fails with UnauthorizedException', async () => {
    await expect(
      authService.login({
        email: 'nobody@laboura.local',
        password: rawPassword,
        deviceId,
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
    const waiting = await authService.login({
      staffCode: testStaffCode,
      password: rawPassword,
      deviceId,
    });
    if (!('loginRequestId' in waiting)) {
      throw new Error('expected a login code');
    }
    const response = await authService.verifyLoginCode(
      waiting.loginRequestId,
      loginCodeFor(waiting.loginRequestId),
    );

    const staffObj = response.staff;
    expect((staffObj as Record<string, unknown>).password).toBeUndefined();
    expect((staffObj as Record<string, unknown>).passwordHash).toBeUndefined();
    expect(staffObj.id).toBe(testStaffId);
    expect(staffObj.role).toBe('call_agent');
  });
});
