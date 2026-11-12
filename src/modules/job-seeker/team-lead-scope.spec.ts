import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcrypt';
import * as request from 'supertest';
import { randomUUID } from 'crypto';
import { AppModule } from '../../app.module';
import { PrismaService } from '../../common/prisma/prisma.service';

/** M3: the role table gives a Team Lead the job seekers of their own team only. */
describe('M3: Team Lead scope on job seekers', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let jwt: JwtService;
  const staffIds: string[] = [];
  const seekerIds: string[] = [];
  const tokens: Record<string, string> = {};
  const ids: Record<string, string> = {};

  async function staff(key: string, role: string, teamLeadId?: string) {
    const suffix = randomUUID().replace(/-/g, '').slice(0, 8).toUpperCase();
    const row = await prisma.staff.create({
      data: {
        code: `M3-${key}-${suffix}`,
        name: `M3 ${key}`,
        email: `m3_${key.toLowerCase()}_${suffix}@laboura.local`,
        passwordHash: await bcrypt.hash('M3-Password-123!', 4),
        role,
        status: 'active',
        teamLeadId: teamLeadId ?? null,
      },
    });
    staffIds.push(row.id);
    ids[key] = row.id;
    tokens[key] = jwt.sign({ sub: row.id, role: row.role, code: row.code, email: row.email });
  }

  async function seeker(key: string, registeredByStaffId: string | null) {
    const suffix = randomUUID().replace(/-/g, '').slice(0, 8).toUpperCase();
    const digits = String(Math.floor(Math.random() * 1e8)).padStart(8, '0');
    const row = await prisma.jobSeeker.create({
      data: {
        code: `JS-M3-${suffix}`,
        name: `M3 seeker ${key}`,
        phone: `+9193${digits}`,
        minSalary: 1600000,
        maxSalary: 2600000,
        preferredCallWindowStart: '09:00',
        preferredCallWindowEnd: '18:00',
        status: 'active',
        registeredByStaffId,
      },
    });
    seekerIds.push(row.id);
    ids[key] = row.id;
    return row;
  }

  beforeAll(async () => {
    const moduleRef: TestingModule = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
    prisma = app.get(PrismaService);
    jwt = app.get(JwtService);
    await staff('TLA', 'team_lead');
    await staff('TLB', 'team_lead');
    await staff('CAA', 'call_agent', ids.TLA);
    await staff('CAB', 'call_agent', ids.TLB);
    await seeker('mine', ids.CAA);
    await seeker('ownByLead', ids.TLA);
    await seeker('theirs', ids.CAB);
  });

  afterAll(async () => {
    await prisma.jobSeeker.deleteMany({ where: { id: { in: seekerIds } } });
    await prisma.auditLog.deleteMany({ where: { actorId: { in: staffIds } } });
    await prisma.staff.deleteMany({ where: { id: { in: staffIds } } });
    await app.close();
  });

  const listIds = async (token: string, query = '') => {
    const res = await request(app.getHttpServer()).get(`/job-seekers${query}`).set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    return (res.body as Array<{ id: string }>).map((s) => s.id);
  };

  it('GET /job-seekers gives a Team Lead only their own team\'s job seekers', async () => {
    const seen = await listIds(tokens.TLA);
    expect(seen).toEqual(expect.arrayContaining([ids.mine, ids.ownByLead]));
    expect(seen).not.toContain(ids.theirs);
    const other = await listIds(tokens.TLB);
    expect(other).toContain(ids.theirs);
    expect(other).not.toContain(ids.mine);
  });

  it('a Team Lead cannot open another team\'s job seeker, by id or by code', async () => {
    const theirs = await prisma.jobSeeker.findUniqueOrThrow({ where: { id: ids.theirs } });
    for (const ref of [theirs.id, theirs.code]) {
      const res = await request(app.getHttpServer()).get(`/job-seekers/${ref}`).set('Authorization', `Bearer ${tokens.TLA}`);
      expect(res.status).toBe(403);
    }
    const hits = await request(app.getHttpServer()).get(`/job-seekers/${theirs.id}/hits`).set('Authorization', `Bearer ${tokens.TLA}`);
    expect(hits.status).toBe(403);
  });

  it('a Team Lead still opens their own team\'s job seeker', async () => {
    const res = await request(app.getHttpServer()).get(`/job-seekers/${ids.mine}`).set('Authorization', `Bearer ${tokens.TLA}`);
    expect(res.status).toBe(200);
    expect(res.body.id).toBe(ids.mine);
  });

  it('agents keep their city-wide read (role table), and the list can be paged', async () => {
    const seen = await listIds(tokens.CAA);
    expect(seen).toEqual(expect.arrayContaining([ids.mine, ids.theirs]));
    const page = await listIds(tokens.CAA, '?limit=1&offset=0');
    expect(page).toHaveLength(1);
  });
});
