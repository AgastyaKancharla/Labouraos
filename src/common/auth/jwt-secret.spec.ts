import { Test, TestingModule } from '@nestjs/testing';
import { getJwtSecret } from './jwt-secret';
import { JwtStrategy } from './jwt.strategy';
import { PrismaService } from '../prisma/prisma.service';
import { AuthModule } from './auth.module';

describe('Phase 9 Task 5: JWT_SECRET Validation at Startup', () => {
  const originalSecret = process.env.JWT_SECRET;

  afterEach(() => {
    if (originalSecret !== undefined) {
      process.env.JWT_SECRET = originalSecret;
    } else {
      delete process.env.JWT_SECRET;
    }
  });

  describe('getJwtSecret() validation', () => {
    it('fails when JWT_SECRET is missing or empty', () => {
      delete process.env.JWT_SECRET;
      expect(() => getJwtSecret()).toThrow(/JWT_SECRET environment variable is missing or empty/);

      process.env.JWT_SECRET = '';
      expect(() => getJwtSecret()).toThrow(/JWT_SECRET environment variable is missing or empty/);

      process.env.JWT_SECRET = '   ';
      expect(() => getJwtSecret()).toThrow(/JWT_SECRET environment variable is missing or empty/);
    });

    it('fails when JWT_SECRET is shorter than 32 characters (e.g. 10 characters)', () => {
      process.env.JWT_SECRET = '1234567890'; // 10 chars
      expect(() => getJwtSecret()).toThrow(/must be at least 32 characters long/);
    });

    it('succeeds when JWT_SECRET is exactly 32 characters or longer', () => {
      const valid32 = '12345678901234567890123456789012';
      process.env.JWT_SECRET = valid32;
      expect(getJwtSecret()).toBe(valid32);

      const validLonger = 'this_is_a_very_secure_jwt_secret_with_more_than_32_characters';
      process.env.JWT_SECRET = validLonger;
      expect(getJwtSecret()).toBe(validLonger);
    });
  });

  describe('Startup failure on missing or short secret in Nest components', () => {
    it('JwtStrategy construction fails when JWT_SECRET is missing', () => {
      delete process.env.JWT_SECRET;
      const mockPrisma = {} as PrismaService;
      expect(() => new JwtStrategy(mockPrisma)).toThrow(
        /JWT_SECRET environment variable is missing or empty/,
      );
    });

    it('JwtStrategy construction fails when JWT_SECRET is 10 characters', () => {
      process.env.JWT_SECRET = '1234567890';
      const mockPrisma = {} as PrismaService;
      expect(() => new JwtStrategy(mockPrisma)).toThrow(/must be at least 32 characters long/);
    });

    it('JwtStrategy construction succeeds when JWT_SECRET is 32 characters', () => {
      process.env.JWT_SECRET = '12345678901234567890123456789012';
      const mockPrisma = {} as PrismaService;
      expect(() => new JwtStrategy(mockPrisma)).not.toThrow();
    });

    it('AuthModule compilation fails when JWT_SECRET is missing', async () => {
      delete process.env.JWT_SECRET;
      await expect(
        Test.createTestingModule({
          imports: [AuthModule],
        }).compile(),
      ).rejects.toThrow();
    });

    it('AuthModule compilation fails when JWT_SECRET is 10 characters', async () => {
      process.env.JWT_SECRET = '1234567890';
      await expect(
        Test.createTestingModule({
          imports: [AuthModule],
        }).compile(),
      ).rejects.toThrow();
    });

    it('AuthModule compilation succeeds when JWT_SECRET is 32 characters', async () => {
      process.env.JWT_SECRET = '12345678901234567890123456789012';
      const module: TestingModule = await Test.createTestingModule({
        imports: [AuthModule],
      }).compile();
      expect(module).toBeDefined();
      await module.close();
    });
  });
});
