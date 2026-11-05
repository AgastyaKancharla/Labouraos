import { INestApplication, Injectable, Module } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcrypt';
import * as request from 'supertest';
import { AppModule } from '../../app.module';
import { PrismaService } from '../../common/prisma/prisma.service';
import { maskPhoneLast4 } from '../../common/rbac/pii-masking.interceptor';
import { decryptCallRoutingPhone, getCallRoutingKey } from './call-routing-key';
import { StaffService } from './staff.service';

@Injectable()
class CallRoutingBoot {
  constructor() {
    getCallRoutingKey();
  }
}

@Module({ providers: [CallRoutingBoot] })
class CallRoutingBootModule {}

const KEY = 'hidden_numbers_call_routing_key_32chars';
const SEEKER_PHONE = '+919800011199';
const BUSINESS_PHONE = '+919800022288';
const REFERRAL_PHONE = '+919800033377';
const CALLBACK_PHONE = '+919800044466';
const ROUTING_PHONE = '+919812345678';

describe('CALL_ROUTING_KEY', () => {
  const previous = process.env.CALL_ROUTING_KEY;

  afterEach(() => {
    process.env.CALL_ROUTING_KEY =
      previous && previous.trim().length >= 32 ? previous : KEY;
  });

  it('refuses to start when the key is missing or shorter than 32 characters', async () => {
    process.env.CALL_ROUTING_KEY = '';
    expect(() => getCallRoutingKey()).toThrow(/CALL_ROUTING_KEY environment variable is missing/);
    expect(
      () => new StaffService({} as never, {} as never, {} as never, {} as never, {} as never),
    ).toThrow(/CALL_ROUTING_KEY/);
    await expect(
      Test.createTestingModule({ imports: [CallRoutingBootModule] }).compile(),
    ).rejects.toThrow(/CALL_ROUTING_KEY/);

    process.env.CALL_ROUTING_KEY = 'too-short';
    expect(() => getCallRoutingKey()).toThrow(/at least 32 characters/);
  });
});

