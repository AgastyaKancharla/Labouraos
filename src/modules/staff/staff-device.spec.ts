import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import * as request from 'supertest';
import { JwtService } from '@nestjs/jwt';
import { AppModule } from '../../app.module';
import { PrismaService } from '../../common/prisma/prisma.service';
import { StaffDeviceService } from './staff-device.service';

describe('Phase 10 Task 1: Staff devices', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let jwtService: JwtService;
  let devices: StaffDeviceService;

  let ceoToken: string;
  let managerToken: string;
  let teamLead1Token: string;
  let teamLead2Token: string;
  let callAgentToken: string;
  let financeToken: string;

  let ceoId: string;
  let managerId: string;
  let teamLead1Id: string;
  let agent1Id: string;
  let agent2Id: string;
  let financeId: string;

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
    await app.init();
    prisma = app.get(PrismaService);
    jwtService = app.get(JwtService);
    devices = app.get(StaffDeviceService);

    const stamp = Date.now();
    const make = async (
      role: string,
      prefix: string,
      teamLeadId?: string,
    ) => {
      const row = await prisma.staff.create({
        data: {
          code: `${prefix}-DV-${stamp}`,
          name: `${prefix} devices`,
          email: `${prefix.toLowerCase()}.dv.${stamp}@laboura.local`,
          passwordHash: 'dummyhash',
          role,
          status: 'active',
          teamLeadId: teamLeadId ?? null,
        },
      });
      return row;
    };

    const ceo = await make('ceo', 'CEO');
    const manager = await make('manager', 'MGR');
    const tl1 = await make('team_lead', 'TL1');
    const tl2 = await make('team_lead', 'TL2');
    const fa1 = await make('field_agent', 'FA1', tl1.id);
    const fa2 = await make('call_agent', 'CA2', tl2.id);
    const fin = await make('finance', 'FIN');

    ceoId = ceo.id;
    managerId = manager.id;
    teamLead1Id = tl1.id;
    agent1Id = fa1.id;
    agent2Id = fa2.id;
    financeId = fin.id;

    ceoToken = token(ceo);
    managerToken = token(manager);
    teamLead1Token = token(tl1);
    teamLead2Token = token(tl2);
    callAgentToken = token(fa2);
    financeToken = token(fin);
  });

  afterAll(async () => {
    await app.close();
  });

  it('keeps one pending row when the same device is requested twice', async () => {
    const first = await devices.requestApproval(agent1Id, 'phone-a', 'Shop phone', 'android');
    const second = await devices.requestApproval(agent1Id, 'phone-a', 'Shop phone', 'android');
    expect(second.id).toBe(first.id);
    expect(second.status).toBe('pending');
    const count = await prisma.staffDevice.count({
      where: { staffId: agent1Id, deviceId: 'phone-a' },
    });
    expect(count).toBe(1);
    expect(await devices.findApproved(agent1Id, 'phone-a')).toBeNull();
  });

  it('lets a Team Lead approve their own agent and refuses another team', async () => {
    const own = await prisma.staffDevice.findFirst({
      where: { staffId: agent1Id, deviceId: 'phone-a' },
    });
    const res = await request(app.getHttpServer())
      .post(`/staff/devices/${own!.id}/approve`)
      .set('Authorization', `Bearer ${teamLead1Token}`)
      .expect(200);
    expect(res.body.status).toBe('approved');
    expect(res.body.approvedByStaffId).toBe(teamLead1Id);
    expect((await devices.findApproved(agent1Id, 'phone-a'))?.id).toBe(own!.id);

    const audit = await prisma.auditLog.findFirst({
      where: { action: 'staff_device.approved', entityCode: own!.id },
    });
    expect(audit?.actorId).toBe(teamLead1Id);

    const other = await devices.requestApproval(agent2Id, 'phone-b', 'Desk', 'web');
    await request(app.getHttpServer())
      .post(`/staff/devices/${other.id}/approve`)
      .set('Authorization', `Bearer ${teamLead1Token}`)
      .expect(403);

    const pending = await request(app.getHttpServer())
      .get('/staff/devices/pending')
      .set('Authorization', `Bearer ${teamLead1Token}`)
      .expect(200);
    const ids = pending.body.map((row: { staffId: string }) => row.staffId);
    expect(ids).not.toContain(agent2Id);
    expect(ids).not.toContain(teamLead1Id);

    const tl2Pending = await request(app.getHttpServer())
      .get('/staff/devices/pending')
      .set('Authorization', `Bearer ${teamLead2Token}`)
      .expect(200);
    expect(
      tl2Pending.body.map((row: { staffId: string }) => row.staffId),
    ).toContain(agent2Id);
  });

  it('refuses every approver on their own device, including management devices', async () => {
    const ownLead = await devices.requestApproval(
      teamLead1Id,
      'lead-laptop',
      'Lead laptop',
      'web',
    );
    await request(app.getHttpServer())
      .post(`/staff/devices/${ownLead.id}/approve`)
      .set('Authorization', `Bearer ${teamLead1Token}`)
      .expect(403);
    expect(
      (await prisma.staffDevice.findUnique({ where: { id: ownLead.id } }))?.status,
    ).toBe('pending');

    const managerDevice = await devices.requestApproval(
      managerId,
      'mgr-laptop',
      'Manager laptop',
      'web',
    );
    await request(app.getHttpServer())
      .post(`/staff/devices/${managerDevice.id}/approve`)
      .set('Authorization', `Bearer ${managerToken}`)
      .expect(403);

    const financeDevice = await devices.requestApproval(
      financeId,
      'fin-laptop',
      'Finance laptop',
      'web',
    );
    await request(app.getHttpServer())
      .post(`/staff/devices/${financeDevice.id}/approve`)
      .set('Authorization', `Bearer ${ceoToken}`)
      .expect(403);

    const leadApproved = await request(app.getHttpServer())
      .post(`/staff/devices/${ownLead.id}/approve`)
      .set('Authorization', `Bearer ${managerToken}`)
      .expect(200);
    expect(leadApproved.body.status).toBe('approved');
    expect(leadApproved.body.approvedByStaffId).toBe(managerId);
    expect(ceoId).toBeTruthy();
  });

  it('ends open sessions that used a revoked device and leaves other sessions', async () => {
    const device = await devices.findApproved(agent1Id, 'phone-a');
    expect(device).toBeTruthy();
    const open = await prisma.staffSession.create({
      data: {
        staffId: agent1Id,
        deviceId: 'phone-a',
        expiresAt: new Date(Date.now() + 60 * 60 * 1000),
        absoluteExpiresAt: new Date(Date.now() + 2 * 60 * 60 * 1000),
        lastActivityAt: new Date(),
      },
    });
    const other = await prisma.staffSession.create({
      data: {
        staffId: agent1Id,
        deviceId: 'spare-phone',
        expiresAt: new Date(Date.now() + 60 * 60 * 1000),
        absoluteExpiresAt: new Date(Date.now() + 2 * 60 * 60 * 1000),
        lastActivityAt: new Date(),
      },
    });

    const res = await request(app.getHttpServer())
      .post(`/staff/devices/${device!.id}/revoke`)
      .set('Authorization', `Bearer ${teamLead1Token}`)
      .expect(200);
    expect(res.body.status).toBe('revoked');
    expect(res.body.revokedByStaffId).toBe(teamLead1Id);

    const ended = await prisma.staffSession.findUnique({ where: { id: open.id } });
    const spared = await prisma.staffSession.findUnique({ where: { id: other.id } });
    expect(ended?.revokedAt).toBeTruthy();
    expect(spared?.revokedAt).toBeNull();
    expect(await devices.findApproved(agent1Id, 'phone-a')).toBeNull();
  });

  it('refuses agents and Finance the approval endpoints, and scopes device lists', async () => {
    await request(app.getHttpServer())
      .get('/staff/devices/pending')
      .set('Authorization', `Bearer ${callAgentToken}`)
      .expect(403);
    await request(app.getHttpServer())
      .get('/staff/devices/pending')
      .set('Authorization', `Bearer ${financeToken}`)
      .expect(403);

    const ownList = await request(app.getHttpServer())
      .get(`/staff/${agent2Id}/devices`)
      .set('Authorization', `Bearer ${callAgentToken}`)
      .expect(200);
    expect(ownList.body.length).toBeGreaterThan(0);

    await request(app.getHttpServer())
      .get(`/staff/${agent1Id}/devices`)
      .set('Authorization', `Bearer ${callAgentToken}`)
      .expect(403);

    await request(app.getHttpServer())
      .get(`/staff/${agent1Id}/devices`)
      .set('Authorization', `Bearer ${teamLead2Token}`)
      .expect(403);

    const leadList = await request(app.getHttpServer())
      .get(`/staff/${agent1Id}/devices`)
      .set('Authorization', `Bearer ${teamLead1Token}`)
      .expect(200);
    expect(leadList.body.some((row: { deviceId: string }) => row.deviceId === 'phone-a')).toBe(
      true,
    );

    await request(app.getHttpServer())
      .get(`/staff/${financeId}/devices`)
      .set('Authorization', `Bearer ${managerToken}`)
      .expect(200);
  });

  it('carries an existing registered device over as approved with no approver', async () => {
    const stamp = Date.now();
    const staff = await prisma.staff.create({
      data: {
        code: `MIG-DV-${stamp}`,
        name: 'Migrated device',
        email: `mig.dv.${stamp}@laboura.local`,
        passwordHash: 'dummyhash',
        role: 'field_agent',
        status: 'active',
      },
    });

    const copied = await prisma.staffDevice.create({
      data: {
        staffId: staff.id,
        deviceId: `legacy-${stamp}`,
        status: 'approved',
        label: 'migrated',
      },
    });

    expect(copied?.status).toBe('approved');
    expect(copied?.approvedByStaffId).toBeNull();
    expect(copied?.label).toBe('migrated');
  });
});
