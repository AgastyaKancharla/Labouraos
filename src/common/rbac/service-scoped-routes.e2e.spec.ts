import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcrypt';
import * as request from 'supertest';
import { randomUUID } from 'crypto';
import { AppModule } from '../../app.module';
import { PrismaService } from '../prisma/prisma.service';

/**
 * Proofs for routes in SERVICE_SCOPED_ROUTES that had no cross-team test:
 * the service refuses a Team Lead (or agent) acting on someone outside their
 * own team or list. Two teams: Team Lead A with agent A, Team Lead B with agent B.
 */
describe('Service-scoped routes refuse other teams', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let jwt: JwtService;
  const tag = randomUUID().replace(/-/g, '').slice(0, 8).toUpperCase();
  const staffIds: string[] = [];
  const ids: Record<string, string> = {};
  const tokens: Record<string, string> = {};
  const cleanup: Array<() => Promise<unknown>> = [];

  async function staff(key: string, role: string, lead?: string) {
    const row = await prisma.staff.create({
      data: {
        code: `SSR-${key}-${tag}`,
        name: `SSR ${key}`,
        email: `ssr_${key.toLowerCase()}_${tag.toLowerCase()}@laboura.local`,
        passwordHash: await bcrypt.hash('Scoped-Routes-123!', 4),
        role,
        status: 'active',
        teamLeadId: lead ?? null,
        reportsToId: lead ?? null,
      },
    });
    staffIds.push(row.id);
    ids[key] = row.id;
    tokens[key] = jwt.sign({ sub: row.id, role: row.role, code: row.code, email: row.email });
  }

  const as = (key: string) => ({ Authorization: `Bearer ${tokens[key]}` });

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
    await staff('FAA', 'field_agent', ids.TLA);
    await staff('FAB', 'field_agent', ids.TLB);
  });

  afterAll(async () => {
    for (const run of cleanup.reverse()) await run().catch(() => undefined);
    await prisma.auditLog.deleteMany({ where: { actorId: { in: staffIds } } }).catch(() => undefined);
    await prisma.staff.deleteMany({ where: { id: { in: staffIds } } }).catch(() => undefined);
    await app.close();
  });

  it("a Team Lead cannot open another team's audit row", async () => {
    const row = await prisma.auditLog.create({
      data: { code: `AL-SSR-${tag}`, actorId: ids.CAB, action: 'test.action', entityType: 'job_seeker', entityCode: `JS-SSR-${tag}` },
    });
    cleanup.push(() => prisma.auditLog.delete({ where: { id: row.id } }));
    expect((await request(app.getHttpServer()).get(`/audit-logs/${row.id}`).set(as('TLA'))).status).toBe(404);
    const own = await request(app.getHttpServer()).get(`/audit-logs/${row.id}`).set(as('TLB'));
    expect(own.status).toBe(200);
    expect(own.body.id).toBe(row.id);
  });

  it("another team's Team Lead cannot approve a system problem, or read a day's history", async () => {
    const day = await prisma.attendanceDay.create({ data: { staffId: ids.CAB, date: new Date('2027-01-04T00:00:00.000Z') } });
    const segment = await prisma.attendanceSegment.create({
      data: { staffId: ids.CAB, dayId: day.id, status: 'system_problem', startedAt: new Date('2027-01-04T05:00:00.000Z'), source: 'staff' },
    });
    cleanup.push(() => prisma.attendanceDay.delete({ where: { id: day.id } }));
    cleanup.push(() => prisma.attendanceSegment.delete({ where: { id: segment.id } }));
    // another team's Team Lead cannot approve a system problem
    expect((await request(app.getHttpServer()).post(`/attendance/system-problem/${segment.id}/approve`).set(as('TLA'))).status).toBe(403);
    // another team's Team Lead cannot read a day's history
    expect((await request(app.getHttpServer()).get(`/attendance/days/${day.id}/history`).set(as('TLA'))).status).toBe(403);
    expect((await request(app.getHttpServer()).get(`/attendance/days/${day.id}/history`).set(as('TLB'))).status).toBe(200);
    expect((await request(app.getHttpServer()).post(`/attendance/system-problem/${segment.id}/approve`).set(as('TLB'))).status).toBe(201);
  });

  it("another team's Team Lead cannot forward a leave request", async () => {
    const leave = await prisma.leaveRequest.create({
      data: {
        staffId: ids.CAB,
        kind: 'casual',
        fromDate: new Date('2027-02-10T00:00:00.000Z'),
        toDate: new Date('2027-02-10T00:00:00.000Z'),
        days: 1,
        reason: 'Family function',
        routedToRole: 'team_lead',
        routeReason: 'default',
      },
    });
    cleanup.push(() => prisma.leaveRequest.delete({ where: { id: leave.id } }));
    // POST /attendance/requests/:kind/:id/forward: TL from another team is refused (403)
    const res = await request(app.getHttpServer())
      .post(`/attendance/requests/leave/${leave.id}/forward`)
      .set(as('TLA'))
      .send({ note: 'Please decide' });
    expect(res.status).toBe(403);
  });

  it("another team's Team Lead cannot refuse a login code", async () => {
    const device = await prisma.staffDevice.create({
      data: { staffId: ids.CAB, deviceId: `dev-ssr-${tag}`, label: 'Phone', platform: 'web', status: 'approved' },
    });
    const code = await prisma.loginCodeRequest.create({
      data: { staffId: ids.CAB, staffDeviceId: device.id, ipAddress: '127.0.0.1', expiresAt: new Date(Date.now() + 5 * 60 * 1000) },
    });
    cleanup.push(() => prisma.staffDevice.delete({ where: { id: device.id } }));
    cleanup.push(() => prisma.loginCodeRequest.delete({ where: { id: code.id } }));
    // POST /login-codes/:id/refuse: TL from another team is refused (403)
    const res = await request(app.getHttpServer())
      .post(`/login-codes/${code.id}/refuse`)
      .set(as('TLA'))
      .send({ reason: 'Not mine' });
    expect(res.status).toBe(403);
  });

  it('another call agent cannot open a follow-up that is not on their list', async () => {
    const task = await prisma.followUpTask.create({
      data: {
        code: `FU-SSR-${tag}`,
        kind: 'not_selected_day_7',
        subjectType: 'job_seeker',
        subjectId: randomUUID(),
        dueAt: new Date(),
        assignedStaffId: ids.CAB,
      },
    });
    cleanup.push(() => prisma.followUpTask.delete({ where: { id: task.id } }));
    expect((await request(app.getHttpServer()).get(`/call-work/follow-ups/${task.id}`).set(as('CAA'))).status).toBe(403);
  });

  const post = (key: string, url: string, body: object = {}) => request(app.getHttpServer()).post(url).set(as(key)).send(body);
  const get = (key: string, url: string) => request(app.getHttpServer()).get(url).set(as(key));
  let seq = 0;
  const unique = () => `${tag}${(seq += 1)}`;

  async function seekerFor(registeredBy: string) {
    const digits = String(Math.floor(Math.random() * 1e8)).padStart(8, '0');
    const row = await prisma.jobSeeker.create({
      data: {
        code: `JS-SSR-${unique()}`, name: 'SSR Seeker', phone: `+9196${digits}`, minSalary: 1500000, maxSalary: 2000000,
        preferredCallWindowStart: '09:00', preferredCallWindowEnd: '21:00', registeredByStaffId: registeredBy,
      },
    });
    cleanup.push(() => prisma.jobSeeker.delete({ where: { id: row.id } }));
    return row;
  }

  async function businessFor(accountAgentId: string) {
    const digits = String(Math.floor(Math.random() * 1e8)).padStart(8, '0');
    const row = await prisma.business.create({
      data: { code: `BZ-SSR-${unique()}`, name: 'SSR Shop', phone: `+9197${digits}`, city: 'Bengaluru', verificationStatus: 'verified', accountAgentId },
    });
    cleanup.push(() => prisma.business.delete({ where: { id: row.id } }));
    return row;
  }

  async function leaveFor(staffId: string) {
    const leave = await prisma.leaveRequest.create({
      data: {
        staffId, kind: 'casual', fromDate: new Date('2027-03-10T00:00:00.000Z'), toDate: new Date('2027-03-10T00:00:00.000Z'),
        days: 1, reason: 'Family function', routedToRole: 'team_lead', routeReason: 'default',
      },
    });
    cleanup.push(() => prisma.leaveRequest.delete({ where: { id: leave.id } }));
    return leave;
  }

  it('TL from another team cannot reject an attendance request (403)', async () => {
    const leave = await leaveFor(ids.CAB);
    expect((await post('TLA', `/attendance/requests/leave/${leave.id}/reject`, { reason: 'No' })).status).toBe(403);
  });

  it('TL from another team cannot forward a request on the Requests screen (refused)', async () => {
    const leave = await leaveFor(ids.CAB);
    expect([403, 404]).toContain((await post('TLA', `/requests/leave.${leave.id}/forward`, { note: 'Please decide' })).status);
  });

  it('TL from another team cannot resolve or escalate a flag about the other team (404)', async () => {
    const flag = await prisma.reviewFlag.create({
      data: { code: `RF-SSR-${unique()}`, kind: 'manual_review', subjectType: 'staff', subjectId: ids.CAB, raisedForStaffId: ids.CAB, ownerRole: 'team_lead', ownerStaffId: ids.TLB },
    });
    cleanup.push(() => prisma.reviewFlag.delete({ where: { id: flag.id } }));
    // POST /requests/flags/:id/resolve: TL from another team is refused (404)
    expect((await post('TLA', `/requests/flags/${flag.id}/resolve`, { resolution: 'Checked' })).status).toBe(404);
    // POST /requests/flags/:id/escalate: TL from another team is refused (404)
    expect((await post('TLA', `/requests/flags/${flag.id}/escalate`, { note: 'Up' })).status).toBe(404);
  });

  it("TL from another team cannot check another team's visit or see a registration selfie (404)", async () => {
    const business = await businessFor(ids.FAB);
    const visit = await prisma.businessVisit.create({ data: { businessId: business.id, staffId: ids.FAB, latitude: 12.97, longitude: 77.59 } });
    cleanup.push(() => prisma.businessVisit.delete({ where: { id: visit.id } }));
    // POST /team-lead/visits/:id/check: TL from another team is refused (404)
    expect((await post('TLA', `/team-lead/visits/${visit.id}/check`, { verdict: 'ok' })).status).toBe(404);
    const seeker = await seekerFor(ids.CAB);
    // GET /team-lead/registrations/:id/selfie: TL from another team is refused (404)
    expect((await get('TLA', `/team-lead/registrations/${seeker.id}/selfie`)).status).toBe(404);
  });

  it("TL from another team cannot approve or revoke another team's device (403)", async () => {
    const pending = await prisma.staffDevice.create({
      data: { staffId: ids.CAB, deviceId: `dev-ssr-p-${unique()}`, label: 'Phone', platform: 'web', status: 'pending' },
    });
    const approved = await prisma.staffDevice.create({
      data: { staffId: ids.CAB, deviceId: `dev-ssr-a-${unique()}`, label: 'Laptop', platform: 'web', status: 'approved' },
    });
    cleanup.push(() => prisma.staffDevice.deleteMany({ where: { id: { in: [pending.id, approved.id] } } }));
    // POST /staff/devices/:id/approve: TL from another team is refused (403)
    expect((await post('TLA', `/staff/devices/${pending.id}/approve`)).status).toBe(403);
    // POST /staff/devices/:id/revoke: TL from another team is refused (403)
    expect((await post('TLA', `/staff/devices/${approved.id}/revoke`)).status).toBe(403);
  });

  it('another field agent cannot ask for the owner OTP on a visit given to someone else (403)', async () => {
    const business = await businessFor(ids.FAB);
    const assignment = await prisma.visitAssignment.create({
      data: { businessId: business.id, purpose: 'verification', assignedStaffId: ids.FAB, status: 'assigned' },
    });
    cleanup.push(() => prisma.visitAssignment.delete({ where: { id: assignment.id } }));
    expect((await post('FAA', `/businesses/${business.id}/visit-assignments/${assignment.id}/owner-otp`)).status).toBe(403);
  });

  it("another agent cannot record a reply on someone else's offer call (POST /interviews/:id/call-reply, 403)", async () => {
    const business = await businessFor(ids.FAB);
    const vacancy = await prisma.vacancy.create({ data: { code: `VC-SSR-${unique()}`, businessId: business.id, tradeSkill: 'Electrician', status: 'open' } });
    const seeker = await seekerFor(ids.CAB);
    const slot = await prisma.vacancyInterviewSlot.create({ data: { vacancyId: vacancy.id, startsAt: new Date(Date.now() + 86_400_000), endsAt: new Date(Date.now() + 90_000_000) } });
    const interview = await prisma.interview.create({
      data: {
        code: `IV-SSR-${unique()}`, vacancyId: vacancy.id, businessId: business.id, jobSeekerId: seeker.id, vacancyInterviewSlotId: slot.id,
        slotStartsAt: slot.startsAt, slotEndsAt: slot.endsAt, proposedByStaffId: ids.CAB, suitabilitySnapshot: {}, status: 'offered',
        offerSentAt: new Date(Date.now() - 3_600_000), replyDueAt: new Date(Date.now() + 3_600_000), resultDueAt: slot.endsAt,
      },
    });
    const call = await prisma.callRecord.create({
      data: { code: `CR-SSR-${unique()}`, provider: 'mock', providerCallId: `ssr-${unique()}`, providerStatus: 'completed', answered: true,
        staffId: ids.CAB, subjectType: 'job_seeker', subjectId: seeker.id, purpose: 'offer', startedAt: new Date() },
    });
    cleanup.push(() => prisma.vacancy.delete({ where: { id: vacancy.id } }));
    cleanup.push(() => prisma.vacancyInterviewSlot.delete({ where: { id: slot.id } }));
    cleanup.push(() => prisma.interview.delete({ where: { id: interview.id } }));
    cleanup.push(() => prisma.callRecord.delete({ where: { id: call.id } }));
    const res = await post('CAA', `/interviews/${interview.id}/call-reply`, { callRecordId: call.id, answer: 'accepted_offer' });
    expect(res.status).toBe(403);
    // GET /interviews?vacancyId=: another team's interviews are left out (not.toContain)
    const listed = await get('TLA', `/interviews?vacancyId=${vacancy.id}`);
    expect(JSON.stringify(listed.body)).not.toContain(interview.id);
  });

  it('city-wide reads keep their role restriction: Team Leads cannot use the call agent people routes (403)', async () => {
    const seeker = await seekerFor(ids.CAB);
    // GET /call-work/people/:ref: for call agents only (403 to a Team Lead)
    expect((await get('TLA', `/call-work/people/${seeker.id}`)).status).toBe(403);
    // GET /call-work/people/:ref/jobs: for call agents only (403 to a Team Lead)
    expect((await get('TLA', `/call-work/people/${seeker.id}/jobs`)).status).toBe(403);
    // POST /payments/:id/resend: agents (city-wide) and the CEO only; a Team Lead is refused (403)
    expect((await post('TLA', '/payments/00000000-0000-0000-0000-000000000000/resend')).status).toBe(403);
  });

  it('ids in the query are checked too (Team Lead from another team)', async () => {
    const seeker = await seekerFor(ids.CAB);
    // GET /targets?staffId=: TL from another team is refused (403)
    expect((await get('TLA', `/targets?staffId=${ids.CAB}`)).status).toBe(403);
    // GET /messages?subjectId=: TL from another team is refused (403)
    expect((await get('TLA', `/messages?subjectType=job_seeker&subjectId=${seeker.id}`)).status).toBe(403);
    // GET /interviews?agentId=: TL from another team is refused (403)
    expect((await get('TLA', `/interviews?agentId=${ids.CAB}`)).status).toBe(403);
    const call = await prisma.callRecord.create({
      data: { code: `CR-SSRQ-${unique()}`, provider: 'mock', providerCallId: `ssrq-${unique()}`, providerStatus: 'completed', answered: true,
        staffId: ids.CAB, subjectType: 'job_seeker', subjectId: seeker.id, purpose: 'general' },
    });
    cleanup.push(() => prisma.callRecord.delete({ where: { id: call.id } }));
    const history = await prisma.statusHistory.create({
      data: { subjectType: 'job_seeker', subjectId: seeker.id, toStatus: 'active', changedByStaffId: ids.CAB },
    });
    cleanup.push(() => prisma.statusHistory.delete({ where: { id: history.id } }));
    // GET /calls?subjectId=: another team's calls are left out (not.toContain)
    const calls = await get('TLA', `/calls?subjectType=job_seeker&subjectId=${seeker.id}`);
    expect(calls.status).toBe(200);
    expect((calls.body as Array<{ id: string }>).map((row) => row.id)).not.toContain(call.id);
    // GET /status-history?subjectId=: another team's history answers empty (toEqual([]))
    const trail = await get('TLA', `/status-history?subjectType=job_seeker&subjectId=${seeker.id}`);
    expect(trail.body).toEqual([]);
    // GET /staff/sessions?staffId=: ignored below Manager, a Team Lead sees only their own (not.toContain)
    const sessions = await get('TLA', `/staff/sessions?staffId=${ids.CAB}`);
    expect(sessions.status).toBe(200);
    expect(JSON.stringify(sessions.body)).not.toContain(ids.CAB);
  });
});
