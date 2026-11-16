import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcrypt';
import { createHash, randomUUID } from 'crypto';
import * as request from 'supertest';
import { AppModule } from '../../app.module';
import { PrismaService } from '../../common/prisma/prisma.service';
import { AttendanceClock } from '../attendance/attendance-clock';
import { MessagingService } from '../message/messaging.service';
import { FieldVisitClock } from '../field-visit/field-visit-clock';

const MIN = 60 * 1000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;
const SHOP = { latitude: 12.9316, longitude: 77.6301 };
/** 11:30 IST on 12 Nov 2026. */
const NOON = new Date('2026-11-12T06:00:00.000Z');

/** Fixed when `at` is set; otherwise the real time (links are stamped by the database). */
class TestClock {
  at: Date | null = NOON;
  now(): Date {
    return this.at ?? new Date();
  }
}

type Who = { id: string; role: string; code: string; name: string };

/**
 * Laboura Field redesign (Master Guide rev 188), the screens: Today (numbers, targets
 * bar, Needs you now), Today's work by IST day, my businesses with their next step,
 * the one business page (own vs view-only), the agreement screen and its resend,
 * draft vacancies sent by a field agent, my job seekers, the map's canAct and the
 * script's numbers from Settings.
 */
describe('Laboura Field redesign: Today, Today\'s work, businesses, agreement, job seekers', () => {
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

  const tokenFor = (s: Who) => jwt.sign({ sub: s.id, role: s.role, code: s.code, email: null });
  const get = (who: Who, path: string) => request(app.getHttpServer()).get(path).set('Authorization', `Bearer ${tokenFor(who)}`);
  const post = (who: Who, path: string, body: Record<string, unknown> = {}) =>
    request(app.getHttpServer()).post(path).set('Authorization', `Bearer ${tokenFor(who)}`).send(body);

  async function makeStaff(role: string, teamLeadId?: string): Promise<Who> {
    const n = staffIds.length;
    const staff = await prisma.staff.create({
      data: {
        code: `FD-${role.slice(0, 3).toUpperCase()}-${stamp}-${n}`,
        name: `Field ${role} ${n}`,
        email: `fd-${role}-${stamp}-${n}@laboura.local`,
        passwordHash: await bcrypt.hash('Field-Password-1', 4),
        role,
        status: 'active',
        teamLeadId: teamLeadId ?? null,
      },
    });
    staffIds.push(staff.id);
    return staff;
  }

  const next = () => {
    seq += 1;
    return String(seq).padStart(3, '0');
  };

  async function makeBusiness(owner: Who | null, fields: Partial<{
    name: string; verificationStatus: string; inPersonOnboardedAt: Date; createdAt: Date; contactLanguage: string; locality: string;
  }> = {}) {
    const n = next();
    const business = await prisma.business.create({
      data: {
        code: `BZ-FD${tag}${n}`,
        name: fields.name ?? `Field Shop ${n}`,
        phone: `+9196${tag}${n.slice(-2)}`,
        phoneVerified: true,
        latitude: SHOP.latitude,
        longitude: SHOP.longitude,
        locality: fields.locality ?? 'Jayanagar',
        accountAgentId: owner?.id ?? null,
        leadCreatedByStaffId: owner?.id ?? null,
        leadChannel: 'field_visit',
        verificationStatus: fields.verificationStatus ?? 'lead',
        inPersonOnboardedAt: fields.inPersonOnboardedAt ?? null,
        contactLanguage: fields.contactLanguage ?? 'kn',
        createdAt: fields.createdAt ?? NOON,
      },
    });
    businessIds.push(business.id);
    return business;
  }

  async function makeVacancy(businessId: string, by: Who, fields: Partial<{
    status: string; salaryMinPaise: number; shift: string | null; startDate: Date | null; confirmedAt: Date; createdAt: Date; tradeSkill: string;
  }> = {}) {
    return prisma.vacancy.create({
      data: {
        code: `VC-FD${tag}${next()}`,
        businessId,
        tradeSkill: fields.tradeSkill ?? 'Cook',
        headcount: 2,
        salaryMinPaise: fields.salaryMinPaise ?? 2500000,
        salaryMaxPaise: 3000000,
        salaryPeriod: 'monthly',
        shift: fields.shift === undefined ? 'day' : fields.shift,
        startDate: fields.startDate === undefined ? new Date('2026-11-20T00:00:00.000Z') : fields.startDate,
        status: fields.status ?? 'open',
        capturedByStaffId: by.id,
        confirmedAt: fields.confirmedAt ?? null,
        createdAt: fields.createdAt ?? NOON,
      },
    });
  }

  async function makeSeeker(by: Who | null, fields: Partial<{ name: string; createdAt: Date; paymentReceivedAt: Date }> = {}) {
    const n = next();
    const seeker = await prisma.jobSeeker.create({
      data: {
        code: `JS-FD${tag}${n}`,
        name: fields.name ?? `Seeker ${n} Kumar`,
        phone: `+9185${tag}${n.slice(-2)}`,
        minSalary: 1500000,
        maxSalary: 2000000,
        preferredCallWindowStart: '09:00',
        preferredCallWindowEnd: '21:00',
        registeredByStaffId: by?.id ?? null,
        paymentReceivedAt: fields.paymentReceivedAt ?? null,
        createdAt: fields.createdAt ?? NOON,
      },
    });
    seekerIds.push(seeker.id);
    return seeker;
  }

  async function makeInterview(vacancyId: string, businessId: string, seekerId: string, by: Who, fields: Partial<{
    startsAt: Date; status: string; agentWillAttend: boolean; createdAt: Date; candidateArrivedAt: Date;
  }> = {}) {
    const startsAt = fields.startsAt ?? new Date(NOON.getTime() + 2 * HOUR);
    const slot = await prisma.vacancyInterviewSlot.create({ data: { vacancyId, startsAt, endsAt: new Date(startsAt.getTime() + HOUR) } });
    return prisma.interview.create({
      data: {
        code: `IV-FD${tag}${next()}`,
        vacancyId, businessId, jobSeekerId: seekerId, vacancyInterviewSlotId: slot.id,
        slotStartsAt: slot.startsAt, slotEndsAt: slot.endsAt, proposedByStaffId: by.id, suitabilitySnapshot: {},
        status: fields.status ?? 'confirmed', offerSentAt: NOON, replyDueAt: NOON, resultDueAt: slot.endsAt,
        agentWillAttend: fields.agentWillAttend ?? false,
        candidateArrivedAt: fields.candidateArrivedAt ?? null,
        candidateArrivedByStaffId: fields.candidateArrivedAt ? by.id : null,
        createdAt: fields.createdAt ?? NOON,
      },
    });
  }

  function makeLink(subjectId: string, purpose: 'business_agreement' | 'registration', createdAt: Date, expiresAt: Date, subjectType = 'business') {
    return prisma.publicLink.create({
      data: { tokenHash: createHash('sha256').update(randomUUID()).digest('hex'), purpose, subjectType, subjectId, createdAt, expiresAt },
    });
  }

  function signAgreement(businessId: string, version = '1.1') {
    return prisma.businessAgreement.create({
      data: {
        businessId, version, termsHash: 'h', noBypassMonths: 12, noBypassPenaltyPercent: 50, feePercent: 50, gstPercent: 18,
        signedName: 'Owner Name', signedPhone: '+919999999999', otpRequestId: 'otp', signedAt: new Date(NOON.getTime() - HOUR), documentStoragePath: 'x',
      },
    });
  }

  function makeVisit(by: Who, fields: Partial<{
    visitedAt: Date; outcome: string; revisitOn: Date; businessId: string; selfie: boolean; endedAt: Date; shopName: string;
  }> = {}) {
    const visitedAt = fields.visitedAt ?? NOON;
    return prisma.businessVisit.create({
      data: {
        id: randomUUID(), staffId: by.id, latitude: SHOP.latitude, longitude: SHOP.longitude, purpose: 'shop_visit',
        businessId: fields.businessId ?? null, shopName: fields.shopName ?? 'Prospect', boardPhotoHash: randomUUID(),
        selfieHash: fields.selfie ? randomUUID() : null, selfieUrl: fields.selfie ? 'x' : null, startedAt: visitedAt, visitedAt,
        endedAt: fields.endedAt ?? null, outcome: fields.outcome ?? null, revisitOn: fields.revisitOn ?? null,
        outcomeRecordedAt: fields.outcome ? visitedAt : null,
      },
    });
  }

  let lead: Who;
  let agent: Who;
  let otherAgent: Who;
  let callAgent: Who;

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
    lead = await makeStaff('team_lead');
    agent = await makeStaff('field_agent', lead.id);
    otherAgent = await makeStaff('field_agent', lead.id);
    callAgent = await makeStaff('call_agent', lead.id);
  }, 120000);

  afterAll(async () => {
    if (!prisma) return;
    await prisma.placement.deleteMany({ where: { businessId: { in: businessIds } } });
    await prisma.candidateIntroduction.deleteMany({ where: { businessId: { in: businessIds } } });
    await prisma.interview.deleteMany({ where: { businessId: { in: businessIds } } });
    await prisma.statusHistory.deleteMany({ where: { OR: [{ subjectId: { in: businessIds } }, { changedByStaffId: { in: staffIds } }] } });
    await prisma.vacancy.deleteMany({ where: { businessId: { in: businessIds } } });
    await prisma.consent.deleteMany({ where: { subjectId: { in: seekerIds } } });
    await prisma.publicLink.deleteMany({ where: { subjectId: { in: [...businessIds, ...seekerIds] } } });
    await prisma.identityVerification.deleteMany({ where: { jobSeekerId: { in: seekerIds } } });
    await prisma.jobSeeker.deleteMany({ where: { id: { in: seekerIds } } });
    await prisma.referral.deleteMany({ where: { registeredByStaffId: { in: staffIds } } });
    await prisma.followUpTask.deleteMany({ where: { assignedStaffId: { in: staffIds } } });
    await prisma.target.deleteMany({ where: { staffId: { in: staffIds } } });
    await prisma.businessVisit.deleteMany({ where: { staffId: { in: staffIds } } });
    await prisma.businessAgreement.deleteMany({ where: { businessId: { in: businessIds } } });
    await prisma.messageLog.deleteMany({ where: { subjectId: { in: businessIds } } });
    await prisma.business.deleteMany({ where: { id: { in: businessIds } } });
    await prisma.auditLog.deleteMany({ where: { actorId: { in: staffIds } } });
    await prisma.attendanceSegment.deleteMany({ where: { day: { staffId: { in: staffIds } } } });
    await prisma.attendanceDay.deleteMany({ where: { staffId: { in: staffIds } } });
    await prisma.staff.updateMany({ where: { id: { in: staffIds } }, data: { teamLeadId: null } });
    await prisma.staff.deleteMany({ where: { id: { in: staffIds } } });
    await app.close();
  });

  it('is for field agents only', async () => {
    await request(app.getHttpServer()).get('/field-work/today').expect(401);
    for (const who of [callAgent, lead]) {
      for (const path of ['/field-work/today', '/field-work/day', '/field-work/businesses', '/field-work/businesses/BZ-NONE/page',
        '/field-work/businesses/BZ-NONE/agreement', '/field-work/job-seekers']) {
        await get(who, path).expect(403);
      }
      await post(who, '/field-work/businesses/BZ-NONE/agreement-link').expect(403);
    }
  });

  it("Today's work: an IST day (23:59 IST belongs to that day, 00:00 IST to the next), mine only, newest first, dates checked", async () => {
    clock.at = new Date('2026-11-12T10:00:00.000Z'); // 15:30 IST
    const late = await makeVisit(agent, { visitedAt: new Date('2026-11-11T18:29:59.000Z'), outcome: 'not_interested', shopName: 'Late Shop' });
    const early = await makeVisit(agent, { visitedAt: new Date('2026-11-11T18:30:00.000Z'), shopName: 'Early Shop' });
    const theirs = await makeVisit(otherAgent, { visitedAt: new Date('2026-11-12T05:00:00.000Z'), shopName: 'Their Shop' });
    const seeker = await makeSeeker(agent, { createdAt: new Date('2026-11-12T04:00:00.000Z') });
    await prisma.referral.create({
      data: {
        code: `RF-FD${tag}`, name: 'Partner One', phone: `+9184${tag}01`, whatsappPhone: `+9184${tag}01`, locality: 'BTM',
        registeredByStaffId: agent.id, createdAt: new Date('2026-11-12T04:30:00.000Z'),
      },
    });

    const day11 = (await get(agent, '/field-work/day?date=2026-11-11').expect(200)).body;
    expect(day11).toMatchObject({ date: '2026-11-11', isToday: false });
    expect(day11.items.map((i: { id: string }) => i.id)).toContain(`visit:${late.id}`);
    expect(day11.items.map((i: { id: string }) => i.id)).not.toContain(`visit:${early.id}`);
    expect(day11.items.find((i: { id: string }) => i.id === `visit:${late.id}`)).toMatchObject({
      type: 'visit', title: 'Late Shop', status: 'not_interested', target: { type: 'visit', id: late.id },
    });

    const today = (await get(agent, '/field-work/day').expect(200)).body;
    expect(today).toMatchObject({ date: '2026-11-12', isToday: true });
    const ids = today.items.map((i: { id: string }) => i.id);
    expect(ids).toEqual(expect.arrayContaining([`visit:${early.id}`, `job_seeker:${seeker.id}`]));
    expect(ids).not.toContain(`visit:${theirs.id}`);
    expect(today.items.find((i: { id: string }) => i.id === `visit:${early.id}`).status).toBe('unfinished');
    expect(today.items.some((i: { type: string; title: string }) => i.type === 'referral_registered' && i.title === 'Partner One')).toBe(true);
    const times = today.items.map((i: { at: string }) => i.at);
    expect([...times].sort().reverse()).toEqual(times);
    expect(today.counts.visit).toBeGreaterThanOrEqual(1);

    const bad = async (date: string, code: string) => expect((await get(agent, `/field-work/day?date=${date}`).expect(400)).body.code).toBe(code);
    await bad('12-11-2026', 'DATE_INVALID');
    await bad('2026-02-30', 'DATE_INVALID');
    await bad('2026-11-13', 'DATE_IN_FUTURE');
    await bad('2026-08-13', 'DATE_TOO_OLD');
    await get(agent, '/field-work/day?date=2026-08-14').expect(200);
  });

  it('Today: numbers from records (onboarded counts a registration from a visit), targets bar and every Needs-you-now kind, most urgent first', async () => {
    clock.at = NOON;
    const dayStart = new Date('2026-11-11T18:30:00.000Z');
    // Agreement waiting: none sent, and an expired link (expired first).
    const notSent = await makeBusiness(agent, { name: 'No Link Bakery', createdAt: new Date(NOON.getTime() - 2 * HOUR) });
    const expired = await makeBusiness(agent, { name: 'Expired Link Stores', createdAt: new Date(NOON.getTime() - 2 * DAY) });
    await makeLink(expired.id, 'business_agreement', new Date(NOON.getTime() - 30 * HOUR), new Date(NOON.getTime() - 6 * HOUR));
    // A signed, in-person onboarded business with a draft, a waiting and an open vacancy.
    const ready = await makeBusiness(agent, { name: 'Ready Hotel', verificationStatus: 'pending_tl_check', inPersonOnboardedAt: new Date(NOON.getTime() - HOUR), createdAt: new Date(NOON.getTime() - 3 * DAY) });
    await signAgreement(ready.id);
    const draft = await makeVacancy(ready.id, agent, { status: 'draft' });
    const waiting = await makeVacancy(ready.id, agent, { status: 'awaiting_confirmation' });
    const open = await makeVacancy(ready.id, agent, { status: 'open', confirmedAt: new Date(NOON.getTime() - 30 * MIN) });
    // Another agent's business never shows.
    const theirs = await makeBusiness(otherAgent, { name: 'Their Business' });
    // An interview today I attend, one I attended (arrival marked), a joining tomorrow.
    const seeker = await makeSeeker(agent, { name: 'Ramesh Gowda', createdAt: new Date(NOON.getTime() - 5 * DAY) });
    const interview = await makeInterview(open.id, ready.id, seeker.id, agent, { agentWillAttend: true });
    const seeker2 = await makeSeeker(null, { createdAt: new Date(NOON.getTime() - 5 * DAY) });
    await makeInterview(open.id, ready.id, seeker2.id, agent, {
      startsAt: new Date(NOON.getTime() - HOUR), candidateArrivedAt: new Date(NOON.getTime() - 50 * MIN), createdAt: new Date(NOON.getTime() - 3 * DAY),
    });
    const placement = await prisma.placement.create({
      data: {
        code: `PL-FD${tag}`, vacancyId: open.id, jobSeekerId: seeker.id, businessId: ready.id, placementFee: 100, gstAmount: 18,
        status: 'confirmed', joiningDate: new Date(NOON.getTime() + DAY), createdByStaffId: agent.id,
      },
    });
    // A revisit due today, an unfinished onboarding (selfie, no business), a follow-up task.
    const revisit = await makeVisit(agent, { visitedAt: new Date(NOON.getTime() - 3 * DAY), outcome: 'owner_not_there', revisitOn: new Date('2026-11-12T00:00:00.000Z'), shopName: 'Come Back Shop' });
    const unfinished = await makeVisit(agent, { visitedAt: new Date(NOON.getTime() - HOUR), selfie: true, endedAt: new Date(NOON.getTime() - 50 * MIN), shopName: 'Half Done Shop' });
    const task = await prisma.followUpTask.create({
      data: { code: `FU-FD${tag}`, kind: 'placement_check_in_day_7', subjectType: 'job_seeker', subjectId: seeker.id, relatedType: 'placement', relatedId: placement.id, dueAt: NOON, assignedStaffId: agent.id },
    });
    // Today's numbers: a business registered from a visit today, a vacancy confirmed, a candidate shown.
    await makeBusiness(agent, { name: 'Registered Today', createdAt: new Date(dayStart.getTime() + HOUR) });
    await prisma.candidateIntroduction.create({
      data: { businessId: ready.id, vacancyId: waiting.id, jobSeekerId: seeker.id, shownByStaffId: agent.id, shownAt: NOON, rank: 1, score: 1, matchReasons: {}, channel: 'in_person' },
    });
    await prisma.target.create({ data: { staffId: agent.id, year: 2026, month: 11, placementsClosed: 10, createdById: lead.id } });

    const body = (await get(agent, '/field-work/today').expect(200)).body;
    expect(body).toMatchObject({ date: '2026-11-12', targets: { year: 2026, month: 11, placementsClosed: 0, placementsTarget: 10 } });
    expect(body.attendance).not.toBeNull();
    expect(body.numbers).toMatchObject({ vacanciesConfirmed: 1, candidatesShown: 1, interviewsAttended: 1 });
    expect(body.numbers.onboarded).toBeGreaterThanOrEqual(1);
    const items = body.needsYou as Array<{ id: string; kind: string; target: Record<string, unknown>; agreement?: { state: string } }>;
    const byId = (id: string) => items.find((i) => i.id === id);
    expect(byId(`interview_today:${interview.id}`)).toMatchObject({ kind: 'interview_today', target: { type: 'interview', id: interview.id, step: 'attend' }, interview: { candidateName: 'Ramesh G.' } });
    expect(byId(`visit_unfinished:${unfinished.id}`)).toMatchObject({ target: { type: 'visit', step: 'continue_business_form' } });
    expect(byId(`agreement_waiting:${notSent.id}`)).toMatchObject({ agreement: { state: 'not_sent' }, target: { type: 'business', step: 'agreement' } });
    expect(byId(`agreement_waiting:${expired.id}`)?.agreement?.state).toBe('link_expired');
    expect(byId(`vacancy_awaiting_owner:${waiting.id}`)).toMatchObject({ target: { type: 'vacancy', step: 'enter_code', businessId: ready.id } });
    expect(byId(`vacancy_draft:${draft.id}`)).toMatchObject({ target: { type: 'vacancy', step: 'send_to_owner', businessId: ready.id } });
    expect(byId(`ready_show_candidates:${open.id}`)).toMatchObject({ target: { type: 'business', id: ready.id, step: 'show_candidates', vacancyId: open.id } });
    expect(byId(`joining_due:${placement.id}`)).toMatchObject({ due: 'tomorrow', target: { type: 'placement', step: 'confirm_joining' } });
    expect(byId(`revisit_due:${revisit.id}`)).toMatchObject({ due: 'today', target: { type: 'revisit', id: revisit.id, step: 'start_visit', businessId: null } });
    expect(byId(`followup_task:${task.id}`)).toMatchObject({ target: { type: 'followup', relatedType: 'placement', relatedId: placement.id } });
    expect(items.some((i) => i.id === `agreement_waiting:${theirs.id}`)).toBe(false);
    expect(items.some((i) => i.id === `agreement_waiting:${ready.id}`)).toBe(false);
    // Most urgent first; expired agreement links before unsent ones.
    const order = ['interview_today', 'visit_unfinished', 'agreement_waiting', 'vacancy_awaiting_owner', 'vacancy_draft', 'ready_show_candidates', 'joining_due', 'revisit_due', 'followup_task'];
    const ranks = items.map((i) => order.indexOf(i.kind));
    expect([...ranks].sort((a, b) => a - b)).toEqual(ranks);
    expect(items.findIndex((i) => i.id === `agreement_waiting:${expired.id}`)).toBeLessThan(items.findIndex((i) => i.id === `agreement_waiting:${notSent.id}`));
  });

  it('my businesses: mine only, searchable, each with its next step', async () => {
    const list = (await get(agent, '/field-work/businesses').expect(200)).body.results as Array<{ name: string; nextStep: { kind: string; agreementState?: string } }>;
    const names = list.map((b) => b.name);
    expect(names).toEqual(expect.arrayContaining(['No Link Bakery', 'Expired Link Stores', 'Ready Hotel']));
    expect(names).not.toContain('Their Business');
    expect(list.find((b) => b.name === 'Ready Hotel')!.nextStep).toMatchObject({ kind: 'vacancy_to_confirm' });
    expect(list.find((b) => b.name === 'Expired Link Stores')!.nextStep).toEqual({ kind: 'agreement_waiting', agreementState: 'link_expired' });
    const searched = (await get(agent, '/field-work/businesses?q=ready').expect(200)).body.results;
    expect(searched.map((b: { name: string }) => b.name)).toEqual(['Ready Hotel']);
  });

  it('the one business page: checklist and each vacancy\'s next step for mine; view-only for another agent', async () => {
    const ready = await prisma.business.findFirstOrThrow({ where: { name: 'Ready Hotel', id: { in: businessIds } } });
    const low = await makeVacancy(ready.id, agent, { status: 'draft', salaryMinPaise: 100000, shift: null });
    const page = (await get(agent, `/field-work/businesses/${ready.code}/page`).expect(200)).body;
    expect(page).toMatchObject({
      id: ready.id, canAct: true, isMine: true,
      accountAgent: { id: agent.id, isMe: true },
      status: { verificationStatus: 'pending_tl_check', canShowCandidates: true, candidatesHiddenReason: null },
      checklist: {
        registered: { done: true },
        ownerPhoneVerified: { done: true },
        agreement: { state: 'signed', signedByName: 'Owner Name', canResend: false },
        teamLeadCheck: { state: 'waiting' },
      },
      actions: { recordVisit: true, callOwner: true, addVacancy: true, resendAgreement: false, showCandidates: true },
    });
    expect(page.contact.phoneLast4).toMatch(/^\d{4}$|^\*{6}\d{4}$/);
    const byStatus = (status: string) => page.vacancies.filter((v: { status: string }) => v.status === status);
    expect(byStatus('awaiting_confirmation')[0].nextStep).toMatchObject({ kind: 'enter_code', sentToLast4: expect.any(String) });
    expect(byStatus('open')[0].nextStep).toEqual({ kind: 'show_candidates', shown: 0 });
    const lowRow = page.vacancies.find((v: { id: string }) => v.id === low.id);
    expect(lowRow.nextStep).toMatchObject({ kind: 'send_to_owner', missing: ['shift'], needsMinimumWageTick: true });
    expect(lowRow.nextStep.legalMinimumPaise).toBeGreaterThan(100000);
    expect(page.candidates).toMatchObject({ shown: 1, shownByMe: 1, interviews: { total: 2, today: 2 } });

    // GET /field-work/businesses/:ref/page: another agent gets the view-only page
    const viewOnly = (await get(otherAgent, `/field-work/businesses/${ready.id}/page`).expect(200)).body;
    expect(viewOnly).toMatchObject({
      canAct: false, isMine: false, contact: null, nextStep: { kind: 'none' },
      actions: { recordVisit: false, callOwner: false, addVacancy: false, resendAgreement: false, showCandidates: false },
    });
    expect(viewOnly.checklist.agreement).toEqual({ state: 'signed', signedAt: expect.any(String) });
    expect(viewOnly.vacancies.every((v: { nextStep: { kind: string }; contactPhoneLast4: unknown }) => v.nextStep.kind === 'none' && v.contactPhoneLast4 === null)).toBe(true);
    await get(agent, '/field-work/businesses/BZ-NOPE0/page').expect(404);
  });

  it('agreement screen and Resend: own business only, rate-limited, never once signed, a failed SMS is an error', async () => {
    clock.at = null; // links are stamped with the database's time
    const shop = await makeBusiness(agent, { name: 'Resend Shop', createdAt: new Date() });
    // GET /field-work/businesses/:ref/agreement: another field agent is refused (403)
    expect((await get(otherAgent, `/field-work/businesses/${shop.id}/agreement`).expect(403)).body.code).toBe('NOT_YOUR_BUSINESS');
    // POST /field-work/businesses/:ref/agreement-link: another field agent is refused (403)
    expect((await post(otherAgent, `/field-work/businesses/${shop.id}/agreement-link`).expect(403)).body.code).toBe('NOT_YOUR_BUSINESS');
    expect((await get(agent, `/field-work/businesses/${shop.id}/agreement`).expect(200)).body).toMatchObject({ state: 'not_sent', canResend: true });

    const sent = await post(agent, `/field-work/businesses/${shop.code}/agreement-link`, { language: 'en' }).expect(201);
    expect(sent.body).toMatchObject({ success: true, sentToLast4: expect.any(String) });
    expect(sent.body.token).toBeUndefined();
    expect(new Date(sent.body.linkExpiresAt).getTime() - Date.now()).toBeGreaterThan(23 * HOUR);
    const status = (await get(agent, `/field-work/businesses/${shop.id}/agreement`).expect(200)).body;
    expect(status).toMatchObject({ state: 'link_sent', canResend: false, canShowCandidates: false, candidatesHiddenReason: 'agreement_not_signed' });
    expect(status.resendAvailableAt).not.toBeNull();
    expect((await post(agent, `/field-work/businesses/${shop.id}/agreement-link`).expect(429)).body.code).toBe('AGREEMENT_RESEND_TOO_SOON');

    // Five links in 24 hours is the most.
    await prisma.publicLink.updateMany({ where: { subjectId: shop.id }, data: { createdAt: new Date(Date.now() - 2 * MIN) } });
    for (let h = 2; h <= 5; h += 1) await makeLink(shop.id, 'business_agreement', new Date(Date.now() - h * HOUR), new Date(Date.now() + HOUR));
    const limited = await post(agent, `/field-work/businesses/${shop.id}/agreement-link`).expect(429);
    expect(limited.body).toMatchObject({ code: 'AGREEMENT_RESEND_LIMIT', retryAt: expect.any(String) });

    // A failed SMS: nothing counts, the error says so.
    const other = await makeBusiness(agent, { name: 'SMS Fail Shop', createdAt: new Date() });
    const messaging = app.get(MessagingService);
    const spy = jest.spyOn(messaging, 'send').mockResolvedValueOnce({ status: 'failed' } as Awaited<ReturnType<MessagingService['send']>>);
    expect((await post(agent, `/field-work/businesses/${other.id}/agreement-link`).expect(502)).body.code).toBe('AGREEMENT_SMS_FAILED');
    spy.mockRestore();
    expect(await prisma.publicLink.count({ where: { subjectId: other.id, revokedAt: null } })).toBe(0);
    await post(agent, `/field-work/businesses/${other.id}/agreement-link`).expect(201);

    // The office route still issues links and now says whether the SMS went.
    const office = await post(agent, `/businesses/${other.id}/agreement-links`, { language: 'en' }).expect(201);
    expect(office.body).toMatchObject({ success: true, smsSent: true });
    expect(office.body.token).toBeUndefined();
    expect(office.body.linkId).toBeUndefined();

    // Signed (current version): no resend.
    await signAgreement(shop.id, '1.1');
    expect((await post(agent, `/field-work/businesses/${shop.id}/agreement-link`).expect(409)).body.code).toBe('AGREEMENT_ALREADY_SIGNED');
    expect((await get(agent, `/field-work/businesses/${shop.id}/agreement`).expect(200)).body).toMatchObject({ state: 'signed', canResend: false, resendAvailableAt: null });
    clock.at = NOON;
  });

  it('a field agent sends his own draft vacancy to the owner (Check and send); errors carry codes', async () => {
    const shop = await makeBusiness(agent, { name: 'Draft Shop' });
    const good = await makeVacancy(shop.id, agent, { status: 'draft' });
    const incomplete = await makeVacancy(shop.id, agent, { status: 'draft', shift: null, startDate: null });
    const low = await makeVacancy(shop.id, agent, { status: 'draft', salaryMinPaise: 100000 });
    await post(otherAgent, `/vacancies/${good.id}/submit-for-confirmation`).expect(403);
    const sent = await post(agent, `/vacancies/${good.id}/submit-for-confirmation`).expect(201);
    expect(sent.body).toMatchObject({ id: good.id, status: 'awaiting_confirmation', confirmation: { otpRequestId: expect.any(String), sentToLast4: expect.any(String) } });
    expect((await post(agent, `/vacancies/${good.id}/submit-for-confirmation`).expect(400)).body).toMatchObject({ code: 'NOT_A_DRAFT', status: 'awaiting_confirmation' });
    expect((await post(agent, `/vacancies/${incomplete.id}/submit-for-confirmation`).expect(400)).body).toMatchObject({ code: 'DRAFT_INCOMPLETE', missing: ['shift', 'startDate'] });
    expect((await post(agent, `/vacancies/${low.id}/submit-for-confirmation`).expect(400)).body).toMatchObject({ code: 'MINIMUM_WAGE_TICK_REQUIRED', legalMinimumPaise: expect.any(Number) });
    await post(agent, `/vacancies/${low.id}/submit-for-confirmation`, { ownerToldMinimumWage: true }).expect(201);
    // The existing confirmation steps then work.
    await post(agent, `/vacancies/${good.id}/confirmation/send-code`).expect(201);
    expect((await post(agent, `/vacancies/${good.id}/confirmation-link`).expect(201)).body).toMatchObject({ success: true });
  });

  it('my job seekers: mine only, where each stands, searchable by name or exactly the last 4 digits', async () => {
    clock.at = NOON;
    const paid = await makeSeeker(agent, { name: 'Lakshmi Reddy', createdAt: new Date(NOON.getTime() - 2 * DAY), paymentReceivedAt: new Date(NOON.getTime() - DAY) });
    await makeLink(paid.id, 'registration', new Date(NOON.getTime() - 2 * DAY), new Date(NOON.getTime() + DAY), 'job_seeker');
    await prisma.consent.create({
      data: { subjectType: 'job_seeker', subjectId: paid.id, purpose: 'job_matching', granted: true, noticeVersion: '1.2', language: 'en', method: 'sms_link', grantedAt: new Date(NOON.getTime() - 2 * DAY + HOUR) },
    });
    await prisma.identityVerification.create({ data: { jobSeekerId: paid.id, method: 'pan', vendor: 'team_lead_check', status: 'pending' } });
    const fresh = await makeSeeker(agent, { name: 'Fresh Person', createdAt: new Date(NOON.getTime() - HOUR) });
    const notMine = await makeSeeker(otherAgent, { name: 'Lakshmi Other' });

    const list = (await get(agent, '/field-work/job-seekers').expect(200)).body.results as Array<{ id: string; stage: string; steps: Record<string, unknown>; phoneLast4: string }>;
    expect(list.some((s) => s.id === notMine.id)).toBe(false);
    expect(list.find((s) => s.id === paid.id)).toMatchObject({
      stage: 'paid',
      steps: { linkSentAt: expect.any(String), consentGivenAt: expect.any(String), paidAt: expect.any(String), idCheckedAt: null, idCheckPending: true, interviews: 0, placed: false },
    });
    expect(list.find((s) => s.id === fresh.id)).toMatchObject({ stage: 'registered' });
    const last4 = paid.phone.slice(-4);
    const byPhone = (await get(agent, `/field-work/job-seekers?q=${last4}`).expect(200)).body.results;
    expect(byPhone.map((s: { id: string }) => s.id)).toEqual([paid.id]);
    expect((await get(agent, `/field-work/job-seekers?q=${paid.phone.slice(-5)}`).expect(200)).body.results).toEqual([]);
    expect((await get(agent, '/field-work/job-seekers?q=lakshmi').expect(200)).body.results.map((s: { id: string }) => s.id)).toEqual([paid.id]);
  });

  it('map rows say whether the agent may act; the script numbers come from Settings', async () => {
    clock.at = NOON;
    const map = (await get(agent, `/field-work/map?lat=${SHOP.latitude}&lng=${SHOP.longitude}`).expect(200)).body;
    const mine = map.shops.find((s: { name: string }) => s.name === 'Ready Hotel');
    const theirs = map.shops.find((s: { name: string }) => s.name === 'Their Business');
    expect(mine).toMatchObject({ isMine: true, canAct: true });
    expect(theirs).toMatchObject({ isMine: false, canAct: false });
    const settings = (await get(agent, '/screens/field-selling/settings').expect(200)).body;
    expect(settings).toMatchObject({
      feePercent: expect.any(Number), gstPercent: expect.any(Number), maxFreeReplacements: expect.any(Number),
      replacementWindowDays: expect.any(Number), noBypassMonths: expect.any(Number), noBypassPenaltyPercent: expect.any(Number),
      jobSeekerGuaranteeDays: expect.any(Number),
    });
  });
});
