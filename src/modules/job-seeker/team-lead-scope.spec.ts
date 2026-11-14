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
  const referralIds: string[] = [];

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
    await prisma.jobSeekerHit.deleteMany({ where: { jobSeekerId: { in: seekerIds } } });
    await prisma.referral.deleteMany({ where: { id: { in: referralIds } } });
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

  // Owner rule (Master Guide, 14 Nov): a Team Lead works only on their own
  // team — for every action on a job seeker, not only for reading it.
  const writeRoutes: Array<[string, string]> = [
    ['post', 'activation-payment'],
    ['post', 'resend-payment'],
    ['post', 'identity-verification'],
    ['post', 'identity-verification/provider'],
    ['post', 'payment-only-link'],
    ['post', 'hits'],
    ['post', 'reactivate'],
    ['post', 'found-own-job'],
    ['patch', ''],
    ['patch', 'profile'],
    ['post', 'photo'],
    ['post', 'status'],
    ['post', 'trades'],
    ['patch', 'trades/00000000-0000-0000-0000-000000000000'],
    ['delete', 'trades/00000000-0000-0000-0000-000000000000'],
    ['post', 'languages'],
    ['patch', 'languages/00000000-0000-0000-0000-000000000000'],
    ['delete', 'languages/00000000-0000-0000-0000-000000000000'],
  ];

  const call = (method: string, path: string, token: string) => {
    const server = request(app.getHttpServer()) as unknown as Record<string, (url: string) => request.Test>;
    return server[method](path).set('Authorization', `Bearer ${token}`);
  };

  it.each(writeRoutes)('a Team Lead is refused %s /job-seekers/:id/%s on another team\'s job seeker', async (method, suffix) => {
    const path = `/job-seekers/${ids.theirs}${suffix ? `/${suffix}` : ''}`;
    const res = await call(method, path, tokens.TLA).send({ reason: 'Not my team' });
    expect(res.status).toBe(403);
    expect(String(res.body.message)).toContain('outside your own team');
  });

  it.each(writeRoutes)('a Team Lead is not refused %s /job-seekers/:id/%s on their own team\'s job seeker', async (method, suffix) => {
    const own = await seeker(`own-${method}-${suffix}`, ids.CAA);
    const path = `/job-seekers/${own.id}${suffix ? `/${suffix}` : ''}`;
    const res = await call(method, path, tokens.TLA).send({});
    // The guard lets it through; the route's own rules then answer (often 400
    // for this empty body). It is never the team refusal.
    expect(String(res.body?.message ?? '')).not.toContain('outside your own team');
  });

  it('a Team Lead edits their own team\'s job seeker', async () => {
    const res = await call('patch', `/job-seekers/${ids.mine}`, tokens.TLA).send({ locality: 'Jayanagar' });
    expect(res.status).toBe(200);
    expect(res.body.locality).toBe('Jayanagar');
    const theirs = await prisma.jobSeeker.findUniqueOrThrow({ where: { id: ids.theirs } });
    expect(theirs.locality).toBeNull();
  });

  it('GET /job-seeker-hits/:id is scoped to the Team Lead\'s own team', async () => {
    const theirsHit = await prisma.jobSeekerHit.create({
      data: { jobSeekerId: ids.theirs, reason: 'offer_declined', recordedBy: 'system' },
    });
    const mineHit = await prisma.jobSeekerHit.create({
      data: { jobSeekerId: ids.mine, reason: 'offer_declined', recordedBy: 'system' },
    });
    expect((await call('get', `/job-seeker-hits/${theirsHit.id}`, tokens.TLA)).status).toBe(403);
    const own = await call('get', `/job-seeker-hits/${mineHit.id}`, tokens.TLA);
    expect(own.status).toBe(200);
    expect(own.body.id).toBe(mineHit.id);
    // Agents keep their city-wide read.
    expect((await call('get', `/job-seeker-hits/${theirsHit.id}`, tokens.CAA)).status).toBe(200);
  });

  it('POST /consent/links: a Team Lead is refused another team\'s job seeker', async () => {
    const res = await call('post', '/consent/links', tokens.TLA).send({ jobSeekerId: ids.theirs });
    expect(res.status).toBe(403);
  });

  it('referral partners: a Team Lead cannot act on another team\'s partner (404, as the read answers)', async () => {
    const make = async (key: string, registeredByStaffId: string) => {
      const suffix = randomUUID().replace(/-/g, '').slice(0, 8).toUpperCase();
      const digits = String(Math.floor(Math.random() * 1e8)).padStart(8, '0');
      const row = await prisma.referral.create({
        data: { code: `RF-M3-${key}-${suffix}`, name: `M3 partner ${key}`, phone: `+9192${digits}`, registeredByStaffId },
      });
      referralIds.push(row.id);
      return row;
    };
    const theirs = await make('B', ids.CAB);
    const mine = await make('A', ids.CAA);
    expect((await call('get', `/referrals/${theirs.id}`, tokens.TLA)).status).toBe(404);
    expect((await call('patch', `/referrals/${theirs.id}`, tokens.TLA).send({ name: 'x', reason: 'y' })).status).toBe(404);
    expect((await call('post', `/referrals/${theirs.id}/terms-links`, tokens.TLA).send({})).status).toBe(404);
    expect((await call('get', `/referrals/${theirs.id}/registration-status`, tokens.TLA)).status).toBe(404);
    expect((await call('get', `/referrals/${mine.id}/registration-status`, tokens.TLA)).status).toBe(200);
  });
});
