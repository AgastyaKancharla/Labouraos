import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import * as request from 'supertest';
import { AppModule } from '../../app.module';

describe('Phase 18 Task 3: removed payout-webhook returns 404', () => {
  let app: INestApplication;
  let moduleRef: TestingModule;

  beforeAll(async () => {
    moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication({ rawBody: true });
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it('POST /payments/payout-webhook returns 404', async () => {
    await request(app.getHttpServer())
      .post('/payments/payout-webhook')
      .set('content-type', 'application/json')
      .send({ event: 'payout.processed' })
      .expect(404);
  });

  it('POST /payments/payout-webhook returns 404 even with signature header', async () => {
    await request(app.getHttpServer())
      .post('/payments/payout-webhook')
      .set('content-type', 'application/json')
      .set('x-razorpay-signature', 'some_sig')
      .send({ event: 'payout.processed' })
      .expect(404);
  });
});
