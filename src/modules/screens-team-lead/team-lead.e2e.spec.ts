import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { JwtService } from '@nestjs/jwt';
import * as request from 'supertest';
import { AppModule } from '../../app.module';
import { PrismaService } from '../../common/prisma/prisma.service';
import { MemoryBusinessPhotoStorage } from '../business/storefront-photo.storage';
import { AttendanceClock } from '../attendance/attendance-clock';

jest.setTimeout(180000);

const shared = { at: new Date('2027-06-09T06:30:00.000Z') };
class FixedClock extends AttendanceClock {
  now(): Date {
    return new Date(shared.at.getTime());
  }
}

type Person = { id: string; role: string; code: string };

describe('Team Lead portal endpoints', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let jwt: JwtService;
  const stamp = `${Date.now()}`;
  const staffIds: string[] = [];
  const cleanup: { calls: string[]; visits: string[]; businesses: string[]; seekers: string[] } = { calls: [], visits: [], businesses: [], seekers: [] };

  let ceo: Person;
  let manager: Person;
  let lead: Person;
  let otherLead: Person;
  let caller: Person;
  let fielder: Person;
  let fielder2: Person;
  let outsider: Person;

  const token = (p: Person) => jwt.sign({ sub: p.id, email: `${p.id}@laboura.local`, role: p.role, code: p.code });
  const get = (p: Person, path: string) => request(app.getHttpServer()).get(path).set('Authorization', `Bearer ${token(p)}`);
  const post = (p: Person, path: string, body: Record<string, unknown> = {}) =>
    request(app.getHttpServer()).post(path).set('Authorization', `Bearer ${token(p)}`).send(body);

  async function make(role: string, prefix: string, reportsToId?: string): Promise<Person> {
    const agent = role === 'call_agent' || role === 'field_agent';
    const row = await prisma.staff.create({
      data: {
        code: `${prefix}-${stamp}-${staffIds.length}`,
        name: `${prefix} Person`,
        email: `${prefix.toLowerCase()}.${staffIds.length}.${stamp}@laboura.local`,
        passwordHash: 'hash',
        role,
        status: 'active',
        teamLeadId: agent ? (reportsToId ?? null) : null,
        reportsToId: reportsToId ?? null,
        teamName: role === 'team_lead' ? `Team ${prefix}` : null,
      },
    });
    staffIds.push(row.id);
    return row;
  }

  async function call(staff: Person, n: number) {
    const row = await prisma.callRecord.create({
      data: {
        code: `CR-TL-${stamp}-${n}`,
        provider: 'mock',
        providerCallId: `tl-${stamp}-${n}`,
        staffId: staff.id,
        providerStatus: 'completed',
        answered: true,
        durationSec: 260,
        recordingStoragePath: `recordings/${stamp}-${n}.mp3`,
        createdAt: shared.at,
        startedAt: shared.at,
      },
    });
    cleanup.calls.push(row.id);
    return row;
  }

  beforeAll(async () => {
    const moduleRef: TestingModule = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(AttendanceClock)
      .useClass(FixedClock)
      .compile();
    app = moduleRef.createNestApplication();
    await app.init();
    prisma = app.get(PrismaService);
    jwt = app.get(JwtService);
    ceo = await make('ceo', 'CEOTL');
    manager = await make('manager', 'MGRTL', ceo.id);
    lead = await make('team_lead', 'TLTL', manager.id);
    otherLead = await make('team_lead', 'TLOT', manager.id);
    caller = await make('call_agent', 'CATL', lead.id);
    fielder = await make('field_agent', 'FATL', lead.id);
    fielder2 = await make('field_agent', 'FBTL', lead.id);
    outsider = await make('call_agent', 'CAOT', otherLead.id);
  });

  afterAll(async () => {
    await prisma.notification.deleteMany({ where: { recipientStaffId: { in: staffIds } } });
    await prisma.callQualityScore.deleteMany({ where: { callRecordId: { in: cleanup.calls } } });
    await prisma.teamLeadCheck.deleteMany({ where: { checkedByStaffId: { in: staffIds } } });
    await prisma.coachingNote.deleteMany({ where: { staffId: { in: staffIds } } });
    await prisma.reviewFlag.deleteMany({ where: { raisedForStaffId: { in: staffIds } } });
    await prisma.callRecord.deleteMany({ where: { id: { in: cleanup.calls } } });
    await prisma.businessVisit.deleteMany({ where: { id: { in: cleanup.visits } } });
    await prisma.business.deleteMany({ where: { id: { in: cleanup.businesses } } });
    await prisma.jobSeeker.deleteMany({ where: { id: { in: cleanup.seekers } } });
    await prisma.staff.updateMany({ where: { id: { in: staffIds } }, data: { reportsToId: null, teamLeadId: null } });
    await prisma.staff.deleteMany({ where: { id: { in: staffIds } } });
    await app.close();
  });

  it('is for Team Leads only', async () => {
    for (const person of [manager, ceo, caller]) {
      expect((await get(person, '/team-lead/team')).status).toBe(403);
    }
  });

  it("shows only the Team Lead's own team on every list", async () => {
    const team = await get(lead, '/team-lead/team');
    expect(team.status).toBe(200);
    expect(team.body.manager.id).toBe(manager.id);
    const ids = (team.body.members as Array<{ id: string }>).map((m) => m.id).sort();
    expect(ids).toEqual([caller.id, fielder.id, fielder2.id].sort());
    for (const path of ['/team-lead/today', '/team-lead/targets', '/team-lead/agents', '/team-lead/attendance', '/team-lead/leave', '/team-lead/reports', '/team-lead/access', '/team-lead/work', '/team-lead/registrations', '/team-lead/visits', '/team-lead/quality']) {
      const res = await get(lead, path);
      expect([path, res.status]).toEqual([path, 200]);
      expect(JSON.stringify(res.body)).not.toContain(outsider.id);
    }
    expect((await get(lead, `/team-lead/agents/${outsider.id}`)).status).toBe(404);
    const agent = await get(lead, `/team-lead/agents/${caller.id}`);
    expect(agent.status).toBe(200);
    expect(agent.body.main.label).toBe('Paid the ₹499 fee');
  });

  it('gives the month in the plain format, with no rupee amounts', async () => {
    const res = await get(lead, '/team-lead/targets');
    expect(res.body.team.map((row: { key: string }) => row.key)).toEqual(['placed', 'paid', 'businesses', 'interviews', 'registered']);
    expect(res.body.dayOfMonth).toBe(9);
    expect(JSON.stringify(res.body)).not.toMatch(/Paise|feePaise|amount/);
  });

  it('saves coaching notes but never a written warning (that goes to the Manager)', async () => {
    const note = await post(lead, `/team-lead/agents/${caller.id}/notes`, { text: 'Practise the 30-day guarantee', kind: 'written_warning' });
    expect(note.status).toBe(201);
    expect(note.body.kind).toBe('note');
    expect((await post(lead, `/team-lead/agents/${outsider.id}/notes`, { text: 'x' })).status).toBe(404);
    expect((await post(otherLead, `/team-lead/agents/${caller.id}/notes`, { text: 'x' })).status).toBe(404);
  });

  it("scores a team call against the checklist; another team's call is not found", async () => {
    const mine = await call(caller, 1);
    const theirs = await call(outsider, 2);
    const quality = await get(lead, '/team-lead/quality');
    expect(quality.body.checklist).toHaveLength(6);
    expect(quality.body.picked.map((c: { id: string }) => c.id)).toContain(mine.id);
    expect((await post(lead, `/team-lead/quality/${mine.id}/score`, { checks: [true, true] })).status).toBe(400);
    const saved = await post(lead, `/team-lead/quality/${mine.id}/score`, { checks: [true, true, true, true, true, false], note: 'Explain the guarantee first' });
    expect(saved.status).toBe(200);
    expect(saved.body.score).toBe(83);
    expect((await post(lead, `/team-lead/quality/${theirs.id}/score`, { checks: [true, true, true, true, true, true] })).status).toBe(404);
    const flagged = await post(lead, `/team-lead/quality/${mine.id}/score`, { checks: [false, true, true, true, true, true], note: 'Promised a salary', flag: true });
    const flag = await prisma.reviewFlag.findUniqueOrThrow({ where: { id: flagged.body.flagId } });
    expect(flag).toMatchObject({ kind: 'call_flagged', ownerRole: 'manager', ownerStaffId: manager.id, raisedForStaffId: caller.id });
  });

  it('serves visit photos only to the agent\'s Team Lead, through private links', async () => {
    const storage = new MemoryBusinessPhotoStorage();
    await storage.put(`visits/${stamp}/board.jpg`, Buffer.from('board-bytes'), 'image/jpeg');
    const visit = await prisma.businessVisit.create({
      data: { staffId: fielder.id, latitude: 12.9, longitude: 77.6, shopName: 'Lakeview Bakery', boardPhotoPath: `visits/${stamp}/board.jpg`, visitedAt: shared.at, startedAt: shared.at, durationSeconds: 120 },
    });
    cleanup.visits.push(visit.id);
    const photos = await get(lead, `/team-lead/visits/${visit.id}/photos`);
    expect(photos.status).toBe(200);
    expect(photos.body.boardPhoto).toBe(`data:image/jpeg;base64,${Buffer.from('board-bytes').toString('base64')}`);
    expect(photos.body.selfie).toBeNull();
    expect((await get(otherLead, `/team-lead/visits/${visit.id}/photos`)).status).toBe(404);
    expect((await get(manager, `/team-lead/visits/${visit.id}/photos`)).status).toBe(403);

    const flag = await prisma.reviewFlag.create({ data: { code: `RF-TL-${stamp}`, kind: 'visit_short', subjectType: 'business_visit', subjectId: visit.id, raisedForStaffId: fielder.id, details: { visitId: visit.id } } });
    const list = await get(lead, '/team-lead/visits');
    const row = (list.body.rows as Array<{ id: string; flags: Array<{ id: string }> }>).find((r) => r.id === visit.id);
    expect(row?.flags.map((f) => f.id)).toEqual([flag.id]);
    expect(list.body.summary.toCheck).toBeGreaterThanOrEqual(1);
    const ok = await post(lead, `/team-lead/visits/${visit.id}/check`, { verdict: 'ok', note: 'Owner confirmed by phone' });
    expect(ok.status).toBe(200);
    expect((await prisma.reviewFlag.findUniqueOrThrow({ where: { id: flag.id } })).status).toBe('dismissed');
  });

  it("moves a business between the team's field agents, and refuses an agent outside the team", async () => {
    const business = await prisma.business.create({ data: { code: `BZ-TL-${stamp}`, name: 'Metro Mart', phone: `+9197${stamp.slice(-8)}`, accountAgentId: fielder.id } });
    cleanup.businesses.push(business.id);
    expect((await post(lead, `/team-lead/businesses/${business.id}/move`, { toStaffId: outsider.id })).status).toBe(400);
    expect((await post(otherLead, `/team-lead/businesses/${business.id}/move`, { toStaffId: fielder2.id })).status).toBe(403);
    const moved = await post(lead, `/team-lead/businesses/${business.id}/move`, { toStaffId: fielder2.id });
    expect(moved.status).toBe(200);
    expect((await prisma.business.findUniqueOrThrow({ where: { id: business.id } })).accountAgentId).toBe(fielder2.id);
  });

  it("marks a team registration fake: a flag the Manager owns; another team's is not found", async () => {
    const seeker = await prisma.jobSeeker.create({
      data: { code: `JS-TL-${stamp}`, name: 'Venkatesh', phone: `+9196${stamp.slice(-8)}`, minSalary: 1500000, maxSalary: 2000000, preferredCallWindowStart: '09:00', preferredCallWindowEnd: '21:00', status: 'active', registeredByStaffId: caller.id, paymentReceivedAt: shared.at, createdAt: shared.at },
    });
    cleanup.seekers.push(seeker.id);
    const list = await get(lead, '/team-lead/registrations');
    expect((list.body.rows as Array<{ jobSeeker: { id: string } }>).some((r) => r.jobSeeker.id === seeker.id)).toBe(true);
    expect(JSON.stringify(list.body)).not.toContain(`${stamp.slice(-8)}`);
    expect((await post(lead, `/team-lead/registrations/${seeker.id}/check`, { verdict: 'fake' })).status).toBe(400);
    expect((await post(otherLead, `/team-lead/registrations/${seeker.id}/check`, { verdict: 'ok' })).status).toBe(404);
    const fake = await post(lead, `/team-lead/registrations/${seeker.id}/check`, { verdict: 'fake', note: 'Same face as JS-00118' });
    expect(fake.status).toBe(200);
    const flag = await prisma.reviewFlag.findUniqueOrThrow({ where: { id: fake.body.flagId } });
    expect(flag).toMatchObject({ kind: 'registration_suspect', ownerRole: 'manager', ownerStaffId: manager.id });
    const after = await get(lead, '/team-lead/registrations');
    expect((after.body.rows as Array<{ jobSeeker: { id: string } }>).some((r) => r.jobSeeker.id === seeker.id)).toBe(false);
    expect(after.body.summary.fakesThisMonth).toBeGreaterThanOrEqual(1);
  });

  it('reminds an agent in the team with a bell', async () => {
    expect((await post(lead, '/team-lead/remind', { staffId: outsider.id, text: 'Call him' })).status).toBe(404);
    const ok = await post(lead, '/team-lead/remind', { staffId: caller.id, text: 'Call JS-00203 first' });
    expect(ok.status).toBe(200);
    const bell = await prisma.notification.findFirst({ where: { recipientStaffId: caller.id, kind: 'agent_reminder' } });
    expect(bell?.body).toBe('Call JS-00203 first');
  });
});
