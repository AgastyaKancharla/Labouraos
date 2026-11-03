import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import * as request from 'supertest';
import { JwtService } from '@nestjs/jwt';
import { AppModule } from '../../app.module';
import { PrismaService } from '../../common/prisma/prisma.service';
import { applyTrustProxy } from '../../common/http/trust-proxy';
import { OfficeNetworkService } from './office-network.service';

describe('Phase 10 Task 2: Office networks', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let jwtService: JwtService;
  let networks: OfficeNetworkService;

  let ceoToken: string;
  let managerToken: string;
  let teamLeadToken: string;
  let callAgentToken: string;
  let fieldAgentToken: string;
  let financeToken: string;
  let agentId: string;

  function token(staff: { id: string; role: string; code: string }) {
    return jwtService.sign({
      sub: staff.id,
      email: `${staff.id}@laboura.local`,
      role: staff.role,
      code: staff.code,
    });
  }

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleFixture.createNestApplication();
    applyTrustProxy(app, '0');
    await app.init();
    prisma = app.get(PrismaService);
    jwtService = app.get(JwtService);
    networks = app.get(OfficeNetworkService);

    const stamp = Date.now();
    const make = async (role: string, prefix: string) =>
      prisma.staff.create({
        data: {
          code: `${prefix}-ON-${stamp}`,
          name: `${prefix} office`,
          email: `${prefix.toLowerCase()}.on.${stamp}@laboura.local`,
          passwordHash: 'dummyhash',
          role,
          status: 'active',
        },
      });

    const ceo = await make('ceo', 'CEO');
    const manager = await make('manager', 'MGR');
    const lead = await make('team_lead', 'TL');
    const callAgent = await make('call_agent', 'CA');
    const fieldAgent = await make('field_agent', 'FA');
    const finance = await make('finance', 'FIN');
    agentId = callAgent.id;

    ceoToken = token(ceo);
    managerToken = token(manager);
    teamLeadToken = token(lead);
    callAgentToken = token(callAgent);
    fieldAgentToken = token(fieldAgent);
    financeToken = token(finance);

    expect(callAgent.worksFromOffice).toBe(false);
  });

  afterAll(async () => {
    await app.close();
  });

  it('matches an address inside an active range and not one outside, including IPv6', async () => {
    await prisma.officeNetwork.updateMany({ data: { active: false } });
    expect(await networks.isOnOfficeNetwork('203.0.113.10')).toBe(false);
    expect(await networks.isOnOfficeNetwork('')).toBe(false);

    const added = await request(app.getHttpServer())
      .post('/office-networks')
      .set('Authorization', `Bearer ${ceoToken}`)
      .send({ label: 'Bengaluru office', cidr: '203.0.113.0/24' })
      .expect(201);
    expect(added.body.active).toBe(true);
    expect(added.body.cidr).toBe('203.0.113.0/24');

    const audit = await prisma.auditLog.findFirst({
      where: { action: 'office_network.added', entityCode: added.body.id },
    });
    expect(audit).toBeTruthy();

    expect(await networks.isOnOfficeNetwork('203.0.113.10')).toBe(true);
    expect(await networks.isOnOfficeNetwork('198.51.100.10')).toBe(false);
    expect(await networks.isOnOfficeNetwork('::ffff:203.0.113.10')).toBe(true);

    const v6 = await request(app.getHttpServer())
      .post('/office-networks')
      .set('Authorization', `Bearer ${managerToken}`)
      .send({ label: 'Office v6', cidr: '2001:db8::/32' })
      .expect(201);
    expect(await networks.isOnOfficeNetwork('2001:db8::1')).toBe(true);
    expect(await networks.isOnOfficeNetwork('2001:db9::1')).toBe(false);

    await request(app.getHttpServer())
      .post('/office-networks')
      .set('Authorization', `Bearer ${ceoToken}`)
      .send({ label: 'bad', cidr: 'not-a-cidr' })
      .expect(400);

    const listed = await request(app.getHttpServer())
      .get('/office-networks')
      .set('Authorization', `Bearer ${managerToken}`)
      .expect(200);
    expect(listed.body.some((row: { id: string }) => row.id === v6.body.id)).toBe(true);
  });

  it('ignores a spoofed X-Forwarded-For beyond the trusted hop', async () => {
    applyTrustProxy(app, '0');
    const ignored = await request(app.getHttpServer())
      .get('/office-networks/check')
      .set('Authorization', `Bearer ${ceoToken}`)
      .set('X-Forwarded-For', '203.0.113.10')
      .expect(200);
    expect(ignored.body.onOfficeNetwork).toBe(false);

    applyTrustProxy(app, '1');
    const observed = await request(app.getHttpServer())
      .get('/office-networks/check')
      .set('Authorization', `Bearer ${ceoToken}`)
      .set('X-Forwarded-For', '6.6.6.6, 203.0.113.10')
      .expect(200);
    expect(observed.body.onOfficeNetwork).toBe(true);

    const spoofedLeft = await request(app.getHttpServer())
      .get('/office-networks/check')
      .set('Authorization', `Bearer ${ceoToken}`)
      .set('X-Forwarded-For', '203.0.113.10, 198.51.100.20')
      .expect(200);
    expect(spoofedLeft.body.onOfficeNetwork).toBe(false);
  });

  it('stops matching a range once it is deactivated', async () => {
    const row = await prisma.officeNetwork.findFirst({
      where: { cidr: '203.0.113.0/24', active: true },
    });
    expect(row).toBeTruthy();
    const res = await request(app.getHttpServer())
      .post(`/office-networks/${row!.id}/deactivate`)
      .set('Authorization', `Bearer ${ceoToken}`)
      .expect(200);
    expect(res.body.active).toBe(false);
    expect(await networks.isOnOfficeNetwork('203.0.113.10')).toBe(false);

    const v6 = await prisma.officeNetwork.findFirst({
      where: { cidr: '2001:db8::/32', active: true },
    });
    expect(await networks.isOnOfficeNetwork('2001:db8::1')).toBe(true);
    await request(app.getHttpServer())
      .post(`/office-networks/${v6!.id}/deactivate`)
      .set('Authorization', `Bearer ${managerToken}`)
      .expect(200);
    expect(await networks.isOnOfficeNetwork('2001:db8::1')).toBe(false);
  });

  it('lets the CEO set worksFromOffice and refuses Team Leads and agents', async () => {
    const set = await request(app.getHttpServer())
      .post(`/staff/${agentId}/works-from-office`)
      .set('Authorization', `Bearer ${ceoToken}`)
      .send({ worksFromOffice: true })
      .expect(200);
    expect(set.body.worksFromOffice).toBe(true);
    const staff = await prisma.staff.findUnique({ where: { id: agentId } });
    expect(staff?.worksFromOffice).toBe(true);

    const audit = await prisma.auditLog.findFirst({
      where: { action: 'staff.works_from_office_set', entityCode: staff!.code },
    });
    expect(audit?.after).toMatchObject({ worksFromOffice: true });

    for (const bearer of [teamLeadToken, callAgentToken, fieldAgentToken, financeToken]) {
      await request(app.getHttpServer())
        .get('/office-networks')
        .set('Authorization', `Bearer ${bearer}`)
        .expect(403);
      await request(app.getHttpServer())
        .post('/office-networks')
        .set('Authorization', `Bearer ${bearer}`)
        .send({ label: 'nope', cidr: '10.0.0.0/8' })
        .expect(403);
      await request(app.getHttpServer())
        .post(`/staff/${agentId}/works-from-office`)
        .set('Authorization', `Bearer ${bearer}`)
        .send({ worksFromOffice: false })
        .expect(403);
    }
  });
});
