import { CallHandler, Controller, ExecutionContext, Get, INestApplication, Injectable, NestInterceptor, NotFoundException, Post, UploadedFile, UseInterceptors } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import { FileInterceptor } from '@nestjs/platform-express';
import * as request from 'supertest';
import { PublicRateLimitGuard } from './public-rate-limit.guard';
import { Public } from '../rbac/public.decorator';
import { CheckLinkBeforeUpload, PublicLinkUploadGuard } from '../public-link-upload.guard';
import { PublicLinkStoreService } from '../public-link-store.service';

let interceptorRan = false;

/** Stands in front of the upload interceptor: if it never runs, the file was never read. */
@Injectable()
class MarkInterceptor implements NestInterceptor {
  intercept(_context: ExecutionContext, next: CallHandler) {
    interceptorRan = true;
    return next.handle();
  }
}

@Controller()
class FakeController {
  @Get('registration/:token/status')
  @Public('token page (test)')
  status() {
    return { ok: true };
  }

  @Get('health/ready')
  @Public('probe (test)')
  ready() {
    return { ok: true };
  }

  @Post('payments/webhook')
  @Public('signed webhook (test)')
  webhook() {
    return { ok: true };
  }

  @Get('staff-only')
  staffOnly() {
    return { ok: true };
  }

  @Post('registration/:token/selfie')
  @Public('token page (test)')
  @CheckLinkBeforeUpload('registration', 'job_seeker', 'A valid job seeker registration link is required')
  @UseInterceptors(MarkInterceptor, FileInterceptor('photo', { limits: { fileSize: 5 * 1024 * 1024 } }))
  selfie(@UploadedFile() photo?: { buffer: Buffer }) {
    return { bytes: photo?.buffer.length ?? 0 };
  }
}

describe('M4: public routes — per-address limit, and the link token is checked before an upload is read', () => {
  let app: INestApplication;
  const saved = { env: process.env.NODE_ENV, setting: process.env.PUBLIC_RATE_LIMIT, limit: process.env.PUBLIC_RATE_LIMIT_PER_MINUTE };
  const findByToken = jest.fn();

  beforeAll(async () => {
    process.env.PUBLIC_RATE_LIMIT = 'on';
    process.env.PUBLIC_RATE_LIMIT_PER_MINUTE = '5';
    const moduleRef = await Test.createTestingModule({
      controllers: [FakeController],
      providers: [
        { provide: APP_GUARD, useClass: PublicRateLimitGuard },
        PublicLinkUploadGuard,
        { provide: PublicLinkStoreService, useValue: { findByToken } },
      ],
    }).compile();
    app = moduleRef.createNestApplication();
    app.getHttpAdapter().getInstance().set('trust proxy', 1);
    await app.init();
  });

  afterAll(async () => {
    await app.close();
    for (const [key, value] of [['NODE_ENV', saved.env], ['PUBLIC_RATE_LIMIT', saved.setting], ['PUBLIC_RATE_LIMIT_PER_MINUTE', saved.limit]] as const) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });

  it('answers 429 after the limit from one address, while another address still gets in', async () => {
    const server = app.getHttpServer();
    for (let i = 0; i < 5; i += 1) {
      await request(server).get('/registration/abc/status').set('X-Forwarded-For', '203.0.113.9').expect(200);
    }
    const blocked = await request(server).get('/registration/abc/status').set('X-Forwarded-For', '203.0.113.9');
    expect(blocked.status).toBe(429);
    await request(server).get('/registration/abc/status').set('X-Forwarded-For', '203.0.113.10').expect(200);
  });

  it('never counts health probes, signed webhooks or staff routes', async () => {
    const server = app.getHttpServer();
    for (let i = 0; i < 8; i += 1) {
      await request(server).get('/health/ready').set('X-Forwarded-For', '203.0.113.20').expect(200);
      await request(server).post('/payments/webhook').set('X-Forwarded-For', '203.0.113.20').expect(201);
      await request(server).get('/staff-only').set('X-Forwarded-For', '203.0.113.20').expect(200);
    }
  });

  it('refuses a dead or wrong token before the 5 MB file is buffered', async () => {
    interceptorRan = false;
    findByToken.mockRejectedValueOnce(new NotFoundException('Public link token not found'));
    const big = Buffer.alloc(4 * 1024 * 1024, 1);
    const res = await request(app.getHttpServer())
      .post('/registration/nope/selfie')
      .set('X-Forwarded-For', '203.0.113.30')
      .attach('photo', big, 'selfie.jpg');
    expect(res.status).toBe(404);
    expect(interceptorRan).toBe(false);

    findByToken.mockResolvedValueOnce({ purpose: 'payment_only', subjectType: 'job_seeker', phone: '+919876543210' });
    const wrongKind = await request(app.getHttpServer())
      .post('/registration/pay/selfie')
      .set('X-Forwarded-For', '203.0.113.31')
      .attach('photo', Buffer.from('x'), 'selfie.jpg');
    expect(wrongKind.status).toBe(400);
    expect(wrongKind.body.message).toBe('A valid job seeker registration link is required');
  });

  it('lets a live registration link through to the upload', async () => {
    findByToken.mockResolvedValueOnce({ purpose: 'registration', subjectType: 'job_seeker', phone: '+919876543210' });
    const res = await request(app.getHttpServer())
      .post('/registration/good/selfie')
      .set('X-Forwarded-For', '203.0.113.32')
      .attach('photo', Buffer.from('abc'), 'selfie.jpg');
    expect(res.status).toBe(201);
    expect(res.body).toEqual({ bytes: 3 });
    expect(interceptorRan).toBe(true);
  });

  it('is off in the automated tests unless asked for, and can be switched off', () => {
    const guard = new PublicRateLimitGuard({ getAllAndOverride: () => 'x' } as never) as unknown as { enabled(): boolean };
    process.env.NODE_ENV = 'test';
    delete process.env.PUBLIC_RATE_LIMIT;
    expect(guard.enabled()).toBe(false);
    process.env.NODE_ENV = 'production';
    expect(guard.enabled()).toBe(true);
    process.env.PUBLIC_RATE_LIMIT = 'off';
    expect(guard.enabled()).toBe(false);
    process.env.PUBLIC_RATE_LIMIT = 'on';
    expect(PublicRateLimitGuard.exempt('/health')).toBe(true);
    expect(PublicRateLimitGuard.exempt('/payments/bank-feed/webhook')).toBe(true);
    expect(PublicRateLimitGuard.exempt('/registration/x/selfie')).toBe(false);
  });
});
