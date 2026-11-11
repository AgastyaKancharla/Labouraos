import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcrypt';
import * as request from 'supertest';
import { AppModule } from '../../app.module';
import { PrismaService } from '../prisma/prisma.service';
import { isMoneyKey } from './money-visibility';
import { FULL_PHONE_VIEW_ACTION, FULL_PHONE_VIEW_ENTITY } from './pii-masking.interceptor';
import { receiptToken } from '../../modules/payment/receipt-link';

/**
 * Who can see and do what (Master Guide, People and roles; Staff login and
 * security; reconfirmed 11 Nov): Managers see no money and no full phone
 * numbers, act only inside their own reporting tree, and read only their own
 * teams' audit rows. CEO views of full numbers are logged.
 */

function moneyKeysIn(value: unknown, path = '$', found: string[] = []): string[] {
  if (Array.isArray(value)) {
    value.forEach((item, index) => moneyKeysIn(item, `${path}[${index}]`, found));
  } else if (value && typeof value === 'object') {
    for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
      if (isMoneyKey(key)) found.push(`${path}.${key}`);
      moneyKeysIn(child, `${path}.${key}`, found);
    }
  }
  return found;
}

describe('Access matches the Master Guide (Managers, CEO, audit, receipts)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let jwt: JwtService;
  const stamp = `${Date.now()}`;
  const staffIds: string[] = [];
  const seekerIds: string[] = [];
  const paymentIds: string[] = [];
  const targetIds: string[] = [];
  let counter = 0;

  type StaffRow = Awaited<ReturnType<PrismaService['staff']['create']>>;
  let ceo: StaffRow;
  let managerA: StaffRow;
  let managerB: StaffRow;
  let leadA: StaffRow;
  let leadB: StaffRow;
  let agentA: StaffRow;
  let agentB: StaffRow;
  let finance: StaffRow;

  async function makeStaff(
    role: string,
    line: { reportsToId?: string | null; teamLeadId?: string | null } = {},
  ): Promise<StaffRow> {
    counter += 1;
    const staff = await prisma.staff.create({
      data: {
        code: `W1-${role.slice(0, 3).toUpperCase()}-${stamp}-${counter}`,
        name: `W1 ${role} ${counter}`,
        email: `w1-${role}-${stamp}-${counter}@laboura.local`,
        passwordHash: await bcrypt.hash('W1-Access-Password-1', 4),
        role,
        city: 'Bengaluru',
        status: 'active',
        reportsToId: line.reportsToId ?? null,
        teamLeadId: line.teamLeadId ?? null,
      },
    });
    staffIds.push(staff.id);
    return staff;
  }

  function tokenFor(staff: StaffRow): string {
    return jwt.sign({
      sub: staff.id,
      email: staff.email,
      role: staff.role,
      code: staff.code,
      teamLeadId: staff.teamLeadId ?? null,
    });
  }

  const server = () => app.getHttpServer();

  beforeAll(async () => {
    const moduleRef: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
    prisma = app.get(PrismaService);
    jwt = app.get(JwtService);

    ceo = await makeStaff('ceo');
    managerA = await makeStaff('manager', { reportsToId: ceo.id });
    managerB = await makeStaff('manager', { reportsToId: ceo.id });
    leadA = await makeStaff('team_lead', { reportsToId: managerA.id });
    leadB = await makeStaff('team_lead', { reportsToId: managerB.id });
    agentA = await makeStaff('call_agent', { reportsToId: leadA.id, teamLeadId: leadA.id });
    agentB = await makeStaff('call_agent', { reportsToId: leadB.id, teamLeadId: leadB.id });
    finance = await makeStaff('finance', { reportsToId: ceo.id });
  }, 120000);

  afterAll(async () => {
    if (!prisma) return;
    await prisma.target.deleteMany({ where: { id: { in: targetIds } } });
    await prisma.payment.deleteMany({ where: { id: { in: paymentIds } } });
    await prisma.jobSeeker.deleteMany({ where: { id: { in: seekerIds } } });
    await prisma.staffDevice.deleteMany({ where: { staffId: { in: staffIds } } });
    await prisma.staffSession.deleteMany({ where: { staffId: { in: staffIds } } });
    await prisma.statusHistory.deleteMany({ where: { subjectId: { in: staffIds } } });
    await prisma.auditLog.deleteMany({ where: { actorId: { in: staffIds } } });
    await prisma.staff.updateMany({
      where: { id: { in: staffIds } },
      data: { reportsToId: null, teamLeadId: null },
    });
    await prisma.staff.deleteMany({ where: { id: { in: staffIds } } });
    await app.close();
  });

  async function makeSeeker() {
    counter += 1;
    const phone = `+9198${stamp.slice(-6)}${String(counter).padStart(2, '0')}`;
    const seeker = await prisma.jobSeeker.create({
      data: {
        code: `JS-W1-${stamp}-${counter}`,
        name: 'W1 Candidate',
        phone,
        minSalary: 1500000,
        maxSalary: 2000000,
        preferredCallWindowStart: '10:00',
        preferredCallWindowEnd: '18:00',
        status: 'active',
        registeredByStaffId: agentA.id,
      },
    });
    seekerIds.push(seeker.id);
    return seeker;
  }

  describe('1. Managers see no money', () => {
    it('refuses a Manager every money-only endpoint and still serves the CEO and Finance', async () => {
      const seeker = await makeSeeker();
      const payment = await prisma.payment.create({
        data: {
          code: `PAY-W1-${stamp}`,
          type: 'activation',
          status: 'succeeded',
          amount: 49900,
          subjectType: 'job_seeker',
          subjectId: seeker.id,
          jobSeekerId: seeker.id,
        },
      });
      paymentIds.push(payment.id);
      const mgr = tokenFor(managerA);
      for (const path of [
        '/payments',
        `/payments/${payment.id}`,
        '/refunds/due',
        '/pricing',
        '/pricing/approval-limits',
        '/payments/refunds/with-ceo',
        '/payments/tds-receivables',
        `/payments/${payment.id}/receipt`,
        `/placements/${payment.id}/invoice`,
      ]) {
        const res = await request(server()).get(path).set('Authorization', `Bearer ${mgr}`);
        expect({ path, status: res.status }).toEqual({ path, status: 403 });
      }

      const ceoPricing = await request(server())
        .get('/pricing')
        .set('Authorization', `Bearer ${tokenFor(ceo)}`)
        .expect(200);
      expect(typeof ceoPricing.body.activationFeePaise).toBe('number');

      const financePayment = await request(server())
        .get(`/payments/${payment.id}`)
        .set('Authorization', `Bearer ${tokenFor(finance)}`)
        .expect(200);
      expect(financePayment.body.amount).toBe(49900);
    });

    it('strips every money field from the answers a Manager may read', async () => {
      const seeker = await makeSeeker();
      const mgrSeeker = await request(server())
        .get(`/job-seekers/${seeker.id}`)
        .set('Authorization', `Bearer ${tokenFor(managerA)}`)
        .expect(200);
      expect(mgrSeeker.body.code).toBe(seeker.code);
      expect(moneyKeysIn(mgrSeeker.body)).toEqual([]);

      const mgrRisk = await request(server())
        .get('/targets/money-at-risk')
        .set('Authorization', `Bearer ${tokenFor(managerA)}`)
        .expect(200);
      expect(typeof mgrRisk.body.candidatesCount).toBe('number');
      expect(typeof mgrRisk.body.placementsCount).toBe('number');
      expect(moneyKeysIn(mgrRisk.body)).toEqual([]);

      const ceoRisk = await request(server())
        .get('/targets/money-at-risk')
        .set('Authorization', `Bearer ${tokenFor(ceo)}`)
        .expect(200);
      expect(typeof ceoRisk.body.totalAtRiskPaise).toBe('number');

      const ceoSeeker = await request(server())
        .get(`/job-seekers/${seeker.id}`)
        .set('Authorization', `Bearer ${tokenFor(ceo)}`)
        .expect(200);
      expect(ceoSeeker.body.minSalary).toBe(1500000);
    });

    it('leaves the salary and fee columns out of a Manager export', async () => {
      const mgrCsv = await request(server())
        .get('/placements/export')
        .set('Authorization', `Bearer ${tokenFor(managerA)}`)
        .expect(200);
      const header = mgrCsv.text.split('\n')[0];
      expect(header).toContain('Placement Code');
      expect(header).not.toContain('Salary');
      expect(header).not.toContain('Fee');

      const ceoCsv = await request(server())
        .get('/placements/export')
        .set('Authorization', `Bearer ${tokenFor(ceo)}`)
        .expect(200);
      expect(ceoCsv.text.split('\n')[0]).toContain('Placement Fee (INR)');
    });
  });

  describe('2. Full phone numbers are for the CEO only, and every CEO view is logged', () => {
    it('masks numbers for a Manager and writes no view row', async () => {
      const seeker = await makeSeeker();
      const res = await request(server())
        .get(`/job-seekers/${seeker.id}`)
        .set('Authorization', `Bearer ${tokenFor(managerA)}`)
        .expect(200);
      expect(res.body.phone).toBe(`******${seeker.phone.slice(-4)}`);
      expect(JSON.stringify(res.body)).not.toContain(seeker.phone.replace('+', ''));
      const rows = await prisma.auditLog.count({
        where: { actorId: managerA.id, action: FULL_PHONE_VIEW_ACTION },
      });
      expect(rows).toBe(0);
    });

    it('shows the CEO the full number and writes exactly one audit row naming the record', async () => {
      const seeker = await makeSeeker();
      const before = await prisma.auditLog.count({
        where: { actorId: ceo.id, action: FULL_PHONE_VIEW_ACTION },
      });
      const res = await request(server())
        .get(`/job-seekers/${seeker.id}`)
        .set('Authorization', `Bearer ${tokenFor(ceo)}`)
        .expect(200);
      expect(res.body.phone).toBe(seeker.phone);

      const rows = await prisma.auditLog.findMany({
        where: { actorId: ceo.id, action: FULL_PHONE_VIEW_ACTION },
        orderBy: { createdAt: 'desc' },
      });
      expect(rows.length).toBe(before + 1);
      const row = rows[0];
      expect(row.entityType).toBe(FULL_PHONE_VIEW_ENTITY);
      const after = row.after as { route: string; records: { id?: string; code?: string }[] };
      expect(after.route).toBe('/job-seekers/:id');
      expect(after.records).toEqual(
        expect.arrayContaining([expect.objectContaining({ id: seeker.id, code: seeker.code })]),
      );
      expect(JSON.stringify(row)).not.toContain(seeker.phone.replace('+', ''));
    });
  });

  describe('3. Audit log follows the reporting tree', () => {
    it('shows the CEO everything, a Manager only their tree, a Team Lead only their team', async () => {
      // One action inside Manager A's tree, one inside Manager B's.
      await request(server())
        .post(`/staff/${agentA.id}/lock`)
        .set('Authorization', `Bearer ${tokenFor(ceo)}`)
        .send({ reason: 'W1 audit scope check A' })
        .expect(200);
      await request(server())
        .post(`/staff/${agentB.id}/lock`)
        .set('Authorization', `Bearer ${tokenFor(ceo)}`)
        .send({ reason: 'W1 audit scope check B' })
        .expect(200);

      const codesFor = async (staff: StaffRow) => {
        const res = await request(server())
          .get('/audit-logs?entityType=staff')
          .set('Authorization', `Bearer ${tokenFor(staff)}`)
          .expect(200);
        return res.body as { id: string; entityCode: string; actorId: string }[];
      };

      const ceoRows = await codesFor(ceo);
      expect(ceoRows.some((r) => r.entityCode === agentA.code)).toBe(true);
      expect(ceoRows.some((r) => r.entityCode === agentB.code)).toBe(true);

      const managerRows = await codesFor(managerA);
      expect(managerRows.some((r) => r.entityCode === agentA.code)).toBe(true);
      expect(managerRows.some((r) => r.entityCode === agentB.code)).toBe(false);
      const allowedCodes = new Set([managerA.code, leadA.code, agentA.code]);
      const allowedActors = new Set([managerA.id, leadA.id, agentA.id]);
      for (const row of managerRows) {
        expect(allowedCodes.has(row.entityCode) || allowedActors.has(row.actorId)).toBe(true);
      }

      const leadRows = await codesFor(leadB);
      expect(leadRows.some((r) => r.entityCode === agentB.code)).toBe(true);
      expect(leadRows.some((r) => r.entityCode === agentA.code)).toBe(false);

      const outOfTree = ceoRows.find((r) => r.entityCode === agentB.code)!;
      await request(server())
        .get(`/audit-logs/${outOfTree.id}`)
        .set('Authorization', `Bearer ${tokenFor(managerA)}`)
        .expect(404);
      const inTree = ceoRows.find((r) => r.entityCode === agentA.code)!;
      await request(server())
        .get(`/audit-logs/${inTree.id}`)
        .set('Authorization', `Bearer ${tokenFor(managerA)}`)
        .expect(200);

      // A Manager never sees the CEO's own phone-view rows.
      const views = await request(server())
        .get(`/audit-logs?entityType=${FULL_PHONE_VIEW_ENTITY}`)
        .set('Authorization', `Bearer ${tokenFor(managerA)}`)
        .expect(200);
      expect(views.body.filter((r: { actorId: string }) => r.actorId === ceo.id)).toEqual([]);

      await prisma.staff.updateMany({
        where: { id: { in: [agentA.id, agentB.id] } },
        data: { lockedByStaffId: null, lockedReason: null },
      });
    });
  });

  describe('4. A Manager acts only inside their own tree', () => {
    it('refuses to create CEO, Manager or Finance accounts', async () => {
      for (const role of ['ceo', 'manager', 'finance']) {
        const res = await request(server())
          .post('/staff')
          .set('Authorization', `Bearer ${tokenFor(managerA)}`)
          .send({
            name: `W1 refused ${role}`,
            email: `w1-refused-${role}-${stamp}@laboura.local`,
            role,
            reportsToId: ceo.id,
          });
        expect({ role, status: res.status }).toEqual({ role, status: 403 });
      }
    });

    it('creates people only under themself or their own Team Leads', async () => {
      const ownLead = await request(server())
        .post('/staff')
        .set('Authorization', `Bearer ${tokenFor(managerA)}`)
        .send({ name: 'W1 new lead', role: 'team_lead', reportsToId: managerA.id });
      expect(ownLead.status).toBe(201);
      staffIds.push(ownLead.body.staff.id);

      const ownAgent = await request(server())
        .post('/staff')
        .set('Authorization', `Bearer ${tokenFor(managerA)}`)
        .send({ name: 'W1 new agent', role: 'field_agent', teamLeadId: leadA.id });
      expect(ownAgent.status).toBe(201);
      staffIds.push(ownAgent.body.staff.id);

      const otherLead = await request(server())
        .post('/staff')
        .set('Authorization', `Bearer ${tokenFor(managerA)}`)
        .send({ name: 'W1 foreign lead', role: 'team_lead', reportsToId: managerB.id });
      expect(otherLead.status).toBe(403);

      const otherAgent = await request(server())
        .post('/staff')
        .set('Authorization', `Bearer ${tokenFor(managerA)}`)
        .send({ name: 'W1 foreign agent', role: 'call_agent', teamLeadId: leadB.id });
      expect(otherAgent.status).toBe(403);
    });

    it('locks, unlocks, re-issues, deactivates and reactivates only inside the tree', async () => {
      const mgr = tokenFor(managerA);
      const outside = [agentB, leadB, finance, managerB];
      for (const person of outside) {
        await request(server())
          .post(`/staff/${person.id}/lock`)
          .set('Authorization', `Bearer ${mgr}`)
          .send({ reason: 'W1 outside' })
          .expect(403);
        await request(server())
          .post(`/staff/${person.id}/unlock`)
          .set('Authorization', `Bearer ${mgr}`)
          .expect(403);
        await request(server())
          .post(`/staff/${person.id}/deactivate`)
          .set('Authorization', `Bearer ${mgr}`)
          .expect(403);
      }

      // Re-issue is rate limited per route, so it is checked on two outsiders only.
      for (const person of [agentB, finance]) {
        await request(server())
          .post(`/staff/${person.id}/reissue-invite`)
          .set('Authorization', `Bearer ${mgr}`)
          .expect(403);
      }

      const inside = await makeStaff('call_agent', { reportsToId: leadA.id, teamLeadId: leadA.id });
      await request(server())
        .post(`/staff/${inside.id}/lock`)
        .set('Authorization', `Bearer ${mgr}`)
        .send({ reason: 'W1 inside' })
        .expect(200);
      await request(server())
        .post(`/staff/${inside.id}/unlock`)
        .set('Authorization', `Bearer ${mgr}`)
        .expect(200);
      await request(server())
        .post(`/staff/${inside.id}/reissue-invite`)
        .set('Authorization', `Bearer ${mgr}`)
        .expect(200);
      await request(server())
        .post(`/staff/${inside.id}/deactivate`)
        .set('Authorization', `Bearer ${mgr}`)
        .expect(200);
      await request(server())
        .post(`/staff/${inside.id}/reactivate`)
        .set('Authorization', `Bearer ${mgr}`)
        .expect(200);
    });

    it('sets and changes targets only for people in the tree', async () => {
      const now = new Date();
      const year = now.getUTCFullYear() + 1;
      const refused = await request(server())
        .post('/targets')
        .set('Authorization', `Bearer ${tokenFor(managerA)}`)
        .send({ staffId: agentB.id, year, month: 1, candidatesActivated: 10 });
      expect(refused.status).toBe(403);

      const created = await request(server())
        .post('/targets')
        .set('Authorization', `Bearer ${tokenFor(managerA)}`)
        .send({ staffId: agentA.id, year, month: 1, candidatesActivated: 10 });
      expect(created.status).toBe(201);
      targetIds.push(created.body.id);

      const foreign = await request(server())
        .post('/targets')
        .set('Authorization', `Bearer ${tokenFor(managerB)}`)
        .send({ staffId: agentB.id, year, month: 1, candidatesActivated: 12 });
      expect(foreign.status).toBe(201);
      targetIds.push(foreign.body.id);

      await request(server())
        .patch(`/targets/${foreign.body.id}`)
        .set('Authorization', `Bearer ${tokenFor(managerA)}`)
        .send({ candidatesActivated: 1 })
        .expect(403);
      await request(server())
        .patch(`/targets/${created.body.id}`)
        .set('Authorization', `Bearer ${tokenFor(managerA)}`)
        .send({ candidatesActivated: 11 })
        .expect(200);
    });
  });

  describe('6. Payment receipts need a login with the right role or the payer token', () => {
    it('opens only for the signed link, the CEO or Finance', async () => {
      const seeker = await makeSeeker();
      const payment = await prisma.payment.create({
        data: {
          code: `PAY-W1R-${stamp}`,
          type: 'activation',
          status: 'succeeded',
          amount: 49900,
          subjectType: 'job_seeker',
          subjectId: seeker.id,
          jobSeekerId: seeker.id,
        },
      });
      paymentIds.push(payment.id);
      const path = `/payments/${payment.id}/receipt`;

      await request(server()).get(path).expect(401);
      await request(server()).get(`${path}?token=not-the-token`).expect(401);
      await request(server())
        .get(`${path}?token=${receiptToken('some-other-payment')}`)
        .expect(401);

      const payer = await request(server())
        .get(`${path}?token=${receiptToken(payment.id)}`)
        .expect(200);
      expect(payer.body.paymentId).toBe(payment.id);
      expect(payer.body.amountPaise).toBe(49900);

      for (const staff of [ceo, finance]) {
        const res = await request(server())
          .get(path)
          .set('Authorization', `Bearer ${tokenFor(staff)}`)
          .expect(200);
        expect(res.body.paymentId).toBe(payment.id);
      }
      for (const staff of [managerA, leadA, agentA]) {
        await request(server())
          .get(path)
          .set('Authorization', `Bearer ${tokenFor(staff)}`)
          .expect(403);
      }
    });
  });

  describe('7. Edit check and system status', () => {
    it('lets only editing roles ask the edit check, about record types they may write', async () => {
      const seeker = await makeSeeker();
      const query = `/edit-policy/check?entityType=job_seeker&id=${seeker.id}`;
      await request(server())
        .get(query)
        .set('Authorization', `Bearer ${tokenFor(finance)}`)
        .expect(403);
      await request(server())
        .get('/edit-policy/check?entityType=staff&id=x')
        .set('Authorization', `Bearer ${tokenFor(managerA)}`)
        .expect(400);
      await request(server())
        .get(`/edit-policy/check?entityType=placement&id=${seeker.id}`)
        .set('Authorization', `Bearer ${tokenFor(agentA)}`)
        .expect(404);
      const ok = await request(server())
        .get(query)
        .set('Authorization', `Bearer ${tokenFor(agentA)}`)
        .expect(200);
      expect(typeof ok.body.allowed).toBe('boolean');
      await request(server()).get(query).expect(401);
    });

    it('answers the public with up or down only, and the CEO with the details', async () => {
      const open = await request(server()).get('/system/status').expect(200);
      expect(open.body).toEqual({ status: expect.stringMatching(/^(up|down)$/) });
      const alias = await request(server()).get('/status').expect(200);
      expect(Object.keys(alias.body)).toEqual(['status']);

      await request(server()).get('/system/status/details').expect(401);
      await request(server())
        .get('/system/status/details')
        .set('Authorization', `Bearer ${tokenFor(managerA)}`)
        .expect(403);
      const details = await request(server())
        .get('/system/status/details')
        .set('Authorization', `Bearer ${tokenFor(ceo)}`)
        .expect(200);
      expect(Array.isArray(details.body.components)).toBe(true);
    });
  });
});
