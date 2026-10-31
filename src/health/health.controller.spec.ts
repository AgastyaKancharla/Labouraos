import { Test, TestingModule } from '@nestjs/testing';
import { HttpException, HttpStatus, INestApplication } from '@nestjs/common';
import * as request from 'supertest';
import { HealthController } from './health.controller';
import { HealthService } from './health.service';
import { PrismaService } from '../common/prisma/prisma.service';

describe('Phase 6.5 Task 5: Health Check & Readiness Probe Split', () => {
  let controller: HealthController;
  let healthService: HealthService;
  let mockPrisma: { $queryRawUnsafe: jest.Mock };

  beforeEach(async () => {
    mockPrisma = {
      $queryRawUnsafe: jest.fn().mockResolvedValue([{ '1': 1 }]),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [HealthController],
      providers: [
        HealthService,
        {
          provide: PrismaService,
          useValue: mockPrisma,
        },
      ],
    }).compile();

    controller = module.get<HealthController>(HealthController);
    healthService = module.get<HealthService>(HealthService);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
    expect(healthService).toBeDefined();
  });

  describe('1. Cheap Liveness Check (GET /health)', () => {
    it('returns 200 { status: "ok" } immediately with NO external dependency checks', () => {
      const dbSpy = jest.spyOn(healthService, 'checkDatabase');
      const redisSpy = jest.spyOn(healthService, 'checkRedis');

      const response = controller.getHealth();

      expect(response).toEqual({ status: 'ok' });
      expect(dbSpy).not.toHaveBeenCalled();
      expect(redisSpy).not.toHaveBeenCalled();
      expect(mockPrisma.$queryRawUnsafe).not.toHaveBeenCalled();
    });
  });

  describe('2. Dependency Readiness Probe (GET /health/ready)', () => {
    it('returns 200 with status ready when both Postgres and Redis answer', async () => {
      jest.spyOn(healthService, 'checkDatabase').mockResolvedValue({ healthy: true });
      jest.spyOn(healthService, 'checkRedis').mockResolvedValue({ healthy: true });

      const response = await controller.getReadiness();

      expect(response).toEqual({
        status: 'ready',
        postgres: 'ok',
        redis: 'ok',
      });
    });

    it('returns 503 naming postgres when database query fails', async () => {
      jest.spyOn(healthService, 'checkDatabase').mockResolvedValue({
        healthy: false,
        error: 'Database connection refused on port 5432',
      });
      jest.spyOn(healthService, 'checkRedis').mockResolvedValue({ healthy: true });

      try {
        await controller.getReadiness();
        fail('Expected 503 HttpException to be thrown');
      } catch (err: unknown) {
        expect(err).toBeInstanceOf(HttpException);
        const httpErr = err as HttpException;
        expect(httpErr.getStatus()).toBe(HttpStatus.SERVICE_UNAVAILABLE);
        const res = httpErr.getResponse() as Record<string, unknown>;
        expect(res.status).toBe('unavailable');
        expect(res.failed).toEqual(['postgres']);
        expect((res.errors as Record<string, string>).postgres).toContain('5432');
        expect(res.message).toContain('postgres');
      }
    });

    it('returns 503 naming redis when Redis ping fails', async () => {
      jest.spyOn(healthService, 'checkDatabase').mockResolvedValue({ healthy: true });
      jest.spyOn(healthService, 'checkRedis').mockResolvedValue({
        healthy: false,
        error: 'Redis connection to localhost:6379 ECONNREFUSED',
      });

      try {
        await controller.getReadiness();
        fail('Expected 503 HttpException to be thrown');
      } catch (err: unknown) {
        expect(err).toBeInstanceOf(HttpException);
        const httpErr = err as HttpException;
        expect(httpErr.getStatus()).toBe(HttpStatus.SERVICE_UNAVAILABLE);
        const res = httpErr.getResponse() as Record<string, unknown>;
        expect(res.status).toBe('unavailable');
        expect(res.failed).toEqual(['redis']);
        expect((res.errors as Record<string, string>).redis).toContain('ECONNREFUSED');
        expect(res.message).toContain('redis');
      }
    });

    it('returns 503 naming both dependencies when both fail', async () => {
      jest.spyOn(healthService, 'checkDatabase').mockResolvedValue({
        healthy: false,
        error: 'Postgres unreachable',
      });
      jest.spyOn(healthService, 'checkRedis').mockResolvedValue({
        healthy: false,
        error: 'Redis unreachable',
      });

      try {
        await controller.getReadiness();
        fail('Expected 503 HttpException to be thrown');
      } catch (err: unknown) {
        expect(err).toBeInstanceOf(HttpException);
        const httpErr = err as HttpException;
        expect(httpErr.getStatus()).toBe(HttpStatus.SERVICE_UNAVAILABLE);
        const res = httpErr.getResponse() as Record<string, unknown>;
        expect(res.status).toBe('unavailable');
        expect(res.failed).toEqual(['postgres', 'redis']);
        expect(res.message).toContain('postgres, redis');
      }
    });
  });

  describe('3. Timeout Handling (2s timeout boundary)', () => {
    it('flags database as unhealthy if query takes longer than timeout limit', async () => {
      // Mock slow query exceeding timeout
      mockPrisma.$queryRawUnsafe.mockImplementation(
        () => new Promise((resolve) => setTimeout(resolve, 250)),
      );

      const dbResult = await healthService.checkDatabase(100);
      expect(dbResult.healthy).toBe(false);
      expect(dbResult.error).toContain('timed out');
    });

    it('flags redis as unhealthy if socket connection takes longer than timeout limit', async () => {
      // Point to an unreachable non-routable IP to test timeout
      process.env.REDIS_HOST = '10.255.255.1';
      process.env.REDIS_PORT = '81';

      const redisResult = await healthService.checkRedis(100);
      expect(redisResult.healthy).toBe(false);
      expect(redisResult.error).toBeDefined();

      delete process.env.REDIS_HOST;
      delete process.env.REDIS_PORT;
    });
  });

  describe('4. HTTP Supertest Integration', () => {
    let app: INestApplication;

    beforeAll(async () => {
      const moduleRef: TestingModule = await Test.createTestingModule({
        controllers: [HealthController],
        providers: [
          HealthService,
          {
            provide: PrismaService,
            useValue: mockPrisma,
          },
        ],
      }).compile();

      app = moduleRef.createNestApplication();
      await app.init();
    });

    afterAll(async () => {
      await app.close();
    });

    it('GET /health returns 200 { status: "ok" } over HTTP', async () => {
      const res = await request(app.getHttpServer()).get('/health');
      expect(res.status).toBe(200);
      expect(res.body).toEqual({ status: 'ok' });
    });

    it('GET /health/ready returns 200 when dependencies answer over HTTP', async () => {
      const svc = app.get(HealthService);
      jest.spyOn(svc, 'checkDatabase').mockResolvedValue({ healthy: true });
      jest.spyOn(svc, 'checkRedis').mockResolvedValue({ healthy: true });

      const res = await request(app.getHttpServer()).get('/health/ready');
      expect(res.status).toBe(200);
      expect(res.body).toEqual({
        status: 'ready',
        postgres: 'ok',
        redis: 'ok',
      });
    });

    it('GET /health/ready returns 503 with failed dependency name over HTTP', async () => {
      const svc = app.get(HealthService);
      jest.spyOn(svc, 'checkDatabase').mockResolvedValue({
        healthy: false,
        error: 'Can not reach PostgreSQL at postgres.supabase.internal',
      });
      jest.spyOn(svc, 'checkRedis').mockResolvedValue({ healthy: true });

      const res = await request(app.getHttpServer()).get('/health/ready');
      expect(res.status).toBe(503);
      expect(res.body.status).toBe('unavailable');
      expect(res.body.failed).toContain('postgres');
      expect(res.body.message).toContain('postgres');
    });
  });
});
