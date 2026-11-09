import { randomUUID } from 'crypto';
import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcrypt';
import * as request from 'supertest';
import { AppModule } from '../../app.module';
import { PrismaService } from '../../common/prisma/prisma.service';

describe('Phase 12 Task 3 — JobSeekerTrade and JobSeekerLanguage', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let jwt: JwtService;

  let agentToken: string;
  let fieldAgentToken: string;
  let financeToken: string;

  const createdStaffIds: string[] = [];
  const createdSeekerIds: string[] = [];

  beforeAll(async () => {
    const moduleRef: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleRef.createNestApplication();
    await app.init();

    prisma = app.get(PrismaService);
    jwt = app.get(JwtService);

    const passwordHash = await bcrypt.hash('StaffPassword123!', 4);

    const randomSuffix1 = randomUUID().replace(/-/g, '').slice(0, 6).toUpperCase();
    const ca = await prisma.staff.create({
      data: {
        code: `CA-T3-${randomSuffix1}`,
        name: 'Task 3 Call Agent',
        email: `ca_t3_${randomSuffix1}@laboura.local`,
        passwordHash,
        role: 'call_agent',
        status: 'active',
      },
    });
    createdStaffIds.push(ca.id);
    agentToken = jwt.sign({ sub: ca.id, role: ca.role, code: ca.code, email: ca.email });

    const randomSuffix2 = randomUUID().replace(/-/g, '').slice(0, 6).toUpperCase();
    const fa = await prisma.staff.create({
      data: {
        code: `FA-T3-${randomSuffix2}`,
        name: 'Task 3 Field Agent',
        email: `fa_t3_${randomSuffix2}@laboura.local`,
        passwordHash,
        role: 'field_agent',
        status: 'active',
      },
    });
    createdStaffIds.push(fa.id);
    fieldAgentToken = jwt.sign({ sub: fa.id, role: fa.role, code: fa.code, email: fa.email });

    const randomSuffix3 = randomUUID().replace(/-/g, '').slice(0, 6).toUpperCase();
    const fin = await prisma.staff.create({
      data: {
        code: `FN-T3-${randomSuffix3}`,
        name: 'Task 3 Finance',
        email: `fn_t3_${randomSuffix3}@laboura.local`,
        passwordHash,
        role: 'finance',
        status: 'active',
      },
    });
    createdStaffIds.push(fin.id);
    financeToken = jwt.sign({ sub: fin.id, role: fin.role, code: fin.code, email: fin.email });
  });

  afterAll(async () => {
    if (createdSeekerIds.length > 0) {
      await prisma.jobSeekerTrade.deleteMany({ where: { jobSeekerId: { in: createdSeekerIds } } });
      await prisma.jobSeekerLanguage.deleteMany({ where: { jobSeekerId: { in: createdSeekerIds } } });
      await prisma.jobSeeker.deleteMany({ where: { id: { in: createdSeekerIds } } });
    }
    if (createdStaffIds.length > 0) {
      await prisma.staff.deleteMany({ where: { id: { in: createdStaffIds } } });
    }
    await app.close();
  });

  async function createCandidate(): Promise<string> {
    const randomSuffix = randomUUID().replace(/-/g, '').slice(0, 8).toUpperCase();
    const phoneSuffix = Math.floor(10000000 + Math.random() * 90000000);
    const seeker = await prisma.jobSeeker.create({
      data: {
        code: `JS-T3-${randomSuffix}`,
        name: `Candidate ${randomSuffix}`,
        phone: `+9193${phoneSuffix}`,
        trades: { create: { trade: 'Electrician', isPrimary: true } },
        minSalary: 1500000,
        maxSalary: 2500000,
        preferredCallWindowStart: '09:00',
        preferredCallWindowEnd: '18:00',
        status: 'lead',
      },
    });
    createdSeekerIds.push(seeker.id);
    return seeker.id;
  }

  describe('JobSeekerTrade', () => {
    it('creates first trade and automatically assigns isPrimary = true', async () => {
      const candidateId = await createCandidate();

      const res = await request(app.getHttpServer())
        .post(`/job-seekers/${candidateId}/trades`)
        .set('Authorization', `Bearer ${agentToken}`)
        .send({ trade: 'Electrician', yearsExperience: 3 });

      expect(res.status).toBe(201);
      expect(res.body.trade).toBe('Electrician');
      expect(res.body.yearsExperience).toBe(3);
      expect(res.body.isPrimary).toBe(true);

      const trades = await prisma.jobSeekerTrade.findMany({ where: { jobSeekerId: candidateId } });
      expect(trades).toHaveLength(1);
      expect(trades[0].isPrimary).toBe(true);
    });

    it('setting a new trade as isPrimary un-sets the old primary trade', async () => {
      const candidateId = await createCandidate();

      // First trade
      const t1 = await request(app.getHttpServer())
        .post(`/job-seekers/${candidateId}/trades`)
        .set('Authorization', `Bearer ${agentToken}`)
        .send({ trade: 'Electrician', yearsExperience: 2 });
      expect(t1.body.isPrimary).toBe(true);

      // Second trade with isPrimary = true
      const t2 = await request(app.getHttpServer())
        .post(`/job-seekers/${candidateId}/trades`)
        .set('Authorization', `Bearer ${agentToken}`)
        .send({ trade: 'Plumber', yearsExperience: 4, isPrimary: true });
      expect(t2.body.isPrimary).toBe(true);

      // Verify old primary trade is un-set
      const trades = await prisma.jobSeekerTrade.findMany({
        where: { jobSeekerId: candidateId },
        orderBy: { createdAt: 'asc' },
      });
      expect(trades).toHaveLength(2);
      expect(trades.find((t) => t.id === t1.body.id)?.isPrimary).toBe(false);
      expect(trades.find((t) => t.id === t2.body.id)?.isPrimary).toBe(true);
    });

    it('changing primary trade via PATCH un-sets the old primary', async () => {
      const candidateId = await createCandidate();

      const t1 = await request(app.getHttpServer())
        .post(`/job-seekers/${candidateId}/trades`)
        .set('Authorization', `Bearer ${agentToken}`)
        .send({ trade: 'Welder', yearsExperience: 1 });

      const t2 = await request(app.getHttpServer())
        .post(`/job-seekers/${candidateId}/trades`)
        .set('Authorization', `Bearer ${agentToken}`)
        .send({ trade: 'Carpenter', yearsExperience: 3, isPrimary: false });

      // Change t2 to primary
      const patchRes = await request(app.getHttpServer())
        .patch(`/job-seekers/${candidateId}/trades/${t2.body.id}`)
        .set('Authorization', `Bearer ${agentToken}`)
        .send({ isPrimary: true });
      expect(patchRes.status).toBe(200);
      expect(patchRes.body.isPrimary).toBe(true);

      const trades = await prisma.jobSeekerTrade.findMany({ where: { jobSeekerId: candidateId } });
      const trade1 = trades.find((t) => t.id === t1.body.id);
      const trade2 = trades.find((t) => t.id === t2.body.id);
      expect(trade1?.isPrimary).toBe(false);
      expect(trade2?.isPrimary).toBe(true);
    });

    it('attempting to un-set primary without setting another primary throws BadRequest (exactly one primary)', async () => {
      const candidateId = await createCandidate();

      const t1 = await request(app.getHttpServer())
        .post(`/job-seekers/${candidateId}/trades`)
        .set('Authorization', `Bearer ${agentToken}`)
        .send({ trade: 'Driver', yearsExperience: 5 });

      const patchRes = await request(app.getHttpServer())
        .patch(`/job-seekers/${candidateId}/trades/${t1.body.id}`)
        .set('Authorization', `Bearer ${agentToken}`)
        .send({ isPrimary: false });

      expect(patchRes.status).toBe(400);
      expect(patchRes.body.message).toContain('Exactly one trade must be primary');
    });

    it('a 4th trade is refused with BadRequest', async () => {
      const candidateId = await createCandidate();

      await request(app.getHttpServer())
        .post(`/job-seekers/${candidateId}/trades`)
        .set('Authorization', `Bearer ${agentToken}`)
        .send({ trade: 'Trade 1' });
      await request(app.getHttpServer())
        .post(`/job-seekers/${candidateId}/trades`)
        .set('Authorization', `Bearer ${agentToken}`)
        .send({ trade: 'Trade 2' });
      await request(app.getHttpServer())
        .post(`/job-seekers/${candidateId}/trades`)
        .set('Authorization', `Bearer ${agentToken}`)
        .send({ trade: 'Trade 3' });

      // Attempt 4th trade
      const res4 = await request(app.getHttpServer())
        .post(`/job-seekers/${candidateId}/trades`)
        .set('Authorization', `Bearer ${agentToken}`)
        .send({ trade: 'Trade 4' });

      expect(res4.status).toBe(400);
      expect(res4.body.message).toContain('cannot have more than 3 trades');

      const count = await prisma.jobSeekerTrade.count({ where: { jobSeekerId: candidateId } });
      expect(count).toBe(3);
    });

    it('deleting primary trade promotes one remaining trade to primary', async () => {
      const candidateId = await createCandidate();

      const t1 = await request(app.getHttpServer())
        .post(`/job-seekers/${candidateId}/trades`)
        .set('Authorization', `Bearer ${agentToken}`)
        .send({ trade: 'Primary Trade' });

      const t2 = await request(app.getHttpServer())
        .post(`/job-seekers/${candidateId}/trades`)
        .set('Authorization', `Bearer ${agentToken}`)
        .send({ trade: 'Secondary Trade', isPrimary: false });

      expect(t1.body.isPrimary).toBe(true);
      expect(t2.body.isPrimary).toBe(false);

      const delRes = await request(app.getHttpServer())
        .delete(`/job-seekers/${candidateId}/trades/${t1.body.id}`)
        .set('Authorization', `Bearer ${agentToken}`);
      expect(delRes.status).toBe(200);

      const remaining = await prisma.jobSeekerTrade.findMany({ where: { jobSeekerId: candidateId } });
      expect(remaining).toHaveLength(1);
      expect(remaining[0].id).toBe(t2.body.id);
      expect(remaining[0].isPrimary).toBe(true);
    });
  });

  describe('JobSeekerLanguage', () => {
    it('a language row with all three of speaks/reads/writes false is still valid', async () => {
      const candidateId = await createCandidate();

      const res = await request(app.getHttpServer())
        .post(`/job-seekers/${candidateId}/languages`)
        .set('Authorization', `Bearer ${agentToken}`)
        .send({
          language: 'Kannada',
          speaks: false,
          reads: false,
          writes: false,
        });

      expect(res.status).toBe(201);
      expect(res.body.language).toBe('Kannada');
      expect(res.body.speaks).toBe(false);
      expect(res.body.reads).toBe(false);
      expect(res.body.writes).toBe(false);

      const saved = await prisma.jobSeekerLanguage.findUnique({
        where: { id: res.body.id },
      });
      expect(saved).not.toBeNull();
      expect(saved?.speaks).toBe(false);
      expect(saved?.reads).toBe(false);
      expect(saved?.writes).toBe(false);
    });

    it('supports CRUD operations on languages', async () => {
      const candidateId = await createCandidate();

      // Create
      const createRes = await request(app.getHttpServer())
        .post(`/job-seekers/${candidateId}/languages`)
        .set('Authorization', `Bearer ${agentToken}`)
        .send({ language: 'Hindi', speaks: true, reads: true, writes: false });
      expect(createRes.status).toBe(201);

      // List
      const listRes = await request(app.getHttpServer())
        .get(`/job-seekers/${candidateId}/languages`)
        .set('Authorization', `Bearer ${agentToken}`);
      expect(listRes.status).toBe(200);
      expect(listRes.body).toHaveLength(1);
      expect(listRes.body[0].language).toBe('Hindi');

      // Update
      const updateRes = await request(app.getHttpServer())
        .patch(`/job-seekers/${candidateId}/languages/${createRes.body.id}`)
        .set('Authorization', `Bearer ${agentToken}`)
        .send({ writes: true });
      expect(updateRes.status).toBe(200);
      expect(updateRes.body.writes).toBe(true);

      // Delete
      const deleteRes = await request(app.getHttpServer())
        .delete(`/job-seekers/${candidateId}/languages/${createRes.body.id}`)
        .set('Authorization', `Bearer ${agentToken}`);
      expect(deleteRes.status).toBe(200);

      const count = await prisma.jobSeekerLanguage.count({ where: { jobSeekerId: candidateId } });
      expect(count).toBe(0);
    });
  });

  describe('RBAC & Role Scoping', () => {
    it('Field Agent can manage trades and languages', async () => {
      const candidateId = await createCandidate();

      const tradeRes = await request(app.getHttpServer())
        .post(`/job-seekers/${candidateId}/trades`)
        .set('Authorization', `Bearer ${fieldAgentToken}`)
        .send({ trade: 'Mason', yearsExperience: 2 });
      expect(tradeRes.status).toBe(201);

      const langRes = await request(app.getHttpServer())
        .post(`/job-seekers/${candidateId}/languages`)
        .set('Authorization', `Bearer ${fieldAgentToken}`)
        .send({ language: 'Tamil', speaks: true });
      expect(langRes.status).toBe(201);
    });

    it('Finance is strictly denied (403) write endpoints, but allowed read', async () => {
      const candidateId = await createCandidate();

      // Finance write denied
      const writeTrade = await request(app.getHttpServer())
        .post(`/job-seekers/${candidateId}/trades`)
        .set('Authorization', `Bearer ${financeToken}`)
        .send({ trade: 'Painter' });
      expect(writeTrade.status).toBe(403);

      const writeLang = await request(app.getHttpServer())
        .post(`/job-seekers/${candidateId}/languages`)
        .set('Authorization', `Bearer ${financeToken}`)
        .send({ language: 'English' });
      expect(writeLang.status).toBe(403);

      // Finance read allowed
      const readTrades = await request(app.getHttpServer())
        .get(`/job-seekers/${candidateId}/trades`)
        .set('Authorization', `Bearer ${financeToken}`);
      expect(readTrades.status).toBe(200);

      const readLangs = await request(app.getHttpServer())
        .get(`/job-seekers/${candidateId}/languages`)
        .set('Authorization', `Bearer ${financeToken}`);
      expect(readLangs.status).toBe(200);
    });
  });
});
