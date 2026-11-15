import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { JwtService } from '@nestjs/jwt';
import * as request from 'supertest';
import { AppModule } from '../../app.module';
import { PrismaService } from '../../common/prisma/prisma.service';
import { LoginCodeService } from '../login-code/login-code.service';
import { ReportingScopeService } from './reporting-scope.service';
import { getCalendarPartsInTimezone } from '../../common/time/period-boundary';

jest.setTimeout(120000);

describe('Phase 21 Task 1: one reporting line', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let jwt: JwtService;
  let codes: LoginCodeService;
  let scope: ReportingScopeService;
  const stamp = `${Date.now()}`;
  const staffIds: string[] = [];
  const businessIds: string[] = [];

  function tokenFor(staff: { id: string; role: string; code: string }) {
    return jwt.sign({
      sub: staff.id,
      email: `${staff.id}@laboura.local`,
      role: staff.role,
      code: staff.code,
    });
  }

  async function make(
    role: string,
    prefix: string,
    line?: { teamLeadId?: string; reportsToId?: string },
  ) {
    const row = await prisma.staff.create({
      data: {
        code: `${prefix}-P21-${stamp}-${staffIds.length}`,
        name: `${prefix} reporting`,
        email: `${prefix.toLowerCase()}.${staffIds.length}.${stamp}@laboura.local`,
        passwordHash: 'hash',
        role,
        status: 'active',
        teamLeadId: line?.teamLeadId ?? null,
        reportsToId: line?.reportsToId ?? null,
      },
    });
    staffIds.push(row.id);
    return row;
  }

  beforeAll(async () => {
    const moduleRef: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
    prisma = app.get(PrismaService);
    jwt = app.get(JwtService);
    codes = app.get(LoginCodeService);
    scope = app.get(ReportingScopeService);
  });

  afterAll(async () => {
    try {
      if (staffIds.length > 0) {
        await prisma.followUpTask.deleteMany({
          where: { assignedStaffId: { in: staffIds } },
        });
        await prisma.visitAssignment.deleteMany({
          where: { assignedStaffId: { in: staffIds } },
        });
        await prisma.target.deleteMany({ where: { staffId: { in: staffIds } } });
        await prisma.loginCodeRequest.deleteMany({
          where: { staffId: { in: staffIds } },
        });
        await prisma.staffDevice.deleteMany({ where: { staffId: { in: staffIds } } });
        await prisma.statusHistory.deleteMany({
          where: { subjectType: 'staff', subjectId: { in: staffIds } },
        });
        await prisma.auditLog.deleteMany({
          where: { actorId: { in: staffIds } },
        });
      }
      if (businessIds.length > 0) {
        await prisma.business.deleteMany({ where: { id: { in: businessIds } } });
      }
      if (staffIds.length > 0) {
        await prisma.staff.updateMany({ where: { id: { in: staffIds } }, data: { teamLeadId: null, reportsToId: null, tempPasswordIssuedByStaffId: null } });
        await prisma.staff.deleteMany({ where: { id: { in: staffIds } } });
      }
    } finally {
      await app.close();
    }
  });

  it('requires each role to report to the right person, and writes an agent line in both fields', async () => {
    const ceo = await make('ceo', 'CEO');
    const manager = await make('manager', 'MGR', { reportsToId: ceo.id });
    const lead = await make('team_lead', 'TL', { reportsToId: manager.id });
    const ceoToken = tokenFor(ceo);

    const agent = await request(app.getHttpServer())
      .post('/staff')
      .set('Authorization', `Bearer ${ceoToken}`)
      .send({
        name: 'Lined agent',
        email: `lined.agent.${stamp}@laboura.local`,
        role: 'call_agent',
        teamLeadId: lead.id,
      });
    expect(agent.status).toBe(201);
    staffIds.push(agent.body.staff.id);
    expect(agent.body.staff.teamLeadId).toBe(lead.id);
    expect(agent.body.staff.reportsToId).toBe(lead.id);

    const noLine = await request(app.getHttpServer())
      .post('/staff')
      .set('Authorization', `Bearer ${ceoToken}`)
      .send({
        name: 'Unlined agent',
        email: `unlined.agent.${stamp}@laboura.local`,
        role: 'field_agent',
      });
    expect(noLine.status).toBe(400);
    expect(noLine.body.message).toContain('must report to a Team Lead');

    const leadWithoutManager = await request(app.getHttpServer())
      .post('/staff')
      .set('Authorization', `Bearer ${ceoToken}`)
      .send({
        name: 'Unlined lead',
        email: `unlined.lead.${stamp}@laboura.local`,
        role: 'team_lead',
      });
    expect(leadWithoutManager.status).toBe(400);
    expect(leadWithoutManager.body.message).toContain('must report to a Manager');

    const managerWithoutCeo = await request(app.getHttpServer())
      .post('/staff')
      .set('Authorization', `Bearer ${ceoToken}`)
      .send({
        name: 'Unlined manager',
        email: `unlined.mgr.${stamp}@laboura.local`,
        role: 'manager',
      });
    expect(managerWithoutCeo.status).toBe(400);
    expect(managerWithoutCeo.body.message).toContain('CEO');

    const financeWithoutCeo = await request(app.getHttpServer())
      .post('/staff')
      .set('Authorization', `Bearer ${ceoToken}`)
      .send({
        name: 'Unlined finance',
        email: `unlined.fin.${stamp}@laboura.local`,
        role: 'finance',
      });
    expect(financeWithoutCeo.status).toBe(400);
    expect(financeWithoutCeo.body.message).toContain('CEO');

    const ceoWithBoss = await request(app.getHttpServer())
      .post('/staff')
      .set('Authorization', `Bearer ${ceoToken}`)
      .send({
        name: 'Second chief',
        email: `second.ceo.${stamp}@laboura.local`,
        role: 'ceo',
        reportsToId: ceo.id,
      });
    expect(ceoWithBoss.status).toBe(400);
    expect(ceoWithBoss.body.message).toContain('reports to nobody');

    const chain = await scope.chainOf(agent.body.staff.id);
    expect(chain.teamLead?.id).toBe(lead.id);
    expect(chain.manager?.id).toBe(manager.id);
    expect(chain.ceo?.id).toBe(ceo.id);
  });

  it('a boss who is not signed in yet can be chosen; a deactivated one never (rev 174–175)', async () => {
    const ceo = await make('ceo', 'PBCEO');
    const manager = await make('manager', 'PBMGR', { reportsToId: ceo.id });
    const pendingLead = await make('team_lead', 'PBTL', { reportsToId: manager.id });
    await prisma.staff.update({ where: { id: pendingLead.id }, data: { status: 'pending_invite' } });
    const goneLead = await make('team_lead', 'PBGONE', { reportsToId: manager.id });
    await prisma.staff.update({ where: { id: goneLead.id }, data: { status: 'deactivated', deactivatedAt: new Date() } });
    const ceoToken = tokenFor(ceo);
    const underPending = await request(app.getHttpServer())
      .post('/staff')
      .set('Authorization', `Bearer ${ceoToken}`)
      .send({ name: 'Under pending', role: 'call_agent', reportsToId: pendingLead.id });
    expect(underPending.status).toBe(201);
    staffIds.push(underPending.body.staff.id);
    expect(underPending.body.staff).toMatchObject({ teamLeadId: pendingLead.id, reportsToId: pendingLead.id });
    const underGone = await request(app.getHttpServer())
      .post('/staff')
      .set('Authorization', `Bearer ${ceoToken}`)
      .send({ name: 'Under gone', role: 'call_agent', reportsToId: goneLead.id });
    expect(underGone.status).toBe(400);
    // The options list labels the pending boss and leaves the deactivated one out.
    const team = await request(app.getHttpServer()).get('/ceo/team').set('Authorization', `Bearer ${ceoToken}`).expect(200);
    const options = team.body.reportsToOptions as Array<{ id: string; notSignedInYet: boolean }>;
    expect(options.find((o) => o.id === pendingLead.id)).toMatchObject({ notSignedInYet: true });
    expect(options.map((o) => o.id)).not.toContain(goneLead.id);
    // A boss with people under them cannot be deactivated until they are moved.
    const blocked = await request(app.getHttpServer()).post(`/staff/${pendingLead.id}/deactivate`).set('Authorization', `Bearer ${ceoToken}`);
    expect(blocked.status).toBe(400);
    expect(blocked.body.message).toContain('still reports to this account');
  });

  it('an owner agent account may report straight to a CEO (no Team Lead); a normal agent may not; only the CEO moves it (rev 174–175)', async () => {
    const ceo = await make('ceo', 'OWCEO');
    const manager = await make('manager', 'OWMGR', { reportsToId: ceo.id });
    const lead = await make('team_lead', 'OWTL', { reportsToId: manager.id });
    const ceoToken = tokenFor(ceo);
    const normal = await request(app.getHttpServer())
      .post('/staff')
      .set('Authorization', `Bearer ${ceoToken}`)
      .send({ name: 'Normal under CEO', role: 'call_agent', reportsToId: ceo.id });
    expect(normal.status).toBe(400);
    const owner = await request(app.getHttpServer())
      .post('/staff')
      .set('Authorization', `Bearer ${ceoToken}`)
      .send({ name: 'Owner calls', role: 'call_agent', reportsToId: ceo.id, ownerAccount: true });
    expect(owner.status).toBe(201);
    staffIds.push(owner.body.staff.id);
    expect(owner.body.staff).toMatchObject({ reportsToId: ceo.id, teamLeadId: null, isOwnerAccount: true });
    const chain = await scope.chainOf(owner.body.staff.id);
    expect(chain.teamLead).toBeNull();
    expect(chain.ceo?.id).toBe(ceo.id);
    // Clearing "owner account" while reporting to a CEO is refused.
    const clear = await request(app.getHttpServer())
      .put(`/staff/${owner.body.staff.id}/owner-account`)
      .set('Authorization', `Bearer ${ceoToken}`)
      .send({ ownerAccount: false });
    expect(clear.status).toBe(400);
    // A Manager cannot move it (it sits in no Manager's tree).
    const byManager = await request(app.getHttpServer())
      .post(`/staff/${owner.body.staff.id}/reporting-line`)
      .set('Authorization', `Bearer ${tokenFor(manager)}`)
      .send({ reportsToId: lead.id, reason: 'try' });
    expect(byManager.status).toBe(403);
    // The CEO moves it to a Team Lead: the Team Lead link is written again.
    const moved = await request(app.getHttpServer())
      .post(`/staff/${owner.body.staff.id}/reporting-line`)
      .set('Authorization', `Bearer ${ceoToken}`)
      .send({ reportsToId: lead.id, reason: 'into a team' });
    expect(moved.status).toBe(201);
    expect(moved.body).toMatchObject({ reportsToId: lead.id, teamLeadId: lead.id });
    // And back to the CEO: no Team Lead.
    const back = await request(app.getHttpServer())
      .post(`/staff/${owner.body.staff.id}/reporting-line`)
      .set('Authorization', `Bearer ${ceoToken}`)
      .send({ reportsToId: ceo.id, reason: 'owner line' });
    expect(back.body).toMatchObject({ reportsToId: ceo.id, teamLeadId: null });
    // Login codes for it come only from a CEO.
    const device = await prisma.staffDevice.create({ data: { staffId: owner.body.staff.id, deviceId: `ow-${stamp}`, label: 'x', platform: 'web', status: 'approved', approvedAt: new Date() } });
    const req = await codes.create(owner.body.staff.id, device.id, '127.0.0.1');
    await expect(codes.reveal(req.id, { id: lead.id, role: 'team_lead' })).rejects.toThrow();
    await expect(codes.reveal(req.id, { id: manager.id, role: 'manager' })).rejects.toThrow();
    await expect(codes.reveal(req.id, { id: ceo.id, role: 'ceo' })).resolves.toHaveProperty('code');
  });

  it('copies an existing Team Lead link into reportsToId', async () => {
    const lead = await make('team_lead', 'COPYTL');
    const agent = await make('call_agent', 'COPYCA', { teamLeadId: lead.id });
    await prisma.staff.update({
      where: { id: agent.id },
      data: { reportsToId: null },
    });

    await prisma.$executeRaw`
      UPDATE "Staff"
      SET "reportsToId" = "teamLeadId"
      WHERE "reportsToId" IS NULL
        AND "teamLeadId" IS NOT NULL
        AND "id" = ${agent.id}
    `;

    const copied = await prisma.staff.findUniqueOrThrow({ where: { id: agent.id } });
    expect(copied.reportsToId).toBe(lead.id);
    expect(copied.teamLeadId).toBe(lead.id);
  });

  it('records a move and takes open work with the person', async () => {
    const ceo = await make('ceo', 'MOVECEO');
    const manager = await make('manager', 'MOVEMGR', { reportsToId: ceo.id });
    const fromLead = await make('team_lead', 'FROM', { reportsToId: manager.id });
    const toLead = await make('team_lead', 'TO', { reportsToId: manager.id });
    const agent = await make('call_agent', 'MOVER', {
      teamLeadId: fromLead.id,
      reportsToId: fromLead.id,
    });
    const { year, month } = getCalendarPartsInTimezone(new Date());
    await prisma.target.create({
      data: {
        staffId: agent.id,
        year,
        month,
        candidatesActivated: 4,
        createdById: ceo.id,
      },
    });
    await prisma.followUpTask.create({
      data: {
        code: `FU-P21-${stamp}`,
        kind: 'refund_check',
        subjectType: 'job_seeker',
        subjectId: agent.id,
        dueAt: new Date(),
        assignedStaffId: agent.id,
        status: 'pending',
      },
    });
    const business = await prisma.business.create({
      data: {
        code: `BZ-P21-${stamp}`,
        name: 'Reporting Line Shop',
        phone: `8${stamp.slice(-9)}`,
        city: 'Bengaluru',
        accountAgentId: agent.id,
      },
    });
    businessIds.push(business.id);
    await prisma.visitAssignment.create({
      data: {
        businessId: business.id,
        purpose: 'verification',
        assignedStaffId: agent.id,
        status: 'pending',
      },
    });

    const moved = await request(app.getHttpServer())
      .post(`/staff/${agent.id}/reporting-line`)
      .set('Authorization', `Bearer ${tokenFor(ceo)}`)
      .send({ reportsToId: toLead.id, reason: 'Team reshuffle' });
    expect(moved.status).toBe(201);
    expect(moved.body.reportsToId).toBe(toLead.id);
    expect(moved.body.teamLeadId).toBe(toLead.id);

    const followUp = await prisma.followUpTask.findFirstOrThrow({
      where: { code: `FU-P21-${stamp}` },
    });
    const visit = await prisma.visitAssignment.findFirstOrThrow({
      where: { businessId: business.id },
    });
    const target = await prisma.target.findFirstOrThrow({
      where: { staffId: agent.id, year, month },
    });
    const account = await prisma.business.findUniqueOrThrow({ where: { id: business.id } });
    expect(followUp.assignedStaffId).toBe(agent.id);
    expect(visit.assignedStaffId).toBe(agent.id);
    expect(target.staffId).toBe(agent.id);
    expect(account.accountAgentId).toBe(agent.id);

    const history = await prisma.statusHistory.findFirst({
      where: {
        subjectType: 'staff',
        subjectId: agent.id,
        fromStatus: fromLead.id,
        toStatus: toLead.id,
      },
    });
    expect(history?.reason).toBe('Team reshuffle');
    expect(history?.changedByStaffId).toBe(ceo.id);

    const audit = await prisma.auditLog.findFirst({
      where: { action: 'staff.reporting_line_moved', entityCode: agent.code },
    });
    expect(audit?.actorId).toBe(ceo.id);
    expect(audit?.before).toMatchObject({
      reportsToId: fromLead.id,
      teamLeadId: fromLead.id,
    });
    expect(audit?.after).toMatchObject({
      reportsToId: toLead.id,
      teamLeadId: toLead.id,
      moveOpenWork: true,
      openWork: { followedThePerson: true, followUpCount: 1, accountCount: 1 },
    });

    const outside = await make('team_lead', 'OUT');
    const refused = await request(app.getHttpServer())
      .post(`/staff/${agent.id}/reporting-line`)
      .set('Authorization', `Bearer ${tokenFor(manager)}`)
      .send({ reportsToId: outside.id, reason: 'Not my team' });
    expect(refused.status).toBe(403);
  });

  it('lists people without a line for the CEO, and a Manager cannot approve outside their tree', async () => {
    const ceo = await make('ceo', 'LISTCEO');
    const manager = await make('manager', 'LISTMGR', { reportsToId: ceo.id });
    const otherManager = await make('manager', 'OTHERMGR', { reportsToId: ceo.id });
    const lead = await make('team_lead', 'LISTTL', { reportsToId: manager.id });
    const otherLead = await make('team_lead', 'OTHERTL', { reportsToId: otherManager.id });
    const agent = await make('call_agent', 'LISTCA', {
      teamLeadId: lead.id,
      reportsToId: lead.id,
    });
    const outsider = await make('field_agent', 'OUTCA', {
      teamLeadId: otherLead.id,
      reportsToId: otherLead.id,
    });
    const unlined = await make('finance', 'NOLINE');

    const list = await request(app.getHttpServer())
      .get('/staff/without-reporting-line')
      .set('Authorization', `Bearer ${tokenFor(ceo)}`);
    expect(list.status).toBe(200);
    const listedIds = list.body.map((row: { id: string }) => row.id);
    expect(listedIds).toContain(unlined.id);
    expect(listedIds).not.toContain(ceo.id);
    expect(listedIds).not.toContain(agent.id);

    const managerList = await request(app.getHttpServer())
      .get('/staff/without-reporting-line')
      .set('Authorization', `Bearer ${tokenFor(manager)}`);
    expect(managerList.status).toBe(403);

    const tree = await request(app.getHttpServer())
      .get('/staff/reporting-tree')
      .set('Authorization', `Bearer ${tokenFor(manager)}`);
    expect(tree.status).toBe(200);
    const treeIds = tree.body.people.map((row: { id: string }) => row.id);
    expect(treeIds).toContain(manager.id);
    expect(treeIds).toContain(lead.id);
    expect(treeIds).toContain(agent.id);
    expect(treeIds).not.toContain(outsider.id);

    const device = await prisma.staffDevice.create({
      data: {
        staffId: outsider.id,
        deviceId: `p21-${stamp}`,
        label: 'Handset',
        platform: 'android',
        status: 'approved',
        approvedAt: new Date(),
      },
    });
    const requestRow = await codes.create(outsider.id, device.id, '203.0.113.21');
    const denied = await request(app.getHttpServer())
      .post(`/login-codes/${requestRow.id}/reveal`)
      .set('Authorization', `Bearer ${tokenFor(manager)}`);
    expect(denied.status).toBe(403);

    const allowed = await request(app.getHttpServer())
      .post(`/login-codes/${requestRow.id}/reveal`)
      .set('Authorization', `Bearer ${tokenFor(ceo)}`);
    expect(allowed.status).toBe(200);
    expect(allowed.body.code).toMatch(/^\d{6}$/);
  });
});
