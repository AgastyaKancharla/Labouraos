import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcrypt';
import * as request from 'supertest';
import { AppModule } from '../../app.module';
import { PrismaService } from '../../common/prisma/prisma.service';

/**
 * The CEO portal's read endpoints against a real database: the CEO gets every
 * screen's numbers, nobody else gets any of them (Managers see no money and
 * use their own portal), and the close-to-a-refund list and "Remind the agent"
 * work on real rows.
 */
describe('CEO portal endpoints', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let jwt: JwtService;
  const stamp = `${Date.now()}`;
  const staffIds: string[] = [];
  const seekerIds: string[] = [];
  const paymentIds: string[] = [];
  let counter = 0;
  type StaffRow = Awaited<ReturnType<PrismaService['staff']['create']>>;
  let ceo: StaffRow;
  let agent: StaffRow;
  const tokens: Record<string, string> = {};

  async function makeStaff(role: string): Promise<StaffRow> {
    counter += 1;
    const staff = await prisma.staff.create({
      data: {
        code: `W3C-${role.slice(0, 3).toUpperCase()}-${stamp}-${counter}`,
        name: `W3C ${role} ${counter}`,
        email: `w3c-${role}-${stamp}-${counter}@laboura.local`,
        passwordHash: await bcrypt.hash('W3C-Password-1', 4),
        role,
        city: 'Bengaluru',
        status: 'active',
        reportsToId: role === 'ceo' ? null : (ceo?.id ?? null),
      },
    });
    staffIds.push(staff.id);
    tokens[role] = jwt.sign({ sub: staff.id, email: staff.email, role: staff.role, code: staff.code, teamLeadId: null });
    return staff;
  }

  const server = () => app.getHttpServer();

  beforeAll(async () => {
    const moduleRef: TestingModule = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
    prisma = app.get(PrismaService);
    jwt = app.get(JwtService);
    ceo = await makeStaff('ceo');
    await makeStaff('manager');
    await makeStaff('finance');
    await makeStaff('team_lead');
    agent = await makeStaff('call_agent');
  }, 120000);

  afterAll(async () => {
    if (!prisma) return;
    await prisma.followUpTask.deleteMany({ where: { subjectId: { in: seekerIds } } });
    await prisma.payment.deleteMany({ where: { id: { in: paymentIds } } });
    await prisma.jobSeeker.deleteMany({ where: { id: { in: seekerIds } } });
    await prisma.staffSession.deleteMany({ where: { staffId: { in: staffIds } } });
    await prisma.auditLog.deleteMany({ where: { actorId: { in: staffIds } } });
    await prisma.staff.updateMany({ where: { id: { in: staffIds } }, data: { reportsToId: null, teamLeadId: null } });
    await prisma.staff.deleteMany({ where: { id: { in: staffIds } } });
    await app.close();
  });

  async function makePaidSeeker(daysAgo: number) {
    counter += 1;
    const paidAt = new Date(Date.now() - daysAgo * 24 * 3600 * 1000);
    const seeker = await prisma.jobSeeker.create({
      data: {
        code: `JS-W3C-${stamp}-${counter}`,
        name: `W3C Seeker ${counter}`,
        phone: `+9197${stamp.slice(-6)}${String(counter).padStart(2, '0')}`,
        phoneVerified: true,
        minSalary: 1500000,
        maxSalary: 2000000,
        preferredCallWindowStart: '10:00',
        preferredCallWindowEnd: '18:00',
        status: 'active',
        paymentReceivedAt: paidAt,
        registeredByStaffId: agent.id,
      },
    });
    seekerIds.push(seeker.id);
    const payment = await prisma.payment.create({
      data: {
        code: `PAY-W3C-${stamp}-${counter}`,
        type: 'activation',
        status: 'succeeded',
        amount: 49900,
        subjectType: 'job_seeker',
        subjectId: seeker.id,
        jobSeekerId: seeker.id,
        confirmedAt: paidAt,
        paidAt,
      },
    });
    paymentIds.push(payment.id);
    return seeker;
  }

  const GET_ROUTES = [
    '/ceo/command-center/money',
    '/ceo/command-center/pipeline',
    '/ceo/command-center/verticals',
    '/ceo/command-center/insights',
    '/ceo/reports',
    '/ceo/job-seekers',
    '/ceo/near-refund',
    '/ceo/businesses',
    '/ceo/businesses/waiting',
    '/ceo/introductions',
    '/ceo/vacancies',
    '/ceo/interviews',
    '/ceo/placements',
    '/ceo/claims',
    '/ceo/referrals',
    '/ceo/payments/in',
    '/ceo/payments/out',
    '/ceo/payments/gst',
    '/ceo/refunds',
  ];

  it('serves every CEO screen to the CEO', async () => {
    await makePaidSeeker(1);
    for (const path of GET_ROUTES) {
      const res = await request(server()).get(path).set('Authorization', `Bearer ${tokens.ceo}`);
      expect({ path, status: res.status }).toEqual({ path, status: 200 });
    }
  }, 120000);

  it('refuses Managers, Finance, Team Leads and agents', async () => {
    for (const role of ['manager', 'finance', 'team_lead', 'call_agent']) {
      for (const path of ['/ceo/command-center/money', '/ceo/job-seekers', '/ceo/refunds', '/ceo/payments/in']) {
        const res = await request(server()).get(path).set('Authorization', `Bearer ${tokens[role]}`);
        expect({ role, path, status: res.status }).toEqual({ role, path, status: 403 });
      }
      const remind = await request(server()).post('/ceo/near-refund/remind').set('Authorization', `Bearer ${tokens[role]}`).send({ kind: 'job_seeker', id: 'x' });
      expect(remind.status).toBe(403);
    }
    const anonymous = await request(server()).get('/ceo/job-seekers');
    expect(anonymous.status).toBe(401);
  });

  it('lists a job seeker 20 days into his 30-day guarantee as close to a refund, and reminds his agent once', async () => {
    const seeker = await makePaidSeeker(20);
    const list = await request(server()).get('/ceo/near-refund').set('Authorization', `Bearer ${tokens.ceo}`).expect(200);
    const row = list.body.rows.find((r: { id: string }) => r.id === seeker.id);
    expect(row).toMatchObject({ kind: 'job_seeker', daysLeft: 10, bucket: '6-10', atStakePaise: 49900 });
    expect(row.agent.id).toBe(agent.id);

    const first = await request(server()).post('/ceo/near-refund/remind').set('Authorization', `Bearer ${tokens.ceo}`).send({ kind: 'job_seeker', id: seeker.id });
    expect(first.status).toBe(201);
    expect(first.body.created).toBe(true);
    expect(first.body.task).toMatchObject({ kind: 'refund_priority_call', assignedStaffId: agent.id, subjectId: seeker.id });
    const again = await request(server()).post('/ceo/near-refund/remind').set('Authorization', `Bearer ${tokens.ceo}`).send({ kind: 'job_seeker', id: seeker.id });
    expect(again.body.created).toBe(false);
    expect(await prisma.followUpTask.count({ where: { subjectId: seeker.id, kind: 'refund_priority_call' } })).toBe(1);
  });

  it('opens the job seeker page with full phone for the CEO, and 404 for an unknown id', async () => {
    const seeker = await makePaidSeeker(3);
    const res = await request(server()).get(`/ceo/job-seekers/${seeker.id}`).set('Authorization', `Bearer ${tokens.ceo}`).expect(200);
    expect(res.body).toMatchObject({ code: seeker.code, phone: seeker.phone, guarantee: { daysLeft: 27 } });
    expect(res.body.activation.amountPaise).toBe(49900);
    await request(server()).get('/ceo/job-seekers/does-not-exist').set('Authorization', `Bearer ${tokens.ceo}`).expect(404);
  });

  it('counts a ₹499 confirmed in the period in the money row and the job seeker list search', async () => {
    const seeker = await makePaidSeeker(0);
    const from = new Date(Date.now() - 60 * 1000).toISOString();
    const to = new Date(Date.now() + 60 * 1000).toISOString();
    const money = await request(server()).get('/ceo/command-center/money').query({ fromDate: from, toDate: to }).set('Authorization', `Bearer ${tokens.ceo}`).expect(200);
    expect(money.body.activationPaise).toBeGreaterThanOrEqual(49900);
    expect(Number.isInteger(money.body.netPaise)).toBe(true);
    const list = await request(server()).get('/ceo/job-seekers').query({ search: seeker.code }).set('Authorization', `Bearer ${tokens.ceo}`).expect(200);
    expect(list.body.total).toBe(1);
    expect(list.body.rows[0]).toMatchObject({ id: seeker.id, guaranteeDaysLeft: 30, kyc: 'none' });
  });
});
