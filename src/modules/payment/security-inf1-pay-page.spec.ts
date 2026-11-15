import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import * as request from 'supertest';
import { createHash, randomUUID } from 'node:crypto';
import { AppModule } from '../../app.module';
import { PrismaService } from '../../common/prisma/prisma.service';
import { IdService } from '../../common/id/id.service';
import { UpiCollectionService } from './upi-collection.service';
import { PAY_PAGE_DAYS_AFTER_PAYMENT, payPageTokenFor, payPageTokenHash } from './pay-page-token';
import { backfillPayPageTokens } from '../../scripts/backfill-pay-page-tokens';
import { PlacementService } from '../placement/placement.service';
import { GstInvoiceResponse } from '../placement/dto/gst-invoice.dto';

/**
 * Security INF-1 (proved on the range): the pay page was opened by the UPI
 * reference (sequential code + 32 random bits, also the UPI tr=), never
 * expired, and once paid handed out the receipt token and the invoice link,
 * whose copy showed the owner's full number.
 */
describe('Security INF-1: the pay page has its own token, expires after payment and leaks no receipt or invoice', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let upi: UpiCollectionService;
  const created: string[] = [];
  const day = 24 * 60 * 60 * 1000;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
    prisma = app.get(PrismaService);
    upi = app.get(UpiCollectionService);
  });

  afterAll(async () => {
    try {
      await prisma.statusHistory.deleteMany({ where: { subjectType: 'payment', subjectId: { in: created } } }).catch(() => undefined);
      await prisma.payment.deleteMany({ where: { id: { in: created } } }).catch(() => undefined);
    } finally {
      await app?.close();
    }
  });

  const summary = (key: string) => request(app.getHttpServer()).get(`/payments/request/${encodeURIComponent(key)}/summary`);

  async function newRequest() {
    const result = await upi.createRequest({ type: 'placement_fee', subjectType: 'placement', subjectId: randomUUID(), amountPaise: 944000 });
    created.push(result.paymentId);
    return result;
  }

  it('the link carries a 256-bit page token kept only as a hash; the UPI reference opens nothing', async () => {
    const result = await newRequest();
    const token = payPageTokenFor(result.paymentId);
    expect(Buffer.from(token, 'base64url').length).toBe(32);
    expect(result.paymentLink).toContain(`/p/fee/${token}`);
    expect(result.paymentLink).not.toContain(result.upiReference!);
    const row = await prisma.payment.findUniqueOrThrow({ where: { id: result.paymentId } });
    expect(row.pageTokenHash).toBe(createHash('sha256').update(token).digest('hex'));
    expect(JSON.stringify(row)).not.toContain(token);
    // The UPI app still gets the short reference for bank matching.
    expect(new URL(result.upiUri).searchParams.get('tr')).toBe(result.upiReference);

    expect((await summary(token)).status).toBe(200);
    expect((await summary(result.upiReference!)).status).toBe(404);
    expect((await request(app.getHttpServer()).get(`/payments/request/${result.upiReference}`)).status).toBe(404);
    expect((await request(app.getHttpServer()).post(`/payments/request/${result.upiReference}/utr-hint`).send({ utr: '123456789012' })).status).toBe(404);
    expect((await request(app.getHttpServer()).post(`/payments/request/${result.upiReference}/card`)).status).toBe(404);
  });

  it('once paid: no receipt or invoice token on the page, and the page closes after PAY_PAGE_DAYS_AFTER_PAYMENT days', async () => {
    const result = await newRequest();
    const token = payPageTokenFor(result.paymentId);
    await prisma.payment.update({ where: { id: result.paymentId }, data: { status: 'succeeded', confirmedAt: new Date() } });
    const paid = await summary(token).expect(200);
    expect(paid.body.state).toBe('received');
    expect(paid.body.receipt).toBeUndefined();
    expect(paid.body.invoicePath).toBeUndefined();
    expect(JSON.stringify(paid.body)).not.toMatch(/receipt\?token|invoice\/copy/);
    await prisma.payment.update({ where: { id: result.paymentId }, data: { confirmedAt: new Date(Date.now() - (PAY_PAGE_DAYS_AFTER_PAYMENT + 1) * day) } });
    expect((await summary(token)).status).toBe(404);
  });

  it('L3: a request made before page tokens never opens by its UPI reference; the backfill gives it a page token', async () => {
    const id = randomUUID();
    const code = await app.get(IdService).generateCode('payment');
    const legacy = await prisma.payment.create({
      data: {
        id, code, type: 'placement_fee', amount: 1000, expectedAmountPaise: 1000, status: 'pending', method: 'upi_direct',
        upiReference: `${code}-abcd1234`, subjectType: 'placement', subjectId: randomUUID(),
      },
    });
    created.push(legacy.id);
    expect((await summary(legacy.upiReference!)).status).toBe(404);
    expect((await summary(payPageTokenFor(legacy.id))).status).toBe(404);

    const { backfilled } = await backfillPayPageTokens(prisma);
    expect(backfilled.map((r) => r.id)).toContain(legacy.id);
    expect((await prisma.payment.findUniqueOrThrow({ where: { id } })).pageTokenHash).toBe(payPageTokenHash(payPageTokenFor(id)));
    expect((await summary(payPageTokenFor(legacy.id))).status).toBe(200);
    expect((await summary(legacy.upiReference!)).status).toBe(404);
    // Run again: nothing left to do for it.
    expect((await backfillPayPageTokens(prisma)).backfilled.map((r) => r.id)).not.toContain(legacy.id);
  });

  it('L3: the backfill leaves paid requests alone', async () => {
    const id = randomUUID();
    const code = await app.get(IdService).generateCode('payment');
    await prisma.payment.create({
      data: {
        id, code, type: 'placement_fee', amount: 1000, expectedAmountPaise: 1000, status: 'succeeded', method: 'upi_direct',
        upiReference: `${code}-abcd5678`, subjectType: 'placement', subjectId: randomUUID(), confirmedAt: new Date(),
      },
    });
    created.push(id);
    await backfillPayPageTokens(prisma);
    expect((await prisma.payment.findUniqueOrThrow({ where: { id } })).pageTokenHash).toBeNull();
  });

  it('the invoice copy opened from a public link masks the owner phone', async () => {
    const invoice = { invoiceNumber: 'INV-1', customer: { businessName: 'Shop', contactPhone: '+919876543210' } } as unknown as GstInvoiceResponse;
    const service = Object.create(PlacementService.prototype) as PlacementService;
    (service as unknown as { buildInvoice: () => Promise<GstInvoiceResponse> }).buildInvoice = async () => invoice;
    const copy = await service.getInvoiceForBusiness('pl-1');
    expect(copy.customer.contactPhone).toBe('******3210');
    expect(JSON.stringify(copy)).not.toContain('9876543210');
  });
});
