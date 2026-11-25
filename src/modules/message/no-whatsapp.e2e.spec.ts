import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { JwtService } from '@nestjs/jwt';
import { randomUUID } from 'crypto';
import * as request from 'supertest';
import { AppModule } from '../../app.module';
import { PrismaService } from '../../common/prisma/prisma.service';
import { WHATSAPP_PROVIDER } from '../../common/whatsapp/whatsapp.interface';
import { MockWhatsAppProvider } from '../../common/whatsapp/mock-whatsapp.provider';
import { phoneHash } from '../call/contact-block';
import { MessagingService } from './messaging.service';

/** "No WhatsApp" on the call agent console's profiles, and what it does to sending (Master Guide rev 211). */
describe('No WhatsApp: per number, call agents only, straight to SMS', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  const suffix = randomUUID().replace(/-/g, '').slice(0, 8);
  const digits = String(Math.floor(10000000 + Math.random() * 89999999));
  const phone = `+9196${digits}`;
  const ids = { staff: [] as string[], seeker: '', business: '' };
  const tokens: Record<string, string> = {};

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
    prisma = app.get(PrismaService);
    const jwt = app.get(JwtService);
    for (const role of ['call_agent', 'team_lead', 'field_agent', 'ceo']) {
      const row = await prisma.staff.create({ data: { code: `NWA-${role}-${suffix}`, name: `NWA ${role}`, email: `nwa_${role}_${suffix}@laboura.local`, passwordHash: 'h', role, city: 'Bengaluru' } });
      ids.staff.push(row.id);
      tokens[role] = jwt.sign({ sub: row.id, role, code: row.code, email: row.email });
    }
    ids.seeker = (await prisma.jobSeeker.create({ data: { code: `JS-NWA-${suffix}`, name: 'Ravi Kumar', phone, status: 'active', minSalary: 1000000, maxSalary: 2000000, preferredCallWindowStart: '09:00', preferredCallWindowEnd: '20:00' } })).id;
    // The same number as a business owner: one mark covers both (per number).
    ids.business = (await prisma.business.create({ data: { code: `BZ-NWA-${suffix}`, name: 'NWA Shop', phone, ownerName: 'Ravi Kumar', city: 'Bengaluru' } })).id;
  });

  afterAll(async () => {
    try {
      await prisma.messageLog.deleteMany({ where: { subjectId: { in: [ids.seeker, ids.business] } } }).catch(() => undefined);
      await prisma.noWhatsAppPhone.deleteMany({ where: { phoneHash: phoneHash(phone) } }).catch(() => undefined);
      await prisma.auditLog.deleteMany({ where: { actorId: { in: ids.staff } } }).catch(() => undefined);
      await prisma.business.deleteMany({ where: { id: ids.business } }).catch(() => undefined);
      await prisma.jobSeeker.deleteMany({ where: { id: ids.seeker } }).catch(() => undefined);
      await prisma.staff.deleteMany({ where: { id: { in: ids.staff } } }).catch(() => undefined);
    } finally {
      await app?.close();
    }
  });

  const get = (role: string, kind: string, id: string) => request(app.getHttpServer()).get('/no-whatsapp').query({ kind, id }).set('Authorization', `Bearer ${tokens[role]}`);
  const put = (role: string, body: object) => request(app.getHttpServer()).put('/no-whatsapp').send(body).set('Authorization', `Bearer ${tokens[role]}`);

  it('only call agents see and change it; every change is audited without the number', async () => {
    expect((await get('call_agent', 'job_seeker', ids.seeker).expect(200)).body).toEqual({ noWhatsApp: false, source: null, since: null });
    for (const role of ['team_lead', 'field_agent', 'ceo']) {
      expect([role, (await get(role, 'job_seeker', ids.seeker)).status]).toEqual([role, 403]);
      expect([role, (await put(role, { kind: 'job_seeker', id: ids.seeker, noWhatsApp: true })).status]).toEqual([role, 403]);
    }
    await put('call_agent', { kind: 'job_seeker', id: ids.seeker, noWhatsApp: 'yes' }).expect(400);
    await put('call_agent', { kind: 'vacancy', id: ids.seeker, noWhatsApp: true }).expect(400);
    const marked = await put('call_agent', { kind: 'job_seeker', id: ids.seeker, noWhatsApp: true }).expect(200);
    expect(marked.body).toMatchObject({ noWhatsApp: true, source: 'staff' });
    // Per number: the business on the same number shows it too.
    expect((await get('call_agent', 'business', ids.business).expect(200)).body.noWhatsApp).toBe(true);
    const audit = await prisma.auditLog.findFirst({ where: { actorId: ids.staff[0], action: 'contact.no_whatsapp_marked' } });
    expect(audit?.entityCode).toBe(`JS-NWA-${suffix}`);
    expect(JSON.stringify(audit)).not.toContain(digits);
  });

  it('a marked number gets its messages straight by SMS; cleared, WhatsApp first again', async () => {
    const messaging = app.get(MessagingService);
    const res = await messaging.sendPreferWhatsApp({ template: 'payment_receipt', subjectType: 'job_seeker', subjectId: ids.seeker, variables: { link: 'https://x/r' } });
    expect(res).toMatchObject({ channel: 'sms', status: 'sent', whatsappMessageId: null });
    await put('call_agent', { kind: 'business', id: ids.business, noWhatsApp: false }).expect(200);
    expect(await prisma.auditLog.count({ where: { actorId: ids.staff[0], action: 'contact.no_whatsapp_cleared' } })).toBe(1);
    const again = await messaging.sendPreferWhatsApp({ template: 'payment_receipt', subjectType: 'job_seeker', subjectId: ids.seeker, variables: { link: 'https://x/r' } });
    expect(again.channel).toBe('whatsapp');
  });

  it('Meta refusing with 131026 marks the number by itself', async () => {
    const wa = app.get(WHATSAPP_PROVIDER) as MockWhatsAppProvider;
    wa.refuseNumber(phone, '131026');
    try {
      const res = await app.get(MessagingService).sendPreferWhatsApp({ template: 'interview_cancelled', subjectType: 'business', subjectId: ids.business, variables: {} });
      expect(res.channel).toBe('sms');
      expect((await get('call_agent', 'job_seeker', ids.seeker).expect(200)).body).toMatchObject({ noWhatsApp: true, source: 'meta' });
    } finally {
      wa.clearRefused();
    }
  });
});
