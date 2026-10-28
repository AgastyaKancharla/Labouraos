import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import * as crypto from 'crypto';
import * as request from 'supertest';
import { AppModule } from '../../app.module';
import { PrismaService } from '../../common/prisma/prisma.service';
import { IdService } from '../../common/id/id.service';
import { PAYMENT_PROVIDER } from './payment-provider.interface';
import { RealPaymentProvider } from './real-payment.provider';

const SECRET = 'collection_webhook_secret_raw_body';

describe('Phase 8: collection webhook (POST /payments/webhook) verifies the raw body', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let idService: IdService;
  const timestamp = Date.now();
  let seq = 0;
  const seekerIds: string[] = [];
  const paymentIds: string[] = [];

  const hmac = (raw: string | Buffer, secret = SECRET) =>
    crypto.createHmac('sha256', secret).update(raw).digest('hex');

  const provider = () => new RealPaymentProvider({ webhookSecret: SECRET });

  /**
   * A body shaped the way a real gateway can send one and unlike what
   * JSON.stringify(JSON.parse(body)) produces: keys in a different order than
   * we would write them, irregular whitespace and newlines, escaped slashes in
   * URLs (as PHP's json_encode emits them) and a unicode escape.
   */
  const genuineRawBody = (gatewayReference: string, amount = 49900) =>
    [
      '{ "created_at":1755693679,',
      '  "payload" : {"payment_link":{ "entity" :{',
      '        "status":"paid",',
      '        "short_url":"https:\\/\\/rzp.io\\/i\\/' + gatewayReference + '",',
      '        "notes":{"memo":"\\u20b9499 activation"},',
      `        "amount":${amount},   "currency":"INR",`,
      `        "id":"${gatewayReference}" } } },`,
      '  "event":"payment_link.paid",',
      '  "entity":"event" }\n',
    ].join('\n');

  const makePendingActivation = async () => {
    seq += 1;
    const seeker = await prisma.jobSeeker.create({
      data: {
        code: `JS-CRB-${timestamp}-${seq}`,
        name: 'Raw Body Seeker',
        phone: `97${String(timestamp).slice(-6)}${String(seq).padStart(2, '0')}`,
        phoneVerified: true,
        tradeSkill: 'Electrician',
        minSalary: 1800000,
        maxSalary: 2400000,
        preferredCallWindowStart: '09:00',
        preferredCallWindowEnd: '18:00',
        status: 'pending_payment',
        city: 'Bengaluru',
      },
    });
    seekerIds.push(seeker.id);
    const gatewayReference = `plink_crb_${timestamp}_${seq}`;
    const payment = await prisma.payment.create({
      data: {
        code: await idService.generateCode('payment'),
        type: 'activation',
        amount: 49900,
        status: 'pending',
        gatewayReference,
        subjectType: 'job_seeker',
        subjectId: seeker.id,
        jobSeekerId: seeker.id,
        city: 'Bengaluru',
      },
    });
    paymentIds.push(payment.id);
    return { seeker, payment, gatewayReference };
  };

  const post = (
    server: ReturnType<INestApplication['getHttpServer']>,
    raw: string,
    signature: string | undefined,
  ) => {
    let req = request(server).post('/payments/webhook').set('Content-Type', 'application/json');
    if (signature !== undefined) req = req.set('x-razorpay-signature', signature);
    return req.send(raw);
  };

  beforeAll(async () => {
    const moduleRef: TestingModule = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(PAYMENT_PROVIDER)
      .useValue(provider())
      .compile();
    // rawBody mirrors main.ts
    app = moduleRef.createNestApplication({ rawBody: true });
    await app.init();
    prisma = app.get(PrismaService);
    idService = app.get(IdService);
  });

  afterAll(async () => {
    const seekers = await prisma.jobSeeker.findMany({
      where: { id: { in: seekerIds } },
      select: { code: true },
    });
    await prisma.auditLog.deleteMany({ where: { entityCode: { in: seekers.map((s) => s.code) } } });
    await prisma.payment.deleteMany({ where: { id: { in: paymentIds } } });
    await prisma.jobSeeker.deleteMany({ where: { id: { in: seekerIds } } });
    await app.close();
  });

  it('the fixture really does not survive a JSON round trip (so these tests mean something)', () => {
    const raw = genuineRawBody('plink_x');
    expect(JSON.stringify(JSON.parse(raw))).not.toBe(raw);
    expect(JSON.stringify(JSON.parse(raw))).not.toContain('\\/');
    expect(Object.keys(JSON.parse(raw))[0]).toBe('created_at'); // not the order a producer would normally write
  });

  describe('a genuine body verifies exactly as received', () => {
    it('activates the candidate from a body with reordered keys, odd whitespace, escaped slashes and unicode escapes', async () => {
      const { seeker, payment, gatewayReference } = await makePendingActivation();
      const raw = genuineRawBody(gatewayReference);

      const res = await post(app.getHttpServer(), raw, hmac(raw));

      expect(res.status).toBe(201);
      expect(res.body).toMatchObject({ received: true, status: 'succeeded', paymentId: payment.id });
      expect((await prisma.payment.findUniqueOrThrow({ where: { id: payment.id } })).status).toBe('succeeded');
      expect((await prisma.jobSeeker.findUniqueOrThrow({ where: { id: seeker.id } })).status).toBe('active');
    });

    it('is still idempotent: the same genuine body twice is processed once', async () => {
      const { payment, gatewayReference } = await makePendingActivation();
      const raw = genuineRawBody(gatewayReference);

      const first = await post(app.getHttpServer(), raw, hmac(raw));
      const second = await post(app.getHttpServer(), raw, hmac(raw));

      expect(first.body.status).toBe('succeeded');
      expect(second.body).toMatchObject({ received: true, alreadyProcessed: true, paymentId: payment.id });
    });

    it('verifies a compactly written body as well (nothing is special-cased to the odd one)', async () => {
      const { payment, gatewayReference } = await makePendingActivation();
      const raw = JSON.stringify({
        entity: 'event',
        event: 'payment_link.paid',
        payload: { payment_link: { entity: { id: gatewayReference, amount: 49900, currency: 'INR', status: 'paid' } } },
      });

      const res = await post(app.getHttpServer(), raw, hmac(raw));
      expect(res.status).toBe(201);
      expect(res.body.paymentId).toBe(payment.id);
    });
  });

  describe('anything other than the exact signed bytes is rejected', () => {
    it('a tampered body (amount changed) with the original signature is rejected and changes nothing', async () => {
      const { seeker, payment, gatewayReference } = await makePendingActivation();
      const raw = genuineRawBody(gatewayReference);
      const signature = hmac(raw);
      const tampered = raw.replace('"amount":49900', '"amount":100');
      expect(tampered).not.toBe(raw);

      const res = await post(app.getHttpServer(), tampered, signature);

      expect(res.status).toBe(400);
      expect((await prisma.payment.findUniqueOrThrow({ where: { id: payment.id } })).status).toBe('pending');
      expect((await prisma.jobSeeker.findUniqueOrThrow({ where: { id: seeker.id } })).status).toBe('pending_payment');
    });

    it('a body pointed at a different payment (id swapped) is rejected', async () => {
      const victim = await makePendingActivation();
      const attacker = await makePendingActivation();
      const raw = genuineRawBody(attacker.gatewayReference);
      const swapped = raw.split(attacker.gatewayReference).join(victim.gatewayReference);

      const res = await post(app.getHttpServer(), swapped, hmac(raw));

      expect(res.status).toBe(400);
      expect((await prisma.payment.findUniqueOrThrow({ where: { id: victim.payment.id } })).status).toBe('pending');
    });

    it('a single extra whitespace byte after signing is rejected: the bytes themselves are what is verified', async () => {
      const { payment, gatewayReference } = await makePendingActivation();
      const raw = genuineRawBody(gatewayReference);

      const res = await post(app.getHttpServer(), raw + ' ', hmac(raw));

      expect(res.status).toBe(400);
      expect((await prisma.payment.findUniqueOrThrow({ where: { id: payment.id } })).status).toBe('pending');
    });

    it('a signature computed over the re-serialised copy is NOT accepted for the original bytes', async () => {
      const { payment, gatewayReference } = await makePendingActivation();
      const raw = genuineRawBody(gatewayReference);
      const reserialised = JSON.stringify(JSON.parse(raw));
      expect(reserialised).not.toBe(raw);

      const res = await post(app.getHttpServer(), raw, hmac(reserialised));

      expect(res.status).toBe(400);
      expect((await prisma.payment.findUniqueOrThrow({ where: { id: payment.id } })).status).toBe('pending');
    });

    it('a missing, empty or wrong-secret signature is rejected', async () => {
      const { payment, gatewayReference } = await makePendingActivation();
      const raw = genuineRawBody(gatewayReference);

      expect((await post(app.getHttpServer(), raw, undefined)).status).toBe(400);
      expect((await post(app.getHttpServer(), raw, '')).status).toBe(400);
      expect((await post(app.getHttpServer(), raw, hmac(raw, 'someone_elses_secret'))).status).toBe(400);
      expect((await prisma.payment.findUniqueOrThrow({ where: { id: payment.id } })).status).toBe('pending');
    });

    it('fails closed (400) if the app is started without rawBody, rather than verifying a re-serialised copy', async () => {
      const bareModule = await Test.createTestingModule({ imports: [AppModule] })
        .overrideProvider(PAYMENT_PROVIDER)
        .useValue(provider())
        .compile();
      const bareApp = bareModule.createNestApplication(); // no rawBody
      await bareApp.init();
      try {
        const { payment, gatewayReference } = await makePendingActivation();
        const raw = genuineRawBody(gatewayReference);

        const res = await post(bareApp.getHttpServer(), raw, hmac(raw));

        expect(res.status).toBe(400);
        expect((await prisma.payment.findUniqueOrThrow({ where: { id: payment.id } })).status).toBe('pending');
      } finally {
        await bareApp.close();
      }
    });
  });

  describe('RealPaymentProvider.verifyWebhook directly', () => {
    const body = JSON.stringify({
      entity: 'event',
      event: 'payment_link.paid',
      payload: { payment_link: { entity: { id: 'plink_unit_1', amount: 49900, status: 'paid' } } },
    });

    it('accepts raw bytes as a Buffer or a string and parses the body from those same bytes', async () => {
      const fromString = await provider().verifyWebhook(undefined, hmac(body), body);
      const fromBuffer = await provider().verifyWebhook(undefined, hmac(body), Buffer.from(body, 'utf8'));

      for (const r of [fromString, fromBuffer]) {
        expect(r).toMatchObject({ isValid: true, gatewayReference: 'plink_unit_1', status: 'succeeded', amountPaise: 49900 });
      }
    });

    it('acts on the verified bytes, not on a different parsed object passed alongside them', async () => {
      const decoy = { payload: { payment_link: { entity: { id: 'plink_decoy', amount: 1, status: 'paid' } } } };

      const r = await provider().verifyWebhook(decoy, hmac(body), body);

      expect(r.gatewayReference).toBe('plink_unit_1');
    });

    it('never verifies a parsed object that has no raw bytes, even with a signature over its JSON.stringify', async () => {
      const parsed = JSON.parse(body);
      const r = await provider().verifyWebhook(parsed, hmac(JSON.stringify(parsed)));

      expect(r.isValid).toBe(false);
    });

    it('rejects a validly signed body that is not JSON', async () => {
      const r = await provider().verifyWebhook(undefined, hmac('not json'), 'not json');
      expect(r.isValid).toBe(false);
    });
  });
});
