import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcrypt';
import { createHash, randomUUID } from 'crypto';
import * as request from 'supertest';
import { AppModule } from '../../app.module';
import { PrismaService } from '../../common/prisma/prisma.service';
import { AttendanceClock } from '../attendance/attendance-clock';
import { FieldVisitClock } from '../field-visit/field-visit-clock';
import { businessRowState, seekerRowState, sortRows } from './field-people.service';

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;
/** 11:30 IST on 22 Nov 2026. */
const NOON = new Date('2026-11-22T06:00:00.000Z');

class TestClock {
  at: Date = NOON;
  now(): Date {
    return this.at;
  }
}

type Who = { id: string; role: string; code: string; name: string };

describe('Laboura Field lists (22 Nov): the row state', () => {
  const can = { canAct: true, shifts: 1, freshVacancy: true };

  it('a business: one plain status, one button, or Waiting / Done', () => {
    expect(businessRowState({ kind: 'agreement_waiting', agreementState: 'not_sent' }, can)).toMatchObject({ status: 'agreement_not_sent', action: 'agreement_link', group: 'needs_action' });
    expect(businessRowState({ kind: 'agreement_waiting', agreementState: 'link_expired' }, can)).toMatchObject({ status: 'agreement_expired', action: 'agreement_link' });
    expect(businessRowState({ kind: 'vacancy_to_confirm', vacancyId: 'v1' }, can)).toMatchObject({ action: 'confirm_vacancy', vacancyId: 'v1' });
    // Nothing to do while the Team Lead checks: "Waiting", never a button.
    expect(businessRowState({ kind: 'waiting_tl_check' }, can)).toEqual({ status: 'waiting_tl', action: null, vacancyId: null, waiting: true, done: false, group: 'waiting_tl' });
    // A vacancy picks one of the business's shifts: with none, Add shifts comes first.
    expect(businessRowState({ kind: 'add_vacancy' }, { ...can, shifts: 0 })).toMatchObject({ status: 'no_shifts', action: 'add_shifts' });
    expect(businessRowState({ kind: 'add_vacancy' }, can)).toMatchObject({ status: 'no_vacancy', action: 'add_vacancy' });
    expect(businessRowState({ kind: 'ready_show_candidates', vacancyId: 'v2' }, can)).toMatchObject({ status: 'ready', action: 'show_candidates', vacancyId: 'v2', group: 'needs_action' });
    expect(businessRowState({ kind: 'ready_show_candidates', vacancyId: 'v2' }, { ...can, freshVacancy: false })).toMatchObject({ status: 'candidates_shown', group: 'active' });
    expect(businessRowState({ kind: 'none' }, can)).toMatchObject({ status: 'all_good', action: null, done: true, group: 'done' });
    // Another agent's business: the words, never a button.
    expect(businessRowState({ kind: 'add_vacancy' }, { ...can, canAct: false })).toMatchObject({ action: null, group: 'active' });
  });

  it('a job seeker: link, ID, payment, then active, interview booked or placed', () => {
    const base = { status: 'lead', linkSent: false, placed: false, nextInterviewAt: null, bookableVacancyId: null };
    const at = (step: string, state = 'not_started', reason: string | null = null, waitingForTeamLead = false) => ({ step, state, reason, waitingForTeamLead });
    expect(seekerRowState({ ...base, stuck: at('consent') })).toMatchObject({ status: 'link_not_sent', action: 'registration_link' });
    expect(seekerRowState({ ...base, linkSent: true, stuck: at('selfie') })).toMatchObject({ status: 'link_not_finished', action: 'registration_link' });
    expect(seekerRowState({ ...base, stuck: at('id_check', 'in_progress', "Waiting for the Team Lead's ID check", true) })).toMatchObject({ status: 'waiting_tl', action: null, waiting: true, group: 'waiting_tl' });
    expect(seekerRowState({ ...base, stuck: at('id_check') })).toMatchObject({ status: 'id_check_needed', action: 'scan_aadhaar' });
    expect(seekerRowState({ ...base, stuck: at('id_check', 'stuck', 'Under 18: registration stops (only a Manager or the CEO can lift it)') })).toMatchObject({ status: 'id_stopped', action: null });
    expect(seekerRowState({ ...base, stuck: at('payment') })).toMatchObject({ status: 'stuck_payment', action: 'payment_link', group: 'needs_action' });
    expect(seekerRowState({ ...base, stuck: at('payment', 'stuck', 'Waiting for the new trade') })).toMatchObject({ status: 'trade_waiting', action: null, waiting: true });
    expect(seekerRowState({ ...base, status: 'active', stuck: null })).toMatchObject({ status: 'active', action: null, done: true, group: 'active' });
    expect(seekerRowState({ ...base, status: 'active', stuck: null, bookableVacancyId: 'v9' })).toMatchObject({ action: 'book_interview', vacancyId: 'v9', group: 'needs_action' });
    expect(seekerRowState({ ...base, status: 'active', stuck: null, nextInterviewAt: NOON })).toMatchObject({ status: 'interview_booked', action: null });
    expect(seekerRowState({ ...base, status: 'active', stuck: null, placed: true })).toMatchObject({ status: 'placed', done: true, group: 'done' });
    expect(seekerRowState({ ...base, status: 'deactivated', stuck: null })).toMatchObject({ status: 'closed', action: null });
  });

  it('needs-action rows come first; otherwise the order stays', () => {
    const rows = [
      { id: 'a', row: { group: 'done' as const } },
      { id: 'b', row: { group: 'needs_action' as const } },
      { id: 'c', row: { group: 'active' as const } },
      { id: 'd', row: { group: 'needs_action' as const } },
      { id: 'e', row: { group: 'waiting_tl' as const } },
    ];
    expect(sortRows(rows).map((r) => r.id)).toEqual(['b', 'd', 'e', 'c', 'a']);
  });
});

