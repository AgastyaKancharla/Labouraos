import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import * as request from 'supertest';
import * as bcrypt from 'bcrypt';
import { AppModule } from '../../app.module';
import { PrismaService } from '../../common/prisma/prisma.service';
import { enrolledLogin } from '../../test-support/enrolled-login-spec';
import { AGENT_HIDDEN_BUSINESS_FIELDS, businessForViewer } from './business-agent-view';

describe('M2: agents see full business details only for their own businesses (unit)', () => {
  const business = {
    id: 'b1',
    name: 'Shop',
    accountAgentId: 'fa-own',
    leadCreatedByStaffId: 'ca-lead',
    gstNumber: '29ABCDE1234F1Z5',
    pan: 'ABCDE1234F',
    ownerName: 'Owner',
    billingEmail: 'bill@shop.in',
    agreements: [{ signedAt: new Date() }],
    vacancies: [{ id: 'v1' }],
  };

  it('blanks registration, tax and billing details for another agent, keeps what the map and a call need', () => {
    const seen = businessForViewer(business, { id: 'fa-other', role: 'field_agent' });
    expect(seen).toMatchObject({ id: 'b1', name: 'Shop', vacancies: [{ id: 'v1' }], detailsLimited: true });
    expect(seen.gstNumber).toBeNull();
    expect(seen.pan).toBeNull();
    expect(seen.ownerName).toBeNull();
    expect(seen.billingEmail).toBeNull();
    expect(seen.agreements).toEqual([]);
    expect(AGENT_HIDDEN_BUSINESS_FIELDS).toEqual(expect.arrayContaining(['gstNumber', 'pan', 'licenceNumber', 'billingEmail']));
  });

  it('shows everything to the account agent, the lead creator and the agent on the open verification visit', () => {
    expect(businessForViewer(business, { id: 'fa-own', role: 'field_agent' }).gstNumber).toBe('29ABCDE1234F1Z5');
    expect(businessForViewer(business, { id: 'ca-lead', role: 'call_agent' }).pan).toBe('ABCDE1234F');
    expect(businessForViewer(business, { id: 'fa-visit', role: 'field_agent', assignedBusinessIds: new Set(['b1']) }).gstNumber).toBe('29ABCDE1234F1Z5');
  });

  it('leaves management, Team Leads and Finance to their own rules', () => {
    for (const role of ['ceo', 'manager', 'team_lead', 'finance']) {
      expect(businessForViewer(business, { id: 'x', role })).not.toHaveProperty('detailsLimited');
    }
  });
});

describe('M2: GET /businesses and /businesses/:id for agents (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  const ts = Date.now();
  const password = 'Password123!Secure';
  const staffIds: string[] = [];
  let businessId = '';
  let ownToken = '';
  let otherToken = '';
  let callToken = '';

  beforeAll(async () => {
    const moduleRef: TestingModule = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
    prisma = app.get(PrismaService);
    const passwordHash = await bcrypt.hash(password, 4);
    const make = async (role: string, tag: string) => {
      const s = await prisma.staff.create({
        data: { code: `M2-${tag}-${ts}`, name: `M2 ${tag}`, email: `m2_${tag}_${ts}@laboura.local`, passwordHash, role, city: 'Bengaluru' },
      });
      staffIds.push(s.id);
      return s;
    };
    const own = await make('field_agent', 'own');
    const other = await make('field_agent', 'other');
    const caller = await make('call_agent', 'call');
    const business = await prisma.business.create({
      data: {
        code: `BZ-M2-${ts}`,
        name: 'M2 Hotel',
        ownerName: 'M2 Owner',
        phone: `97${ts.toString().slice(-8)}`,
        city: 'Bengaluru',
        latitude: 12.93,
        longitude: 77.62,
        gstNumber: '29ABCDE1234F1Z5',
        pan: 'ABCDE1234F',
        licenceNumber: 'LIC-42',
        billingEmail: 'billing@m2.in',
        accountAgentId: own.id,
        verificationStatus: 'verified',
      },
    });
    businessId = business.id;
    const server = app.getHttpServer();
    ownToken = (await enrolledLogin(server, { email: own.email, password })).body.accessToken;
    otherToken = (await enrolledLogin(server, { email: other.email, password })).body.accessToken;
    callToken = (await enrolledLogin(server, { email: caller.email, password })).body.accessToken;
  });

  afterAll(async () => {
    await prisma.business.deleteMany({ where: { id: businessId } });
    await prisma.staffSession.deleteMany({ where: { staffId: { in: staffIds } } });
    await prisma.loginCodeRequest.deleteMany({ where: { staffId: { in: staffIds } } });
    await prisma.staffDevice.deleteMany({ where: { staffId: { in: staffIds } } });
    await prisma.auditLog.deleteMany({ where: { actorId: { in: staffIds } } });
    await prisma.staff.deleteMany({ where: { id: { in: staffIds } } });
    await app.close();
  });

  it('another field agent gets the map-level record only: no GST, PAN, licence or billing email', async () => {
    const res = await request(app.getHttpServer()).get(`/businesses/${businessId}`).set('Authorization', `Bearer ${otherToken}`);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ name: 'M2 Hotel', detailsLimited: true, gstNumber: null, pan: null, licenceNumber: null, billingEmail: null, ownerName: null });

    const list = await request(app.getHttpServer()).get('/businesses').set('Authorization', `Bearer ${otherToken}`);
    const row = (list.body as Array<{ id: string; gstNumber: string | null }>).find((b) => b.id === businessId);
    expect(row?.gstNumber).toBeNull();
  });

  it('a call agent who did not create the lead gets the same limited record', async () => {
    const res = await request(app.getHttpServer()).get(`/businesses/BZ-M2-${ts}`).set('Authorization', `Bearer ${callToken}`);
    expect(res.status).toBe(200);
    expect(res.body.gstNumber).toBeNull();
    expect(res.body.pan).toBeNull();
  });

  it('the account agent sees the full record', async () => {
    const res = await request(app.getHttpServer()).get(`/businesses/${businessId}`).set('Authorization', `Bearer ${ownToken}`);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ gstNumber: '29ABCDE1234F1Z5', pan: 'ABCDE1234F', licenceNumber: 'LIC-42', billingEmail: 'billing@m2.in' });
    expect(res.body.detailsLimited).toBeUndefined();
  });
});