describe('Phase 11 Task 3: hidden numbers', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let jwt: JwtService;
  const staffIds: string[] = [];
  const seekerIds: string[] = [];
  const businessIds: string[] = [];
  const referralIds: string[] = [];
  const callbackIds: string[] = [];

  function tokenFor(staff: {
    id: string;
    role: string;
    code: string;
    email: string | null;
    teamLeadId?: string | null;
  }) {
    return jwt.sign({
      sub: staff.id,
      email: staff.email,
      role: staff.role,
      code: staff.code,
      teamLeadId: staff.teamLeadId ?? null,
    });
  }

  beforeAll(async () => {
    process.env.CALL_ROUTING_KEY = KEY;
    const moduleRef: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
    prisma = app.get(PrismaService);
    jwt = app.get(JwtService);
  }, 120000);

  afterAll(async () => {
    if (!prisma) {
      return;
    }
    await prisma.callbackTask.deleteMany({ where: { id: { in: callbackIds } } });
    await prisma.jobSeeker.deleteMany({ where: { id: { in: seekerIds } } });
    await prisma.business.deleteMany({ where: { id: { in: businessIds } } });
    await prisma.referral.deleteMany({ where: { id: { in: referralIds } } });
    await prisma.auditLog.deleteMany({ where: { actorId: { in: staffIds } } });
    await prisma.staff.deleteMany({ where: { id: { in: staffIds } } });
    await app.close();
  });

  async function makeStaff(role: string, extra?: { teamLeadId?: string }) {
    const stamp = `${Date.now()}-${staffIds.length}`;
    const staff = await prisma.staff.create({
      data: {
        code: `HN-${role.slice(0, 3).toUpperCase()}-${stamp}`,
        name: `Hidden ${role}`,
        email: `hn-${role}-${stamp}@laboura.local`,
        passwordHash: await bcrypt.hash('Hidden-Password-1', 4),
        role,
        city: 'Bengaluru',
        teamLeadId: extra?.teamLeadId ?? null,
        status: 'active',
      },
    });
    staffIds.push(staff.id);
    return staff;
  }

  it('shows agents only the last 4 digits, keeps the routing number encrypted, and leaves exports with management', async () => {
    const lead = await makeStaff('team_lead');
    const otherLead = await makeStaff('team_lead');
    const callAgent = await makeStaff('call_agent', { teamLeadId: lead.id });
    const fieldAgent = await makeStaff('field_agent', { teamLeadId: lead.id });
    const manager = await makeStaff('manager');
    const ceo = await makeStaff('ceo');
    const outsider = await makeStaff('call_agent');
    const stamp = Date.now();

    await prisma.callbackTask.deleteMany({
      where: { phone: { in: [SEEKER_PHONE, BUSINESS_PHONE, REFERRAL_PHONE, CALLBACK_PHONE] } },
    });
    await prisma.jobSeeker.deleteMany({ where: { phone: SEEKER_PHONE } });
    await prisma.business.deleteMany({ where: { phone: BUSINESS_PHONE } });
    await prisma.referral.deleteMany({ where: { phone: REFERRAL_PHONE } });

    const seeker = await prisma.jobSeeker.create({
      data: {
        code: `JS-HN-${stamp}`,
        name: 'Hidden Candidate',
        phone: SEEKER_PHONE,
        tradeSkill: 'Electrician',
        minSalary: 1000000,
        maxSalary: 2000000,
        preferredCallWindowStart: '10:00',
        preferredCallWindowEnd: '18:00',
        status: 'active',
        registeredByStaffId: callAgent.id,
      },
    });
    seekerIds.push(seeker.id);
    const business = await prisma.business.create({
      data: {
        code: `BZ-HN-${stamp}`,
        name: 'Hidden Cafe',
        phone: BUSINESS_PHONE,
        accountAgentId: fieldAgent.id,
      },
    });
    businessIds.push(business.id);
    const referral = await prisma.referral.create({
      data: { code: `RF-HN-${stamp}`, name: 'Hidden Partner', phone: REFERRAL_PHONE },
    });
    referralIds.push(referral.id);
    const callback = await prisma.callbackTask.create({
      data: {
        callId: `call-hn-${stamp}`,
        phone: CALLBACK_PHONE,
        jobSeekerId: seeker.id,
        virtualNumber: '18001234567',
      },
    });
    callbackIds.push(callback.id);

    async function readAll(token: string) {
      const seekerRes = await request(app.getHttpServer())
        .get(`/job-seekers/${seeker.id}`)
        .set('Authorization', `Bearer ${token}`);
      const businessRes = await request(app.getHttpServer())
        .get(`/businesses/${business.id}`)
        .set('Authorization', `Bearer ${token}`);
      const referralRes = await request(app.getHttpServer())
        .get(`/referrals/${referral.id}`)
        .set('Authorization', `Bearer ${token}`);
      const callbackRes = await request(app.getHttpServer())
        .get('/telephony/callbacks')
        .set('Authorization', `Bearer ${token}`);
      return { seekerRes, businessRes, referralRes, callbackRes };
    }

    for (const staff of [callAgent, fieldAgent, lead]) {
      const token = tokenFor(staff);
      const seekerRes = await request(app.getHttpServer())
        .get(`/job-seekers/${seeker.id}`)
        .set('Authorization', `Bearer ${token}`);
      const businessRes = await request(app.getHttpServer())
        .get(`/businesses/${business.id}`)
        .set('Authorization', `Bearer ${token}`);
      const referralRes = await request(app.getHttpServer())
        .get(`/referrals/${referral.id}`)
        .set('Authorization', `Bearer ${token}`);
      expect(seekerRes.status).toBe(200);
      expect(businessRes.status).toBe(200);
      expect(referralRes.status).toBe(200);
      expect(seekerRes.body.phone).toBe(maskPhoneLast4(SEEKER_PHONE));
      expect(businessRes.body.phone).toBe(maskPhoneLast4(BUSINESS_PHONE));
      expect(referralRes.body.phone).toBe(maskPhoneLast4(REFERRAL_PHONE));
      const packed = JSON.stringify({ seekerRes: seekerRes.body, businessRes: businessRes.body, referralRes: referralRes.body });
      for (const number of [SEEKER_PHONE, BUSINESS_PHONE, REFERRAL_PHONE]) {
        expect(packed).not.toContain(number);
      }
      expect(packed).not.toContain('"callRoutingPhone"');
    }

    for (const staff of [callAgent, lead]) {
      const callbackRes = await request(app.getHttpServer())
        .get('/telephony/callbacks')
        .set('Authorization', `Bearer ${tokenFor(staff)}`);
      expect(callbackRes.status).toBe(200);
      const task = callbackRes.body.find((row: { id: string }) => row.id === callback.id);
      expect(task.phone).toBe(maskPhoneLast4(CALLBACK_PHONE));
      expect(task.jobSeeker.phone).toBe(maskPhoneLast4(SEEKER_PHONE));
      expect(task.virtualNumber).toBe(maskPhoneLast4('18001234567'));
      expect(JSON.stringify(callbackRes.body)).not.toContain(CALLBACK_PHONE);
      expect(JSON.stringify(callbackRes.body)).not.toContain(SEEKER_PHONE);
    }

    const managerPages = await readAll(tokenFor(manager));
    expect(managerPages.seekerRes.body.phone).toBe(SEEKER_PHONE);
    expect(managerPages.businessRes.body.phone).toBe(BUSINESS_PHONE);
    expect(managerPages.referralRes.body.phone).toBe(REFERRAL_PHONE);
    const managerTask = managerPages.callbackRes.body.find(
      (row: { id: string }) => row.id === callback.id,
    );
    expect(managerTask.phone).toBe(CALLBACK_PHONE);
    expect(managerTask.virtualNumber).toBe('18001234567');

    const ceoPages = await readAll(tokenFor(ceo));
    expect(ceoPages.seekerRes.status).toBe(200);
    expect(ceoPages.seekerRes.body.phone).toBe(SEEKER_PHONE);
    expect(ceoPages.businessRes.body.phone).toBe(BUSINESS_PHONE);
    expect(ceoPages.referralRes.body.phone).toBe(REFERRAL_PHONE);

    const refused = await request(app.getHttpServer())
      .put(`/staff/${callAgent.id}/call-routing-phone`)
      .set('Authorization', `Bearer ${tokenFor(outsider)}`)
      .send({ phone: ROUTING_PHONE });
    expect(refused.status).toBe(403);

    const otherLeadRes = await request(app.getHttpServer())
      .put(`/staff/${callAgent.id}/call-routing-phone`)
      .set('Authorization', `Bearer ${tokenFor(otherLead)}`)
      .send({ phone: ROUTING_PHONE });
    expect(otherLeadRes.status).toBe(403);

    const setRes = await request(app.getHttpServer())
      .put(`/staff/${callAgent.id}/call-routing-phone`)
      .set('Authorization', `Bearer ${tokenFor(callAgent)}`)
      .send({ phone: ROUTING_PHONE });
    expect(setRes.status).toBe(200);
    expect(setRes.body).toEqual({ set: true });
    expect(JSON.stringify(setRes.body)).not.toContain(ROUTING_PHONE);
    expect(JSON.stringify(setRes.body)).not.toContain('callRoutingPhone');

    const stored = await prisma.staff.findUniqueOrThrow({
      where: { id: callAgent.id },
      select: { callRoutingPhone: true },
    });
    expect(stored.callRoutingPhone).toBeTruthy();
    expect(stored.callRoutingPhone).not.toContain(ROUTING_PHONE);
    expect(stored.callRoutingPhone).not.toMatch(/9812345678/);
    expect(decryptCallRoutingPhone(stored.callRoutingPhone as string)).toBe(ROUTING_PHONE);

    const leadSet = await request(app.getHttpServer())
      .put(`/staff/${fieldAgent.id}/call-routing-phone`)
      .set('Authorization', `Bearer ${tokenFor(lead)}`)
      .send({ phone: '+919800055544' });
    expect(leadSet.status).toBe(200);
    expect(leadSet.body).toEqual({ set: true });
    expect(JSON.stringify(leadSet.body)).not.toContain('9800055544');

    const managerSet = await request(app.getHttpServer())
      .put(`/staff/${callAgent.id}/call-routing-phone`)
      .set('Authorization', `Bearer ${tokenFor(manager)}`)
      .send({ phone: ROUTING_PHONE });
    expect(managerSet.status).toBe(200);
    expect(managerSet.body).toEqual({ set: true });

    const audit = await prisma.auditLog.findFirst({
      where: { action: 'staff.call_routing_phone_set', entityCode: callAgent.code },
    });
    expect(audit).toBeTruthy();
    const auditPacked = JSON.stringify(audit);
    expect(auditPacked).not.toContain(ROUTING_PHONE);
    expect(auditPacked).not.toContain('9812345678');

    const assignRes = await request(app.getHttpServer())
      .post(`/telephony/callbacks/${callback.id}/assign`)
      .set('Authorization', `Bearer ${tokenFor(callAgent)}`)
      .send({});
    expect(assignRes.status).toBe(201);
    const assignPacked = JSON.stringify(assignRes.body);
    expect(assignPacked).not.toContain('callRoutingPhone');
    expect(assignPacked).not.toContain(ROUTING_PHONE);
    expect(assignPacked).not.toContain('9812345678');
    expect(assignRes.body.phone).toBe(maskPhoneLast4(CALLBACK_PHONE));

    const staffView = await request(app.getHttpServer())
      .get(`/staff/${callAgent.id}`)
      .set('Authorization', `Bearer ${tokenFor(manager)}`);
    expect(staffView.status).toBe(200);
    expect(JSON.stringify(staffView.body)).not.toContain('callRoutingPhone');
    expect(JSON.stringify(staffView.body)).not.toContain(ROUTING_PHONE);

    const leadExport = await request(app.getHttpServer())
      .get('/placements/export')
      .set('Authorization', `Bearer ${tokenFor(lead)}`);
    expect(leadExport.status).toBe(403);
    const managerExport = await request(app.getHttpServer())
      .get('/placements/export')
      .set('Authorization', `Bearer ${tokenFor(manager)}`);
    expect(managerExport.status).toBe(200);
  }, 120000);
});