describe('Laboura Field lists (22 Nov): GET /field-work/businesses, /field-work/job-seekers and the job seeker profile', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let jwt: JwtService;
  const clock = new TestClock();
  const stamp = Date.now();
  const tag = String(stamp).slice(-6);
  const staffIds: string[] = [];
  const businessIds: string[] = [];
  const seekerIds: string[] = [];
  let seq = 0;
  let agent: Who;
  let otherAgent: Who;
  let callAgent: Who;

  const tokenFor = (s: Who) => jwt.sign({ sub: s.id, role: s.role, code: s.code, email: null });
  const get = (who: Who, path: string) => request(app.getHttpServer()).get(path).set('Authorization', `Bearer ${tokenFor(who)}`);
  const next = () => String(++seq).padStart(3, '0');

  async function makeStaff(role: string): Promise<Who> {
    const n = staffIds.length;
    const staff = await prisma.staff.create({
      data: {
        code: `FP-${role.slice(0, 3).toUpperCase()}-${stamp}-${n}`,
        name: `People ${role} ${n}`,
        email: `fp-${role}-${stamp}-${n}@laboura.local`,
        passwordHash: await bcrypt.hash('Field-Password-1', 4),
        role,
        status: 'active',
      },
    });
    staffIds.push(staff.id);
    return staff;
  }

  async function makeBusiness(owner: Who, fields: Partial<{ name: string; verificationStatus: string; inPersonOnboardedAt: Date; createdAt: Date; businessType: string }> = {}) {
    const n = next();
    const business = await prisma.business.create({
      data: {
        code: `BZ-FP${tag}${n}`,
        name: fields.name ?? `People Shop ${n}`,
        phone: `+9195${tag}${n.slice(-2)}`,
        phoneVerified: true,
        latitude: 12.93,
        longitude: 77.63,
        locality: 'Bellandur',
        businessType: fields.businessType ?? 'sweet_shop',
        accountAgentId: owner.id,
        leadCreatedByStaffId: owner.id,
        leadChannel: 'field_visit',
        verificationStatus: fields.verificationStatus ?? 'lead',
        inPersonOnboardedAt: fields.inPersonOnboardedAt ?? null,
        createdAt: fields.createdAt ?? NOON,
      },
    });
    businessIds.push(business.id);
    return business;
  }

  function signAgreement(businessId: string) {
    return prisma.businessAgreement.create({
      data: {
        businessId, version: '1.2', termsHash: 'h', noBypassMonths: 12, noBypassPenaltyPercent: 50, feePercent: 50, gstPercent: 18,
        signedName: 'Owner Name', signedPhone: '+919999999999', otpRequestId: 'otp', signedAt: new Date(NOON.getTime() - DAY), documentStoragePath: 'x',
      },
    });
  }

  async function makeSeeker(by: Who, fields: Partial<{ name: string; createdAt: Date; paymentReceivedAt: Date; status: string; locality: string; hitCount: number }> = {}) {
    const n = next();
    const seeker = await prisma.jobSeeker.create({
      data: {
        code: `JS-FP${tag}${n}`,
        name: fields.name ?? `Seeker ${n}`,
        phone: `+9184${tag}${n.slice(-2)}`,
        minSalary: 1500000,
        maxSalary: 2000000,
        preferredCallWindowStart: '09:00',
        preferredCallWindowEnd: '21:00',
        registeredByStaffId: by.id,
        status: fields.status ?? 'lead',
        locality: fields.locality ?? 'Bommanahalli',
        hitCount: fields.hitCount ?? 0,
        paymentReceivedAt: fields.paymentReceivedAt ?? null, guaranteeStartsAt: fields.paymentReceivedAt ?? null,
        createdAt: fields.createdAt ?? NOON,
        trades: { create: [{ trade: 'Cook', yearsExperience: 1, isPrimary: true }] },
      },
    });
    seekerIds.push(seeker.id);
    return seeker;
  }

  async function allConsents(subjectId: string) {
    for (const purpose of ['job_matching', 'profile_sharing', 'call_recording', 'aadhaar_verification', 'job_updates']) {
      await prisma.consent.create({
        data: { subjectType: 'job_seeker', subjectId, purpose, granted: true, noticeVersion: '1.2', language: 'en', method: 'sms_link', grantedAt: new Date(NOON.getTime() - 2 * HOUR) },
      });
    }
  }

  beforeAll(async () => {
    const moduleRef: TestingModule = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(FieldVisitClock)
      .useValue(clock)
      .overrideProvider(AttendanceClock)
      .useValue(clock)
      .compile();
    app = moduleRef.createNestApplication();
    await app.init();
    prisma = app.get(PrismaService);
    jwt = app.get(JwtService);
    agent = await makeStaff('field_agent');
    otherAgent = await makeStaff('field_agent');
    callAgent = await makeStaff('call_agent');
  }, 120000);

  afterAll(async () => {
    if (!prisma) return;
    await prisma.candidateIntroduction.deleteMany({ where: { businessId: { in: businessIds } } });
    await prisma.vacancy.deleteMany({ where: { businessId: { in: businessIds } } });
    await prisma.businessShift.deleteMany({ where: { businessId: { in: businessIds } } });
    await prisma.consent.deleteMany({ where: { subjectId: { in: seekerIds } } });
    await prisma.publicLink.deleteMany({ where: { subjectId: { in: [...businessIds, ...seekerIds] } } });
    await prisma.identityVerification.deleteMany({ where: { jobSeekerId: { in: seekerIds } } });
    await prisma.jobSeeker.deleteMany({ where: { id: { in: seekerIds } } });
    await prisma.businessVisit.deleteMany({ where: { staffId: { in: staffIds } } });
    await prisma.businessAgreement.deleteMany({ where: { businessId: { in: businessIds } } });
    await prisma.business.deleteMany({ where: { id: { in: businessIds } } });
    await prisma.auditLog.deleteMany({ where: { actorId: { in: staffIds } } });
    await prisma.staff.deleteMany({ where: { id: { in: staffIds } } });
    await app.close();
  });

  it('the job seeker profile is for field agents only', async () => {
    await request(app.getHttpServer()).get('/field-work/job-seekers/JS-NONE/page').expect(401);
    await get(callAgent, '/field-work/job-seekers/JS-NONE/page').expect(403);
  });

  it('businesses: type and area, numbers, last visit (overdue revisit), the row state; needs action first', async () => {
    const unsigned = await makeBusiness(agent, { name: 'Unsigned Sweets', createdAt: new Date(NOON.getTime() - HOUR) });
    const noShifts = await makeBusiness(agent, { name: 'No Shift Hotel', verificationStatus: 'verified', createdAt: new Date(NOON.getTime() - 2 * HOUR) });
    await signAgreement(noShifts.id);
    const noVacancy = await makeBusiness(agent, { name: 'Shift Mess', verificationStatus: 'verified', createdAt: new Date(NOON.getTime() - 3 * HOUR) });
    await signAgreement(noVacancy.id);
    await prisma.businessShift.create({ data: { businessId: noVacancy.id, name: 'Day', startTime: '09:00', endTime: '18:00' } });
    await prisma.businessVisit.create({
      data: {
        id: randomUUID(), staffId: agent.id, latitude: 12.93, longitude: 77.63, purpose: 'shop_visit', businessId: unsigned.id, shopName: 'Unsigned Sweets',
        boardPhotoHash: randomUUID(), startedAt: new Date(NOON.getTime() - 3 * DAY), visitedAt: new Date(NOON.getTime() - 3 * DAY),
        outcome: 'interested_later', revisitOn: new Date('2026-11-20T00:00:00.000Z'), outcomeRecordedAt: new Date(NOON.getTime() - 3 * DAY),
      },
    });
    await makeBusiness(otherAgent, { name: 'Their Sweets' });

    const res = (await get(agent, '/field-work/businesses').expect(200)).body.results as Array<Record<string, unknown> & { name: string; row: Record<string, unknown> }>;
    const by = (name: string) => res.find((b) => b.name === name)!;
    expect(res.map((b) => b.name)).not.toContain('Their Sweets');
    expect(by('Unsigned Sweets')).toMatchObject({
      businessType: 'sweet_shop', locality: 'Bellandur', openVacancies: 0, candidatesShown: 0, interviewsToday: 0, canAct: true,
      lastVisitAt: new Date(NOON.getTime() - 3 * DAY).toISOString(), revisitOverdue: true,
      row: { status: 'agreement_not_sent', action: 'agreement_link', group: 'needs_action', waiting: false, done: false },
    });
    expect(by('No Shift Hotel').row).toMatchObject({ status: 'no_shifts', action: 'add_shifts' });
    expect(by('No Shift Hotel')).toMatchObject({ lastVisitAt: null, revisitOverdue: false });
    expect(by('Shift Mess').row).toMatchObject({ status: 'no_vacancy', action: 'add_vacancy' });
    // No rupee amounts on the list.
    expect(JSON.stringify(res)).not.toMatch(/Paise|amount/i);

    const page = (await get(agent, `/field-work/businesses/${noShifts.code}/page`).expect(200)).body;
    expect(page.row).toMatchObject({ status: 'no_shifts', action: 'add_shifts' });
  });

  it('job seekers: trade · area · experience, the status line and one button; paid shows the guarantee day and hits', async () => {
    const fresh = await makeSeeker(agent, { name: 'Fresh Ravi', createdAt: new Date(NOON.getTime() - HOUR) });
    const linked = await makeSeeker(agent, { name: 'Linked Suresh', createdAt: new Date(NOON.getTime() - 2 * HOUR) });
    await prisma.publicLink.create({
      data: { tokenHash: createHash('sha256').update(randomUUID()).digest('hex'), purpose: 'registration', subjectType: 'job_seeker', subjectId: linked.id, createdAt: NOON, expiresAt: new Date(NOON.getTime() + DAY) },
    });
    const waiting = await makeSeeker(agent, { name: 'Ramesh Waiting', createdAt: new Date(NOON.getTime() - 3 * HOUR) });
    await allConsents(waiting.id);
    // Rev 211: paid, and the ID check waits for the Team Lead ("paid, waiting for ID").
    await prisma.jobSeeker.update({ where: { id: waiting.id }, data: { photoStoragePath: `job-seekers/${waiting.id}/selfie.jpg`, photoTakenAt: NOON, status: 'paid_waiting_id', paymentReceivedAt: new Date(NOON.getTime() - HOUR) } });
    await prisma.identityVerification.create({ data: { jobSeekerId: waiting.id, method: 'pan', vendor: 'team_lead_photo', status: 'pending' } });
    const paid = await makeSeeker(agent, { name: 'Paid Lakshmi', status: 'active', hitCount: 2, paymentReceivedAt: new Date(NOON.getTime() - 4 * DAY), createdAt: new Date(NOON.getTime() - 5 * DAY) });
    const notMine = await makeSeeker(otherAgent, { name: 'Other Person' });

    const res = (await get(agent, '/field-work/job-seekers').expect(200)).body.results as Array<Record<string, unknown> & { id: string; row: Record<string, unknown> }>;
    const by = (id: string) => res.find((s) => s.id === id)!;
    expect(res.some((s) => s.id === notMine.id)).toBe(false);
    expect(by(fresh.id)).toMatchObject({ trade: 'Cook', yearsExperience: 1, locality: 'Bommanahalli', photoUrl: null, guarantee: null, row: { status: 'link_not_sent', action: 'registration_link' } });
    expect(by(linked.id).row).toMatchObject({ status: 'link_not_finished', action: 'registration_link', group: 'needs_action' });
    expect(by(waiting.id).row).toMatchObject({ status: 'waiting_tl', action: null, waiting: true, group: 'waiting_tl' });
    // The selfie is a short-lived signed link (memory storage in tests).
    expect(by(waiting.id).photoUrl).toEqual(expect.stringContaining(`job-seekers/${waiting.id}/selfie.jpg`));
    expect(by(paid.id)).toMatchObject({ hits: 2, guarantee: { day: 4, days: expect.any(Number) }, row: { status: 'active', done: true, group: 'active' } });
    // Needs action first.
    const groups = res.filter((s) => [fresh.id, linked.id, waiting.id, paid.id].includes(s.id)).map((s) => s.row.group);
    expect(groups).toEqual(['needs_action', 'needs_action', 'waiting_tl', 'active']);
    expect(JSON.stringify(res)).not.toMatch(/Paise|amount/i);
  });

  it('the job seeker profile: own only, with where he is stuck, details and history', async () => {
    const seeker = await makeSeeker(agent, { name: 'Profile Manju' });
    await allConsents(seeker.id);
    const page = (await get(agent, `/field-work/job-seekers/${seeker.code}/page`).expect(200)).body;
    expect(page).toMatchObject({
      id: seeker.id, code: seeker.code, name: 'Profile Manju', trade: 'Cook', yearsExperience: 1, locality: 'Bommanahalli', registeredByMe: true,
      stuck: { step: 'selfie', waitingForTeamLead: false, actions: ['registration_link'] },
      row: { status: 'link_not_sent', action: 'registration_link' },
      hits: 0, guarantee: null, interviews: [], placements: [],
    });
    expect(page.phoneLast4).toMatch(/\d{4}$/);
    expect(page.history.map((h: { kind: string }) => h.kind)).toEqual(expect.arrayContaining(['registered', 'consent']));
    // GET /field-work/job-seekers/:ref/page: another field agent gets 404
    await get(otherAgent, `/field-work/job-seekers/${seeker.id}/page`).expect(404);
  });
});
