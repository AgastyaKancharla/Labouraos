import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import * as request from 'supertest';
import * as bcrypt from 'bcrypt';
import { AppModule } from '../../app.module';
import { PrismaService } from '../../common/prisma/prisma.service';
import { OtpService } from '../../common/otp/otp.service';
import { MockOtpProvider } from '../../common/otp/mock-otp.provider';
import { enrolledLogin } from '../../test-support/enrolled-login-spec';

/**
 * 26 Nov (owner): Laboura Field saves several vacancies of one business together (another role, or
 * the same role on another shift) and the owner confirms them all with ONE code.
 */
describe('Vacancies saved together, confirmed by the owner with one code', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let otp: OtpService;

  const ts = Date.now();
  const suffix = ts.toString().slice(-7);
  const password = 'Password123!Secure';
  const staffIds: string[] = [];
  let agentToken: string;
  let businessId: string;
  let otherBusinessId: string;
  const businessPhone = `78${suffix}3`;

  const code = (requestId: string) => (otp.getProvider() as MockOtpProvider).getCode(requestId)!;
  const server = () => app.getHttpServer();
  const post = (path: string, body: Record<string, unknown>) =>
    request(server()).post(path).set('Authorization', `Bearer ${agentToken}`).send(body);
  const row = (extra: Record<string, unknown> = {}) => ({
    tradeSkill: 'Electrician', salaryMinPaise: 2900000, headcount: 1, salaryPeriod: 'monthly', interviewType: 'walk_in', ...extra,
  });

  beforeAll(async () => {
    const moduleRef: TestingModule = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
    prisma = app.get(PrismaService);
    otp = app.get(OtpService);

    const passwordHash = await bcrypt.hash(password, 10);
    const teamLead = await prisma.staff.create({ data: {
      code: `TL-BATCH-${ts}`, name: 'Batch Team Lead', email: `tl_batch_${ts}@laboura.local`, passwordHash, role: 'team_lead',
    } });
    const agent = await prisma.staff.create({ data: {
      code: `CA-BATCH-${ts}`, name: 'Batch Agent', email: `ca_batch_${ts}@laboura.local`, passwordHash, role: 'call_agent', teamLeadId: teamLead.id,
    } });
    staffIds.push(teamLead.id, agent.id);
    agentToken = (await enrolledLogin(server(), { email: agent.email, password })).body.accessToken as string;

    const business = await prisma.business.create({ data: {
      code: `BZ-BATCH-${ts}`, name: 'Batch Mess', phone: businessPhone, phoneVerified: true,
      additionalContactName: 'Reddy', contactRole: 'owner', locality: 'JP Nagar', verificationStatus: 'verified', accountAgentId: agent.id,
    } });
    businessId = business.id;
    const other = await prisma.business.create({ data: {
      code: `BZ-BATCH2-${ts}`, name: 'Other Shop', phone: `79${suffix}4`, phoneVerified: true,
      additionalContactName: 'Someone', contactRole: 'owner', locality: 'JP Nagar', verificationStatus: 'verified', accountAgentId: agent.id,
    } });
    otherBusinessId = other.id;
  });

  afterAll(async () => {
    try {
      if (prisma) {
        const ids = [businessId, otherBusinessId].filter(Boolean);
        await prisma.vacancyInterviewSlot.deleteMany({ where: { vacancy: { businessId: { in: ids } } } });
        await prisma.statusHistory.deleteMany({ where: { subjectType: 'vacancy', changedByStaffId: { in: staffIds } } });
        await prisma.reviewFlag.deleteMany({ where: { raisedForStaffId: { in: staffIds } } });
        await prisma.vacancy.deleteMany({ where: { businessId: { in: ids } } });
        await prisma.business.deleteMany({ where: { id: { in: ids } } });
        await prisma.auditLog.deleteMany({ where: { actorId: { in: staffIds } } });
        await prisma.staff.deleteMany({ where: { id: { in: staffIds } } });
      }
    } finally {
      if (app) await app.close();
    }
  });

  it('saves the rows, sends ONE code, and that code confirms all of them (note kept); a wrong code confirms none', async () => {
    const saved = await post('/vacancies/batch', {
      businessId,
      vacancies: [
        row({ description: 'Morning helper, 7 to 2' }),
        row({ description: 'Evening helper, 6 to 11', extras: ['food'] }),
        row({ tradeSkill: 'Plumber', headcount: 2, experienceRequiredYears: 2 }),
      ],
    }).expect(201);
    expect(saved.body.vacancies).toHaveLength(3);
    expect(saved.body.vacancies.every((v: { status: string }) => v.status === 'awaiting_confirmation')).toBe(true);
    expect(saved.body.confirmation).toMatchObject({ sentToLast4: businessPhone.slice(-4), contactName: 'Reddy' });
    const ids = saved.body.vacancies.map((v: { id: string }) => v.id) as string[];
    expect(saved.body.confirmation.vacancyIds.sort()).toEqual([...ids].sort());
    const stored = await prisma.vacancy.findMany({ where: { id: { in: ids } }, orderBy: { code: 'asc' } });
    expect(stored.map((v) => v.description)).toEqual(['Morning helper, 7 to 2', 'Evening helper, 6 to 11', null]);
    expect(stored[2]).toMatchObject({ headcount: 2, experienceRequiredYears: 2 });

    const requestId = saved.body.confirmation.otpRequestId as string;
    const wrong = code(requestId) === '000000' ? '111111' : '000000';
    await post('/vacancies/batch/confirm', { businessId, vacancyIds: ids, otpRequestId: requestId, code: wrong }).expect(400);
    expect(await prisma.vacancy.count({ where: { id: { in: ids }, status: 'awaiting_confirmation' } })).toBe(3);

    // The one code does not confirm a smaller set (it is bound to exactly these vacancies).
    await post('/vacancies/batch/confirm', { businessId, vacancyIds: ids.slice(0, 2), otpRequestId: requestId, code: code(requestId) }).expect(400);

    const confirmed = await post('/vacancies/batch/confirm', { businessId, vacancyIds: ids, otpRequestId: requestId, code: code(requestId), method: 'code_on_visit' }).expect(201);
    expect(confirmed.body.confirmed).toBe(3);
    expect(await prisma.vacancy.count({ where: { id: { in: ids }, confirmationMethod: 'code_on_visit', confirmedByName: 'Reddy' } })).toBe(3);
  });

  it('a problem in one row names the row and saves nothing', async () => {
    const before = await prisma.vacancy.count({ where: { businessId } });
    const tick = await post('/vacancies/batch', { businessId, vacancies: [row(), row({ salaryMinPaise: 500000 })] }).expect(400);
    expect(tick.body.details).toMatchObject({ code: 'MINIMUM_WAGE_TICK_REQUIRED', vacancyIndex: 1 });
    const extra = await post('/vacancies/batch', { businessId, vacancies: [row({ status: 'open' })] }).expect(400);
    expect(extra.body.details).toMatchObject({ code: 'BATCH_ROW_INVALID', vacancyIndex: 0 });
    const longNote = await post('/vacancies/batch', { businessId, vacancies: [row({ description: 'x'.repeat(501) })] }).expect(400);
    expect(longNote.body.details).toMatchObject({ code: 'BATCH_ROW_INVALID', vacancyIndex: 0 });
    await post('/vacancies/batch', { businessId, vacancies: [] }).expect(400);
    expect(await prisma.vacancy.count({ where: { businessId } })).toBe(before);
  });

  it('a code for one business never confirms another business\'s vacancies, and an edit since the code refuses it', async () => {
    const a = await post('/vacancies/batch', { businessId, vacancies: [row(), row()] }).expect(201);
    const b = await post('/vacancies/batch', { businessId: otherBusinessId, vacancies: [row()] }).expect(201);
    const aIds = a.body.vacancies.map((v: { id: string }) => v.id) as string[];
    const bIds = b.body.vacancies.map((v: { id: string }) => v.id) as string[];
    // Mixing businesses is refused outright.
    await post('/vacancies/batch/confirm', { businessId, vacancyIds: [...aIds, ...bIds], otpRequestId: a.body.confirmation.otpRequestId, code: '123456' }).expect(404);
    // An edit to one of them starts a new round: the old code no longer confirms the set.
    await request(server()).patch(`/vacancies/${aIds[0]}`).set('Authorization', `Bearer ${agentToken}`)
      .send({ headcount: 3, reason: 'Owner wants three' }).expect(200);
    const rid = a.body.confirmation.otpRequestId as string;
    await post('/vacancies/batch/confirm', { businessId, vacancyIds: aIds, otpRequestId: rid, code: code(rid) }).expect(400);
    // A fresh code for the set works.
    const again = await post('/vacancies/batch/send-code', { businessId, vacancyIds: aIds }).expect(201);
    const ok = await post('/vacancies/batch/confirm', { businessId, vacancyIds: aIds, otpRequestId: again.body.otpRequestId, code: code(again.body.otpRequestId) }).expect(201);
    expect(ok.body.confirmed).toBe(2);
  });
});
