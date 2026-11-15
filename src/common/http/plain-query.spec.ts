import { BadRequestException, INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { JwtService } from '@nestjs/jwt';
import * as request from 'supertest';
import { AppModule } from '../../app.module';
import { PrismaService } from '../prisma/prisma.service';
import { assertPlainQuery, queryText } from './plain-query';
import { caseSensitiveHttpAdapter } from './case-sensitive-routing';

/**
 * Security IN-2: `?status[not]=x` must never become a Prisma operator
 * (`where.status = { not: 'x' }`) on GET /payments or any other list.
 */
describe('Security IN-2: query values are plain text', () => {
  it('unit: objects and arrays of non-text are refused; text and repeated text pass', () => {
    expect(() => assertPlainQuery({ status: { not: 'x' } })).toThrow(BadRequestException);
    expect(() => assertPlainQuery({ status: [{ not: 'x' }] })).toThrow(BadRequestException);
    expect(() => assertPlainQuery({ status: 'pending', page: '2', tag: ['a', 'b'] })).not.toThrow();
    expect(queryText('pending', 'status')).toBe('pending');
    expect(queryText(undefined, 'status')).toBeUndefined();
    expect(() => queryText(['a', 'b'], 'status')).toThrow(BadRequestException);
    expect(() => queryText({ not: 'x' }, 'status')).toThrow(BadRequestException);
  });

  it('unit: the API adapter uses the simple query parser', () => {
    const server = caseSensitiveHttpAdapter().getInstance() as { get(key: string): unknown };
    expect(server.get('query parser')).toBe('simple');
  });

  describe('over HTTP (GET /payments)', () => {
    let app: INestApplication;
    let prisma: PrismaService;
    let token = '';
    let ceoId = '';
    const suffix = Date.now().toString().slice(-7);

    beforeAll(async () => {
      const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
      app = moduleRef.createNestApplication();
      await app.init();
      prisma = app.get(PrismaService);
      const ceo = await prisma.staff.create({ data: { code: `IN2CEO-${suffix}`, name: 'IN2 CEO', email: `in2_${suffix}@laboura.local`, passwordHash: 'h', role: 'ceo', city: 'Bengaluru' } });
      ceoId = ceo.id;
      token = await app.get(JwtService).signAsync({ sub: ceo.id, role: 'ceo', email: ceo.email, code: ceo.code });
    });

    afterAll(async () => {
      try {
        await prisma.staff.deleteMany({ where: { id: ceoId } }).catch(() => undefined);
      } finally {
        await app?.close();
      }
    });

    const parser = (mode: 'simple' | 'extended') =>
      (app.getHttpAdapter().getInstance() as { set(key: string, value: string): void }).set('query parser', mode);
    const list = (qs: string) => request(app.getHttpServer()).get(`/payments?${qs}`).set('Authorization', `Bearer ${token}`);

    it('with the simple parser, ?status[not]=x is only a text key: no operator, no filter', async () => {
      parser('simple');
      const res = await list('status[not]=pending');
      expect(res.status).toBe(200);
      const plain = await list('').expect(200);
      expect(res.body.length).toBe(plain.body.length);
    });

    it('even with an extended parser, an object-valued query is refused (400)', async () => {
      parser('extended');
      try {
        const res = await list('status[not]=pending');
        expect(res.status).toBe(400);
      } finally {
        parser('simple');
      }
    });

    it('a repeated filter is refused instead of reaching Prisma as an array', async () => {
      const res = await list('status=pending&status=succeeded');
      expect(res.status).toBe(400);
    });
  });
});
