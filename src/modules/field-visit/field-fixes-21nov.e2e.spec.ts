import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcrypt';
import { randomUUID } from 'crypto';
import * as request from 'supertest';
import { AppModule } from '../../app.module';
import { PrismaService } from '../../common/prisma/prisma.service';
import { AttendanceClock } from '../attendance/attendance-clock';
import { AttendanceService } from '../attendance/attendance.service';
import { BusinessClock } from '../business/business-clock';
import { businessCandidateAccess } from '../business/business-candidate-access';
import { BusinessVerificationService } from '../business/business-verification.service';
import { CallClock } from '../call/call-clock';
import { ConsentClock } from '../consent/consent-clock';
import { NotificationClock } from '../notification/notification-clock';
import { encryptCallRoutingPhone } from '../staff/call-routing-key';
import { FieldVisitClock } from './field-visit-clock';
import { FieldVisitService } from './field-visit.service';
import { FieldHandoverService } from './field-handover.service';
import { OtpService } from '../../common/otp/otp.service';
import { MockOtpProvider } from '../../common/otp/mock-otp.provider';

/** 11:30 IST, Monday 23 Nov 2026 (inside calling hours). */
const START = new Date('2026-11-23T06:00:00.000Z');
const TODAY = '2026-11-23';
const TOMORROW = '2026-11-24';
const MIN = 60 * 1000;
const SHOP = { latitude: 12.9216, longitude: 77.6201 };
const FIELD_LOGIN = { latitude: 12.9216, longitude: 77.6201 };

class FrozenClock {
  at = START;
  now(): Date {
    return this.at;
  }
}

type Who = { id: string; role: string; code: string };

/**
 * Laboura Field fixes decided 21 Nov (Master Guide rev 202, "Call agent and
 * field agent fixes"), server side: B1 Team Leads assign customer-app
 * verification visits; B2 calls while On visit and the calling phone in
 * Field; verification job cards, "Update the pin" and no double row for a
 * revisit of a verification visit; follow-up tasks; arrival while offered;
 * shop time until the onboarding or verification ends; field-verified
 * businesses show candidates; the similar-shop check; the leave handover and
 * reassign; the Field bell; the come-back time.
 */
describe('Laboura Field fixes of 21 Nov (server)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let jwt: JwtService;
  const clock = new FrozenClock();
  const stamp = Date.now();
  const staffIds: string[] = [];
  const businessIds: string[] = [];
  const seekerIds: string[] = [];
  let photoCounter = 0;

  const tokenFor = (s: Who) => jwt.sign({ sub: s.id, role: s.role, code: s.code, email: null });
  const authOf = (s: Who) => ({ Authorization: `Bearer ${tokenFor(s)}` });
  const http = () => request(app.getHttpServer());

  async function makeStaff(role: string, teamLeadId?: string, city = 'Bengaluru') {
    const n = staffIds.length;
    const staff = await prisma.staff.create({
      data: {
        code: `F21-${role.slice(0, 3).toUpperCase()}-${stamp}-${n}`,
        name: `Fix21 ${role} ${n}`,
        email: `f21-${role}-${stamp}-${n}@laboura.local`,
        passwordHash: await bcrypt.hash('Visit-Password-1', 4),
        role,
        status: 'active',
        city,
        teamLeadId: teamLeadId ?? null,
      },
    });
    staffIds.push(staff.id);
    return staff;
  }

  async function makeBusiness(fields: {
    suffix: string; accountAgentId?: string | null; leadCreatedByStaffId?: string | null; verificationStatus?: string;
    name?: string; latitude?: number; longitude?: number; address?: string | null; ownerName?: string | null;
  }) {
    const business = await prisma.business.create({
      data: {
        code: `BZ-F21${String(stamp).slice(-6)}${fields.suffix}`,
        name: fields.name ?? `Fix21 Shop ${fields.suffix}`,
        phone: `+9196${String(stamp).slice(-6)}${fields.suffix.padStart(2, '0').slice(-2)}`,
        latitude: fields.latitude ?? SHOP.latitude,
        longitude: fields.longitude ?? SHOP.longitude,
        address: fields.address ?? null,
        ownerName: fields.ownerName ?? null,
        locality: 'BTM Layout',
        accountAgentId: fields.accountAgentId ?? null,
        leadCreatedByStaffId: fields.leadCreatedByStaffId ?? null,
        verificationStatus: fields.verificationStatus ?? 'lead',
      },
    });
    businessIds.push(business.id);
    return business;
  }

  function photo(): Buffer {
    photoCounter += 1;
    return Buffer.from(`jpeg-fix21-${stamp}-${photoCounter}-${randomUUID()}`);
  }

  function startVisit(who: Who, fields: Record<string, string | number>) {
    let req = http().post('/field-visits').set(authOf(who));
    const withDefaults: Record<string, string | number> = {
      latitude: SHOP.latitude, longitude: SHOP.longitude, accuracy: 8, source: 'live_camera', takenAt: clock.at.toISOString(), ...fields,
    };
    for (const [k, v] of Object.entries(withDefaults)) req = req.field(k, String(v));
    return req.attach('photo', photo(), { filename: 'shop.jpg', contentType: 'image/jpeg' });
  }

  function selfie(who: Who, id: string) {
    return http()
      .post(`/field-visits/${id}/proof`)
      .set(authOf(who))
      .field('latitude', String(SHOP.latitude + 0.00003))
      .field('longitude', String(SHOP.longitude))
      .field('accuracy', '6')
      .field('source', 'live_camera')
      .field('takenAt', clock.at.toISOString())
      .attach('photo', photo(), { filename: 'selfie.jpg', contentType: 'image/jpeg' });
  }

  async function statusOf(staffId: string) {
    return (await app.get(AttendanceService).today(staffId)).status;
  }

  let leadA: Awaited<ReturnType<typeof makeStaff>>;
  let leadB: Awaited<ReturnType<typeof makeStaff>>;
  let fa1: Awaited<ReturnType<typeof makeStaff>>;
  let fa2: Awaited<ReturnType<typeof makeStaff>>;
  let fa3: Awaited<ReturnType<typeof makeStaff>>;
  let fb1: Awaited<ReturnType<typeof makeStaff>>;

  beforeAll(async () => {
    const moduleRef: TestingModule = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(FieldVisitClock).useValue(clock)
      .overrideProvider(AttendanceClock).useValue(clock)
      .overrideProvider(BusinessClock).useValue(clock)
      .overrideProvider(CallClock).useValue(clock)
      .overrideProvider(ConsentClock).useValue(clock)
      .overrideProvider(NotificationClock).useValue(clock)
      .compile();
    app = moduleRef.createNestApplication();
    await app.init();
    prisma = app.get(PrismaService);
    jwt = app.get(JwtService);
    leadA = await makeStaff('team_lead');
    leadB = await makeStaff('team_lead');
    fa1 = await makeStaff('field_agent', leadA.id);
    fa2 = await makeStaff('field_agent', leadA.id);
    fa3 = await makeStaff('field_agent', leadA.id);
    fb1 = await makeStaff('field_agent', leadB.id);
    // fa3 is on approved leave today and tomorrow.
    await prisma.leaveRequest.create({
      data: {
        staffId: fa3.id, kind: 'casual', fromDate: new Date(`${TODAY}T00:00:00.000Z`), toDate: new Date(`${TOMORROW}T00:00:00.000Z`),
        days: 2, reason: 'Family function', status: 'approved', routedToRole: 'team_lead', routedToStaffId: leadA.id, routeReason: 'team_lead',
      },
    });
  }, 180000);

  afterAll(async () => {
    if (!prisma) return;
    const flags = await prisma.reviewFlag.findMany({ where: { OR: [{ raisedForStaffId: { in: staffIds } }, { subjectId: { in: businessIds } }] }, select: { id: true } });
    await prisma.notification.deleteMany({ where: { OR: [{ recipientStaffId: { in: staffIds } }, { subjectId: { in: flags.map((f) => f.id) } }] } });
    await prisma.reviewFlag.deleteMany({ where: { id: { in: flags.map((f) => f.id) } } });
    await prisma.fieldHandover.deleteMany({ where: { OR: [{ fromStaffId: { in: staffIds } }, { toStaffId: { in: staffIds } }] } });
    await prisma.followUpTask.deleteMany({ where: { assignedStaffId: { in: staffIds } } });
    await prisma.callRecord.deleteMany({ where: { staffId: { in: staffIds } } });
    await prisma.placement.deleteMany({ where: { businessId: { in: businessIds } } });
    await prisma.interview.deleteMany({ where: { businessId: { in: businessIds } } });
    await prisma.vacancyInterviewSlot.deleteMany({ where: { vacancy: { businessId: { in: businessIds } } } });
    await prisma.businessVisit.deleteMany({ where: { OR: [{ staffId: { in: staffIds } }, { businessId: { in: businessIds } }] } });
    await prisma.visitAssignment.deleteMany({ where: { businessId: { in: businessIds } } });
    await prisma.vacancy.deleteMany({ where: { businessId: { in: businessIds } } });
    await prisma.businessAgreement.deleteMany({ where: { businessId: { in: businessIds } } });
    await prisma.statusHistory.deleteMany({ where: { OR: [{ subjectId: { in: businessIds } }, { changedByStaffId: { in: staffIds } }] } });
    await prisma.business.deleteMany({ where: { id: { in: businessIds } } });
    await prisma.jobSeeker.deleteMany({ where: { id: { in: seekerIds } } });
    await prisma.leaveRequest.deleteMany({ where: { staffId: { in: staffIds } } });
    await prisma.fieldCheckIn.deleteMany({ where: { staffId: { in: staffIds } } });
    await prisma.idempotencyRecord.deleteMany({ where: { staffId: { in: staffIds } } });
    await prisma.auditLog.deleteMany({ where: { actorId: { in: staffIds } } });
    await prisma.attendanceSegment.deleteMany({ where: { day: { staffId: { in: staffIds } } } });
    await prisma.attendanceDay.deleteMany({ where: { staffId: { in: staffIds } } });
    await prisma.staff.updateMany({ where: { id: { in: staffIds } }, data: { teamLeadId: null } });
    await prisma.staff.deleteMany({ where: { id: { in: staffIds } } });
    await app.close();
  });

  // ------------------------------------------------------------------ B1

  it('B1: a Team Lead assigns a customer-app sign-up visit (no account agent yet) — another team\'s Team Lead is refused', async () => {
    clock.at = START;
    const signup = await makeBusiness({ suffix: '01' });
    const visit = await prisma.visitAssignment.create({ data: { businessId: signup.id, purpose: 'business_signup', suggestedStaffId: fa1.id, status: 'pending' } });
    // Another team's Team Lead: refused by the sign-up rule (the suggested agent is not theirs).
    await http().post(`/businesses/${signup.id}/visit-assignments/${visit.id}/assign`).set(authOf(leadB)).send({ assignedStaffId: fb1.id }).expect(403);
    const res = await http().post(`/businesses/${signup.id}/visit-assignments/${visit.id}/assign`).set(authOf(leadA)).send({ assignedStaffId: fa2.id });
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ status: 'assigned', assignedStaffId: fa2.id, assignedStaffOnLeave: false });
    // The guard defers only for a sign-up of this very business: a sign-up assignment id under another business is refused.
    const other = await makeBusiness({ suffix: '02', accountAgentId: fb1.id, verificationStatus: 'pending_visit' });
    const otherVisit = await prisma.visitAssignment.create({ data: { businessId: other.id, purpose: 'verification', status: 'pending' } });
    await http().post(`/businesses/${other.id}/visit-assignments/${otherVisit.id}/assign`).set(authOf(leadA)).send({ assignedStaffId: fa1.id }).expect(403);
    await http().post(`/businesses/${other.id}/visit-assignments/${visit.id}/assign`).set(authOf(leadA)).send({ assignedStaffId: fa1.id }).expect(403);
  });

  it('B1: an app sign-up with no owner and no suggestion stays with Managers and the CEO; assigning to someone on leave warns', async () => {
    clock.at = START;
    const signup = await makeBusiness({ suffix: '03' });
    const visit = await prisma.visitAssignment.create({ data: { businessId: signup.id, purpose: 'business_signup', status: 'pending' } });
    const listed = await http().get('/businesses/visit-assignments').set(authOf(leadB)).expect(200);
    expect(listed.body.map((r: { id: string }) => r.id)).not.toContain(visit.id);
    await http().post(`/businesses/${signup.id}/visit-assignments/${visit.id}/assign`).set(authOf(leadA)).send({ assignedStaffId: fa3.id }).expect(403);
    const suggested = await prisma.visitAssignment.create({ data: { businessId: signup.id, purpose: 'business_signup', status: 'pending', suggestedStaffId: fa2.id } });
    const res = await http().post(`/businesses/${signup.id}/visit-assignments/${suggested.id}/assign`).set(authOf(leadA)).send({ assignedStaffId: fa3.id }).expect(201);
    expect(res.body.assignedStaffOnLeave).toBe(true);
  });

  // ------------------------------------------- job cards, pin, revisit dedupe

  it('verification visits are job cards on Today and Planned; a revisit of one is not listed twice (M2, M12)', async () => {
    clock.at = START;
    const lead = await makeBusiness({ suffix: '04', name: 'Sri Sai Tiffins', address: '12, 9th Cross, JP Nagar', ownerName: 'Ramesh', verificationStatus: 'pending_visit' });
    const assignment = await prisma.visitAssignment.create({ data: { businessId: lead.id, purpose: 'verification', assignedStaffId: fa1.id, status: 'assigned' } });
    // An earlier try: owner not there, come back today at 16:30.
    await prisma.businessVisit.create({
      data: {
        businessId: lead.id, staffId: fa1.id, latitude: SHOP.latitude, longitude: SHOP.longitude, purpose: 'verification', assignmentId: assignment.id,
        outcome: 'owner_not_there', revisitOn: new Date(`${TODAY}T00:00:00.000Z`), revisitTime: '16:30', visitedAt: new Date(START.getTime() - 26 * 60 * MIN),
        outcomeRecordedAt: new Date(START.getTime() - 26 * 60 * MIN),
      },
    });
    const cards = await http().get('/field-work/verification-visits').set(authOf(fa1)).expect(200);
    const card = cards.body.find((c: { assignmentId: string }) => c.assignmentId === assignment.id);
    expect(card).toMatchObject({
      purpose: 'verification',
      business: { id: lead.id, name: 'Sri Sai Tiffins', address: '12, 9th Cross, JP Nagar', ownerName: 'Ramesh', phoneLast4: lead.phone.slice(-4), latitude: SHOP.latitude },
      lastAttempt: { outcome: 'owner_not_there', revisitOn: TODAY, revisitTime: '16:30' },
    });
    expect(JSON.stringify(cards.body)).not.toContain(lead.phone);

    const today = await http().get('/field-work/today').set(authOf(fa1)).expect(200);
    const item = today.body.needsYou.find((n: { id: string }) => n.id === `verification_visit:${assignment.id}`);
    expect(item).toMatchObject({ kind: 'verification_visit', title: 'Sri Sai Tiffins', target: { type: 'verification', step: 'verify', businessId: lead.id, assignmentId: assignment.id } });
    expect(today.body.needsYou.some((n: { kind: string; target: { businessId?: string } }) => n.kind === 'revisit_due' && n.target.businessId === lead.id)).toBe(false);

    const visits = await http().get('/field-work/visits').set(authOf(fa1)).expect(200);
    expect(visits.body.planned.find((p: { assignmentId: string }) => p.assignmentId === assignment.id).job.business.ownerName).toBe('Ramesh');
    expect(visits.body.revisitsDue.some((r: { businessId: string }) => r.businessId === lead.id)).toBe(false);
  });

  it('"Update the pin": the assigned agent moves a wrong pin to where he stands, with a reason (audited); never far, never someone else', async () => {
    clock.at = START;
    const lead = await makeBusiness({ suffix: '05', latitude: 12.9246, longitude: 77.6201, verificationStatus: 'pending_visit' });
    const assignment = await prisma.visitAssignment.create({ data: { businessId: lead.id, purpose: 'business_signup', assignedStaffId: fa1.id, status: 'assigned' } });
    const path = `/field-work/verification-visits/${assignment.id}/pin`;
    await http().post(path).set(authOf(fa1)).send({ ...SHOP, accuracy: 8, reason: '' }).expect(400);
    await http().post(path).set(authOf(fa2)).send({ ...SHOP, accuracy: 8, reason: 'Pin is on the next street' }).expect(404);
    await http().post(path).set(authOf(fa1)).send({ latitude: 12.97, longitude: 77.6201, accuracy: 8, reason: 'Pin is on the next street' }).expect(400);
    // The GPS accuracy is required.
    await http().post(path).set(authOf(fa1)).send({ ...SHOP, reason: 'Pin is on the next street' }).expect(400);
    const moved = await http().post(path).set(authOf(fa1)).send({ ...SHOP, accuracy: 8, reason: 'Pin is on the next street' }).expect(201);
    expect(moved.body.movedMeters).toBeGreaterThan(300);
    expect(await prisma.business.findUniqueOrThrow({ where: { id: lead.id } })).toMatchObject(SHOP);
    const audit = await prisma.auditLog.findFirst({ where: { actorId: fa1.id, action: 'business.pin_updated_at_visit', entityCode: lead.code } });
    expect(audit).toMatchObject({ reason: 'Pin is on the next street' });
    // Every move rings the Team Lead; a second move on the same visit is refused (no walking the pin away).
    expect(await prisma.reviewFlag.findFirst({ where: { kind: 'gps_mismatch', subjectId: lead.id, raisedForStaffId: fa1.id } })).not.toBeNull();
    await http().post(path).set(authOf(fa1)).send({ latitude: SHOP.latitude + 0.012, longitude: SHOP.longitude, accuracy: 8, reason: 'Moving it once more' }).expect(400);
  });

  // ------------------------------------------------------------- B2 calls

  it('B2: a field agent places calls while On visit (not on a break); his calling phone shows in Field; owners of his assigned visits are callable', async () => {
    clock.at = START;
    const lead = await makeBusiness({ suffix: '06', verificationStatus: 'pending_visit' });
    await prisma.visitAssignment.create({ data: { businessId: lead.id, purpose: 'verification', assignedStaffId: fa1.id, status: 'assigned' } });
    expect((await http().get('/field-work/calling-phone').set(authOf(fa1)).expect(200)).body).toEqual({ set: false, last4: null });
    await prisma.staff.update({ where: { id: fa1.id }, data: { callRoutingPhone: encryptCallRoutingPhone('+919812345678') } });
    expect((await http().get('/field-work/calling-phone').set(authOf(fa1)).expect(200)).body).toEqual({ set: true, last4: '5678' });

    const attendance = app.get(AttendanceService);
    await attendance.login(fa1.id, FIELD_LOGIN);
    await attendance.noteBusinessCheckIn(fa1.id);
    expect(await statusOf(fa1.id)).toBe('on_visit');
    const placed = await http().post('/calls').set(authOf(fa1)).send({ subjectType: 'business', subjectId: lead.id, purpose: 'verification' });
    expect(placed.status).toBe(201);
    // Another agent with no visit to it may not call the owner.
    await prisma.staff.update({ where: { id: fa2.id }, data: { callRoutingPhone: encryptCallRoutingPhone('+919812340000') } });
    await attendance.login(fa2.id, FIELD_LOGIN);
    await attendance.setStatus(fa2.id, 'available');
    await http().post('/calls').set(authOf(fa2)).send({ subjectType: 'business', subjectId: lead.id, purpose: 'verification' }).expect(403);
    // On a break: no calls.
    await attendance.setStatus(fa1.id, 'short_break');
    const refused = await http().post('/calls').set(authOf(fa1)).send({ subjectType: 'business', subjectId: lead.id, purpose: 'verification' }).expect(400);
    expect(refused.body.message).toMatch(/Available, On visit or Travelling/);
    await attendance.setStatus(fa1.id, 'available');
  });

  // ------------------------------------------------------------- follow-ups

  it('follow-up tasks: kind label and the answers the server takes, own task only', async () => {
    clock.at = START;
    const biz = await makeBusiness({ suffix: '07', accountAgentId: fa1.id, verificationStatus: 'verified' });
    const task = await prisma.followUpTask.create({
      data: { code: `FT-F21${String(stamp).slice(-6)}`, kind: 'repeat_business_day_30', subjectType: 'business', subjectId: biz.id, dueAt: START, assignedStaffId: fa1.id },
    });
    const view = await http().get(`/field-work/follow-ups/${task.id}`).set(authOf(fa1)).expect(200);
    expect(view.body).toMatchObject({ kindLabel: 'Repeat business — day 30', answers: ['needs_more_staff', 'no_staff_needed_now'], callPurpose: 'follow_up', business: { id: biz.id, mine: true } });
    await http().get(`/field-work/follow-ups/${task.id}`).set(authOf(fa2)).expect(404);
    const today = await http().get('/field-work/today').set(authOf(fa1)).expect(200);
    expect(today.body.needsYou.find((n: { id: string }) => n.id === `followup_task:${task.id}`)).toMatchObject({ kindLabel: 'Repeat business — day 30' });
  });

  // ------------------------------------------------------ arrival while offered

  it('interview day: a candidate who turns up without replying can be marked Arrived — the offer counts as accepted (recorded, audited)', async () => {
    clock.at = START;
    const biz = await makeBusiness({ suffix: '08', accountAgentId: fa1.id, verificationStatus: 'verified' });
    const vacancy = await prisma.vacancy.create({ data: { code: `VC-F21${String(stamp).slice(-6)}`, businessId: biz.id, tradeSkill: 'Cook', status: 'open' } });
    const slot = await prisma.vacancyInterviewSlot.create({ data: { vacancyId: vacancy.id, startsAt: START, endsAt: new Date(START.getTime() + 30 * MIN) } });
    const seeker = await prisma.jobSeeker.create({
      data: { code: `JS-F21${String(stamp).slice(-6)}`, name: 'Ravi Kumar', phone: `+9195${String(stamp).slice(-8)}`, minSalary: 1500000, maxSalary: 2000000, preferredCallWindowStart: '09:00', preferredCallWindowEnd: '21:00' },
    });
    seekerIds.push(seeker.id);
    const interview = await prisma.interview.create({
      data: {
        code: `IV-F21${String(stamp).slice(-6)}`, vacancyId: vacancy.id, businessId: biz.id, jobSeekerId: seeker.id, vacancyInterviewSlotId: slot.id,
        slotStartsAt: slot.startsAt, slotEndsAt: slot.endsAt, proposedByStaffId: fa1.id, suitabilitySnapshot: {}, offerSentAt: new Date(START.getTime() - 60 * MIN),
        replyDueAt: new Date(START.getTime() + 60 * MIN), resultDueAt: new Date(START.getTime() + 8 * 60 * MIN), status: 'offered', interviewType: 'at_shop',
      },
    });
    const path = `/field-selling/interviews/${interview.id}/arrival`;
    await http().post(path).set(authOf(fa1)).send({ arrived: false, ...SHOP }).expect(400);
    // The old arrival route refuses an unanswered offer (only the interview day screen accepts by arrival).
    await http().post(`/field-visits/interviews/${interview.id}/arrived`).set(authOf(fa1)).send({ ...SHOP, accuracy: 8 }).expect(400);
    // A suspended business interviews no one: no accepting by arrival.
    await prisma.business.update({ where: { id: biz.id }, data: { suspendedAt: START } });
    await http().post(path).set(authOf(fa1)).send({ arrived: true, ...SHOP, accuracyM: 8 }).expect(400);
    expect((await prisma.interview.findUniqueOrThrow({ where: { id: interview.id } })).status).toBe('offered');
    await prisma.business.update({ where: { id: biz.id }, data: { suspendedAt: null } });
    await http().post(path).set(authOf(fa1)).send({ arrived: true, ...SHOP, accuracyM: 8 }).expect(201);
    const after = await prisma.interview.findUniqueOrThrow({ where: { id: interview.id } });
    expect(after.status).toBe('confirmed');
    expect(after.candidateArrivedAt).not.toBeNull();
    expect(after.candidateRespondedAt).not.toBeNull();
    const history = await prisma.statusHistory.findFirst({ where: { subjectType: 'interview', subjectId: interview.id, fromStatus: 'offered', toStatus: 'confirmed' } });
    expect(history?.reason).toMatch(/arriving counts as accepting/);
    expect(await prisma.auditLog.findFirst({ where: { actorId: fa1.id, action: 'interview.offer_accepted_by_arrival', entityCode: interview.code } })).not.toBeNull();
  });

  it('"someone else pays": a clear message when the job seeker has not opened his payment step yet', async () => {
    const seeker = await prisma.jobSeeker.create({
      data: {
        code: `JS-F21P${String(stamp).slice(-5)}`, name: 'Manoj K', phone: `+9188${String(stamp).slice(-8)}`, minSalary: 1500000, maxSalary: 2000000,
        preferredCallWindowStart: '09:00', preferredCallWindowEnd: '21:00', registeredByStaffId: fa1.id,
      },
    });
    seekerIds.push(seeker.id);
    const res = await http().post(`/job-seekers/${seeker.id}/payment-only-link`).set(authOf(fa1)).send({ phone: '9876500011', relation: 'parent' }).expect(400);
    expect(res.body.message).toMatch(/opened the payment step on his link/);
  });

  // ---------------------------------------------------------- shop time (M6)

  it('shop time: "onboard now" and the selfie keep him On visit; registering the business ends the shop time (no false short-visit flag)', async () => {
    clock.at = new Date(START.getTime() + 60 * MIN);
    const attendance = app.get(AttendanceService);
    await attendance.setStatus(fa1.id, 'available');
    const id = randomUUID();
    await startVisit(fa1, { id }).expect(201);
    expect(await statusOf(fa1.id)).toBe('on_visit');
    clock.at = new Date(START.getTime() + 62 * MIN);
    await http().post(`/field-visits/${id}/outcome`).set(authOf(fa1)).send({ outcome: 'onboard_now', shopName: 'Annapurna Mess', spokeTo: 'owner' }).expect(201);
    clock.at = new Date(START.getTime() + 63 * MIN);
    await selfie(fa1, id).expect(201);
    let visit = await prisma.businessVisit.findUniqueOrThrow({ where: { id } });
    expect(visit.durationSeconds).toBeNull();
    expect(await statusOf(fa1.id)).toBe('on_visit');
    expect(await prisma.reviewFlag.count({ where: { kind: 'visit_short', subjectId: id } })).toBe(0);
    // 25 minutes in the shop: the business form is saved.
    clock.at = new Date(START.getTime() + 85 * MIN);
    const biz = await makeBusiness({ suffix: '09', accountAgentId: fa1.id, leadCreatedByStaffId: fa1.id });
    await app.get(FieldVisitService).linkRegisteredBusiness(fa1.id, id, biz.id);
    visit = await prisma.businessVisit.findUniqueOrThrow({ where: { id } });
    expect(visit.durationSeconds).toBe(25 * 60);
    expect(await statusOf(fa1.id)).toBe('travelling');
    expect(await prisma.reviewFlag.count({ where: { kind: 'visit_short', subjectId: id } })).toBe(0);
  });

  it('shop time: a verification visit stays On visit after the selfie (it ends with the owner\'s code)', async () => {
    clock.at = new Date(START.getTime() + 120 * MIN);
    const lead = await makeBusiness({ suffix: '10', verificationStatus: 'pending_visit' });
    const assignment = await prisma.visitAssignment.create({ data: { businessId: lead.id, purpose: 'verification', assignedStaffId: fa1.id, status: 'assigned' } });
    const id = randomUUID();
    await startVisit(fa1, { id, assignmentId: assignment.id }).expect(201);
    clock.at = new Date(START.getTime() + 122 * MIN);
    await selfie(fa1, id).expect(201);
    const visit = await prisma.businessVisit.findUniqueOrThrow({ where: { id } });
    expect(visit.endedAt).toBeNull();
    expect(visit.durationSeconds).toBeNull();
    expect(await statusOf(fa1.id)).toBe('on_visit');
    // "Couldn't finish" (owner not there) ends it with a come-back date and time.
    clock.at = new Date(START.getTime() + 140 * MIN);
    await http().post(`/field-visits/${id}/outcome`).set(authOf(fa1)).send({ outcome: 'owner_not_there', revisitOn: TOMORROW, revisitTime: '25:00' }).expect(400);
    await http().post(`/field-visits/${id}/outcome`).set(authOf(fa1)).send({ outcome: 'owner_not_there', spokeTo: 'no_one', revisitOn: TOMORROW, revisitTime: '16:30' }).expect(201);
    const ended = await prisma.businessVisit.findUniqueOrThrow({ where: { id } });
    expect(ended).toMatchObject({ durationSeconds: 20 * 60, revisitTime: '16:30' });
    expect(await statusOf(fa1.id)).toBe('travelling');
  });

  // ------------------------------------------------- field-verified access

  it('a business a field agent verified shows candidates straight away while it waits for the Team Lead (like in-person onboarding)', async () => {
    expect(businessCandidateAccess({ verificationStatus: 'pending_tl_check', fieldVerifiedAt: START })).toEqual({ allowed: true, basis: 'field_verified' });
    expect(businessCandidateAccess({ verificationStatus: 'pending_visit', fieldVerifiedAt: START }).allowed).toBe(false);
    expect(businessCandidateAccess({ verificationStatus: 'pending_tl_check', fieldVerifiedAt: START, pausedAt: START }).allowed).toBe(false);
    expect(businessCandidateAccess({ verificationStatus: 'pending_tl_check' }).allowed).toBe(false);

    clock.at = START;
    // Proof at the shop: GPS inside the geofence, live photos, a stored selfie, a map pin.
    const verified = await verifiedByRows('11', { geofenceFlag: false, photoLive: true, selfieHash: 'h-11' });
    expect(verified.fieldVerifiedAt).not.toBeNull();
    expect(businessCandidateAccess(verified).allowed).toBe(true);
    expect(await prisma.auditLog.findFirst({ where: { action: 'business.field_verified', entityCode: verified.code } })).not.toBeNull();
    // The old route's text selfie (photoLive false, no hash): waits for the Team Lead.
    const oldRoute = await verifiedByRows('16', { geofenceFlag: false, photoLive: false, selfieHash: null });
    expect(oldRoute.verificationStatus).toBe('pending_tl_check');
    expect(oldRoute.fieldVerifiedAt).toBeNull();
    expect(businessCandidateAccess(oldRoute).allowed).toBe(false);
    // Far from the pin: waits for the Team Lead too.
    const far = await verifiedByRows('17', { geofenceFlag: true, photoLive: true, selfieHash: 'h-17' });
    expect(far.fieldVerifiedAt).toBeNull();
  });

  async function verifiedByRows(suffix: string, proof: { geofenceFlag: boolean; photoLive: boolean; selfieHash: string | null }) {
    const lead = await makeBusiness({ suffix, leadCreatedByStaffId: null, verificationStatus: 'pending_visit' });
    const assignment = await prisma.visitAssignment.create({ data: { businessId: lead.id, purpose: 'verification', assignedStaffId: fa1.id, status: 'assigned' } });
    const visit = await prisma.businessVisit.create({
      data: {
        businessId: lead.id, staffId: fa1.id, latitude: SHOP.latitude, longitude: SHOP.longitude, purpose: 'verification', assignmentId: assignment.id,
        ownerOtpRequestId: `otp-${suffix}`, selfieUrl: `visits/${suffix}/selfie.jpg`, ...proof,
      },
    });
    await prisma.visitAssignment.update({ where: { id: assignment.id }, data: { status: 'done', visitId: visit.id } });
    await signAgreement(lead);
    await app.get(BusinessVerificationService).advanceToPendingTlCheckIfReady(lead.id, fa1.id);
    return prisma.business.findUniqueOrThrow({ where: { id: lead.id } });
  }

  async function signAgreement(lead: { id: string; phone: string }) {
    await prisma.businessAgreement.create({
      data: {
        businessId: lead.id, version: 'v1', termsHash: 'h', noBypassMonths: 12, noBypassPenaltyPercent: 25, feePercent: 50, gstPercent: 18,
        signedName: 'Ramesh', signedPhone: lead.phone, otpRequestId: `otp-sign-${lead.id}`, signedAt: START, documentStoragePath: 'a/b.html',
      },
    });
  }

  it('BLOCKER: a verification done 778 m or 40 km from the pin (through Laboura Field) never unlocks candidates; the Team Lead is flagged', async () => {
    for (const [suffix, offset] of [['18', 0.007], ['19', 0.36]] as const) {
      clock.at = new Date(START.getTime() + 400 * MIN + Number(suffix) * 60 * MIN);
      const lead = await makeBusiness({ suffix, verificationStatus: 'pending_visit' });
      const assignment = await prisma.visitAssignment.create({ data: { businessId: lead.id, purpose: 'verification', assignedStaffId: fa1.id, status: 'assigned' } });
      await signAgreement(lead);
      const at = { latitude: SHOP.latitude + offset, longitude: SHOP.longitude };
      const id = randomUUID();
      await startVisit(fa1, { id, assignmentId: assignment.id, ...at }).expect(201);
      clock.at = new Date(clock.at.getTime() + MIN);
      await http().post(`/field-visits/${id}/proof`).set(authOf(fa1))
        .field('latitude', String(at.latitude + 0.00003)).field('longitude', String(at.longitude)).field('accuracy', '6')
        .field('source', 'live_camera').field('takenAt', clock.at.toISOString())
        .attach('photo', photo(), { filename: 'selfie.jpg', contentType: 'image/jpeg' }).expect(201);
      const sent = await http().post(`/businesses/${lead.id}/visit-assignments/${assignment.id}/owner-otp`).set(authOf(fa1)).expect(201);
      const code = (app.get(OtpService).getProvider() as MockOtpProvider).getCode(sent.body.requestId)!;
      await http().post(`/field-visits/${id}/verify`).set(authOf(fa1)).send({ ownerOtpRequestId: sent.body.requestId, ownerOtpCode: code }).expect(201);
      const after = await prisma.business.findUniqueOrThrow({ where: { id: lead.id } });
      expect(after.verificationStatus).toBe('pending_tl_check');
      expect(after.fieldVerifiedAt).toBeNull();
      expect(businessCandidateAccess(after).allowed).toBe(false);
      expect(await prisma.reviewFlag.findFirst({ where: { kind: 'gps_mismatch', subjectId: id } })).not.toBeNull();
      // Two minutes from the shop photo to the owner's code: the short-visit check ran.
      expect(await prisma.reviewFlag.findFirst({ where: { kind: 'visit_short', subjectId: id } })).not.toBeNull();
    }
  });

  // ------------------------------------------------------------- similar shop

  it('similar shop nearby: a business with a similar name within the duplicate radius is shown before a second record', async () => {
    await makeBusiness({ suffix: '12', name: 'Lakshmi Tiffin Centre', latitude: 12.9316, longitude: 77.6301 });
    // Not seen anywhere today yet: nothing (the check is never a way to search the map).
    expect((await http().get('/field-work/similar-shops').query({ name: 'Lakshmi Tiffin', lat: 12.9316, lng: 77.6301 }).set(authOf(fb1)).expect(200)).body.matches).toEqual([]);
    await prisma.fieldCheckIn.create({ data: { staffId: fa1.id, latitude: 12.9316, longitude: 77.6301, accuracyMeters: 8, checkedInAt: clock.at } });
    expect((await http().get('/field-work/similar-shops').query({ name: 'Lak', lat: 12.9316, lng: 77.6301 }).set(authOf(fa1)).expect(200)).body.matches).toEqual([]);
    const near = await http().get('/field-work/similar-shops').query({ name: 'Lakshmi Tiffin', lat: 12.9316, lng: 77.6301 }).set(authOf(fa1)).expect(200);
    expect(near.body.matches[0]).toMatchObject({ name: 'Lakshmi Tiffin Centre', distanceMeters: 0 });
    const far = await http().get('/field-work/similar-shops').query({ name: 'Lakshmi Tiffin', lat: 12.99, lng: 77.70 }).set(authOf(fa1)).expect(200);
    expect(far.body.matches).toEqual([]);
  });

  // ------------------------------------------------------ handover, reassign

  it('leave handover: visits, interviews to attend, revisits and joinings move to the team (never to someone on leave); the cover sees and acts on them', async () => {
    clock.at = new Date(START.getTime() + 180 * MIN);
    const mine = await makeBusiness({ suffix: '13', accountAgentId: fa1.id, verificationStatus: 'verified' });
    const lead = await makeBusiness({ suffix: '14', verificationStatus: 'pending_visit' });
    const assignment = await prisma.visitAssignment.create({ data: { businessId: lead.id, purpose: 'verification', assignedStaffId: fa1.id, status: 'assigned' } });
    // A revisit due today at an unregistered shop.
    const revisit = await prisma.businessVisit.create({
      data: { staffId: fa1.id, latitude: SHOP.latitude, longitude: SHOP.longitude, shopName: 'Ganesh Stores', outcome: 'interested_later', revisitOn: new Date(`${TODAY}T00:00:00.000Z`), purpose: 'shop_visit', visitedAt: new Date(START.getTime() - 3 * 24 * 60 * MIN) },
    });
    // A joining to confirm tomorrow and an interview he attends later today.
    const vacancy = await prisma.vacancy.create({ data: { code: `VC-F21H${String(stamp).slice(-5)}`, businessId: mine.id, tradeSkill: 'Waiter', status: 'open' } });
    const seeker = await prisma.jobSeeker.create({
      data: { code: `JS-F21H${String(stamp).slice(-5)}`, name: 'Suresh B', phone: `+9194${String(stamp).slice(-8)}`, minSalary: 1500000, maxSalary: 2000000, preferredCallWindowStart: '09:00', preferredCallWindowEnd: '21:00' },
    });
    seekerIds.push(seeker.id);
    const placement = await prisma.placement.create({
      data: { code: `PL-F21${String(stamp).slice(-6)}`, vacancyId: vacancy.id, jobSeekerId: seeker.id, businessId: mine.id, placementFee: 900000, gstAmount: 162000, status: 'confirmed', joiningDate: new Date(`${TOMORROW}T00:00:00.000Z`), createdByStaffId: fa1.id },
    });
    const slot = await prisma.vacancyInterviewSlot.create({ data: { vacancyId: vacancy.id, startsAt: new Date(START.getTime() + 300 * MIN), endsAt: new Date(START.getTime() + 330 * MIN) } });
    const interview = await prisma.interview.create({
      data: {
        code: `IV-F21H${String(stamp).slice(-5)}`, vacancyId: vacancy.id, businessId: mine.id, jobSeekerId: seeker.id, vacancyInterviewSlotId: slot.id,
        slotStartsAt: slot.startsAt, slotEndsAt: slot.endsAt, proposedByStaffId: fa1.id, agentWillAttend: true, suitabilitySnapshot: {}, offerSentAt: START,
        replyDueAt: START, resultDueAt: new Date(START.getTime() + 600 * MIN), status: 'confirmed', interviewType: 'at_shop',
      },
    });

    // A revisit due 5 Dec (after a 2-day leave) stays with him.
    const later = await makeBusiness({ suffix: '20', accountAgentId: fa1.id, verificationStatus: 'verified' });
    const lateRevisit = await prisma.businessVisit.create({
      data: { staffId: fa1.id, businessId: later.id, latitude: SHOP.latitude, longitude: SHOP.longitude, outcome: 'interested_later', revisitOn: new Date('2026-12-05T00:00:00.000Z'), purpose: 'shop_visit', visitedAt: new Date(START.getTime() - 2 * 24 * 60 * MIN) },
    });
    // By hand, the last day away is required.
    await http().post('/field-assignments/hand-over').set(authOf(leadA)).send({ fromStaffId: fa1.id, reason: 'Approved leave' }).expect(400);

    const result = await app.get(FieldHandoverService).handOver(fa1.id, 'spread', { reason: 'Approved leave', actorId: leadA.id, until: new Date(`${TOMORROW}T06:00:00.000Z`) });
    expect(result.moved.some((m) => m.recordId === lateRevisit.id)).toBe(false);
    expect(await prisma.fieldHandover.findFirst({ where: { recordId: revisit.id, endedAt: null } })).toMatchObject({ until: new Date('2026-11-24T18:30:00.000Z') });
    const moved = new Map(result.moved.map((m) => [`${m.kind}:${m.recordId}`, m.toStaffId]));
    expect(moved.get(`visit_assignment:${assignment.id}`)).toBe(fa2.id);
    expect(moved.get(`revisit:${revisit.id}`)).toBe(fa2.id);
    expect(moved.get(`joining:${placement.id}`)).toBe(fa2.id);
    expect(moved.get(`interview:${interview.id}`)).toBe(fa2.id);
    expect(result.moved.some((m) => m.toStaffId === fa3.id)).toBe(false); // on leave
    expect((await prisma.visitAssignment.findUniqueOrThrow({ where: { id: assignment.id } })).assignedStaffId).toBe(fa2.id);
    expect(await prisma.visitAssignment.findFirst({ where: { relatedType: 'interview', relatedId: interview.id, assignedStaffId: fa2.id, status: 'assigned' } })).not.toBeNull();
    expect(await prisma.auditLog.findFirst({ where: { actorId: leadA.id, action: 'field_agent.work_handed_over' } })).not.toBeNull();

    // The cover sees the revisit and the joining; the agent on leave no longer does.
    const coverVisits = await http().get('/field-work/visits').set(authOf(fa2)).expect(200);
    expect(coverVisits.body.revisitsDue.find((r: { visitId: string }) => r.visitId === revisit.id)).toMatchObject({ covering: true });
    expect((await http().get('/field-work/visits').set(authOf(fa1)).expect(200)).body.revisitsDue.some((r: { visitId: string }) => r.visitId === revisit.id)).toBe(false);
    const coverToday = await http().get('/field-work/today').set(authOf(fa2)).expect(200);
    expect(coverToday.body.needsYou.some((n: { id: string }) => n.id === `joining_due:${placement.id}`)).toBe(true);
    expect(coverToday.body.needsYou.some((n: { id: string }) => n.id === `revisit_due:${revisit.id}`)).toBe(true);
    const leaverToday = await http().get('/field-work/today').set(authOf(fa1)).expect(200);
    expect(leaverToday.body.needsYou.some((n: { id: string }) => n.id === `joining_due:${placement.id}` || n.id === `interview_today:${interview.id}`)).toBe(false);
    // He acts on the handed-over pieces only: the joining yes, the business's vacancies no.
    await http().get(`/screens/field-selling/placements/${placement.id}`).set(authOf(fa2)).expect(200);
    await http().get(`/screens/field-selling/interviews/${interview.id}`).set(authOf(fa2)).expect(200);
    // Nothing else of the agent's businesses: a vacancy at another of his businesses stays closed to the cover.
    const otherVacancy = await prisma.vacancy.create({ data: { code: `VC-F21L${String(stamp).slice(-5)}`, businessId: later.id, tradeSkill: 'Cook', status: 'open' } });
    await http().get(`/screens/field-selling/vacancies/${otherVacancy.id}/matches`).set(authOf(fa2)).expect(404);
    await http().get(`/screens/field-selling/placements/${placement.id}`).set(authOf(fa3)).expect(403);

    // Two agreements signed on his business: one bell each (per agreement, not per business).
    const signedBiz = await makeBusiness({ suffix: '21', accountAgentId: fa2.id, verificationStatus: 'verified' });
    await signAgreement(signedBiz);
    await prisma.businessAgreement.create({
      data: {
        businessId: signedBiz.id, version: 'v2', termsHash: 'h2', noBypassMonths: 12, noBypassPenaltyPercent: 25, feePercent: 50, gstPercent: 18,
        signedName: 'Ramesh', signedPhone: signedBiz.phone, otpRequestId: `otp-sign2-${signedBiz.id}`, signedAt: START, documentStoragePath: 'a/c.html',
      },
    });

    // The Field bell catches up: the visit assigned to him and the work handed over.
    const bell = await http().get('/field-work/notifications').set(authOf(fa2)).expect(200);
    const kinds = bell.body.items.map((n: { kind: string; target: { type: string; id: string } | null }) => `${n.kind}:${n.target?.type}:${n.target?.id}`);
    expect(kinds).toEqual(expect.arrayContaining([
      `field_visit_assigned:visit_assignment:${assignment.id}`,
      `field_work_handed_over:revisit:${revisit.id}`,
      `field_work_handed_over:placement:${placement.id}`,
    ]));
    expect(bell.body.unseenCount).toBeGreaterThanOrEqual(3);
    expect(kinds.filter((k: string) => k === `field_agreement_signed:business:${signedBiz.id}`)).toHaveLength(2);
    // "Visit assigned" carries the visit itself: purpose, business, still his to do.
    expect(bell.body.items.find((n: { kind: string; target: { id: string } | null }) => n.kind === 'field_visit_assigned' && n.target?.id === assignment.id).target)
      .toMatchObject({ purpose: 'verification', businessId: lead.id, open: true });
    const first = bell.body.items[0];
    await http().post(`/notifications/${first.id}/seen`).set(authOf(fa2)).expect(201);
    const again = await http().get('/field-work/notifications').set(authOf(fa2)).expect(200);
    expect(again.body.unseenCount).toBe(bell.body.unseenCount - 1);
    // Read once, it never comes back as new.
    expect(again.body.items.filter((n: { id: string }) => n.id === first.id)).toHaveLength(1);

    // He does the handed-over revisit: that piece is done and his cover of it ends.
    await startVisit(fa2, { id: randomUUID(), revisitOfVisitId: revisit.id }).expect(201);
    await http().get('/field-work/visits').set(authOf(fa2)).expect(200);
    expect((await prisma.fieldHandover.findFirstOrThrow({ where: { kind: 'revisit', recordId: revisit.id } })).endedAt).not.toBeNull();

    // After the last day away the cover ends by itself: the joining is the agent's again.
    clock.at = new Date('2026-11-24T19:00:00.000Z');
    expect((await http().get('/field-work/today').set(authOf(fa2)).expect(200)).body.needsYou.some((n: { id: string }) => n.id === `joining_due:${placement.id}`)).toBe(false);
    expect((await http().get('/field-work/today').set(authOf(fa1)).expect(200)).body.needsYou.some((n: { id: string }) => n.id === `joining_due:${placement.id}`)).toBe(true);
    await http().get(`/screens/field-selling/placements/${placement.id}`).set(authOf(fa2)).expect(403);
    clock.at = START;
  });

  it('hand back: the agent is back, every cover of his work ends and his open visits return to him', async () => {
    clock.at = START;
    const lead = await makeBusiness({ suffix: '22', verificationStatus: 'pending_visit' });
    const assignment = await prisma.visitAssignment.create({ data: { businessId: lead.id, purpose: 'verification', assignedStaffId: fb1.id, status: 'assigned' } });
    const out = await http().post('/field-assignments/hand-over').set(authOf(leadB)).send({ fromStaffId: fb1.id, toStaffId: leadB.id, reason: 'Leave', until: TOMORROW });
    expect(out.status).toBe(403); // only the team's field agents take field work
    const other = await makeStaff('field_agent', leadB.id);
    const done = await http().post('/field-assignments/hand-over').set(authOf(leadB)).send({ fromStaffId: fb1.id, toStaffId: other.id, reason: 'Leave', until: TOMORROW }).expect(201);
    expect(done.body.moved).toEqual([{ kind: 'visit_assignment', recordId: assignment.id, toStaffId: other.id }]);
    await http().post('/field-assignments/hand-back').set(authOf(leadA)).send({ fromStaffId: fb1.id }).expect(403);
    const back = await http().post('/field-assignments/hand-back').set(authOf(leadB)).send({ fromStaffId: fb1.id }).expect(201);
    expect(back.body).toEqual({ ended: 1 });
    expect((await prisma.visitAssignment.findUniqueOrThrow({ where: { id: assignment.id } })).assignedStaffId).toBe(fb1.id);
  });

  it('reassign: a Team Lead moves one planned visit between his agents (warning for someone on leave); another team\'s Team Lead is refused', async () => {
    clock.at = START;
    const lead = await makeBusiness({ suffix: '15', verificationStatus: 'pending_visit' });
    const assignment = await prisma.visitAssignment.create({ data: { businessId: lead.id, purpose: 'verification', assignedStaffId: fa2.id, status: 'assigned' } });
    const open = await http().get('/field-assignments/open').set(authOf(leadA)).expect(200);
    expect(open.body.assignments.map((a: { id: string }) => a.id)).toContain(assignment.id);
    expect(open.body.agents.find((a: { id: string }) => a.id === fa3.id)).toMatchObject({ onLeaveToday: true });
    expect((await http().get('/field-assignments/open').set(authOf(leadB)).expect(200)).body.assignments.map((a: { id: string }) => a.id)).not.toContain(assignment.id);

    const path = `/field-assignments/${assignment.id}/reassign`;
    await http().post(path).set(authOf(leadB)).send({ assignedStaffId: fb1.id, reason: 'Closer to the shop' }).expect(403);
    await http().post(path).set(authOf(fa1)).send({ assignedStaffId: fa1.id, reason: 'Mine now' }).expect(403);
    await http().post(path).set(authOf(leadA)).send({ assignedStaffId: fa1.id }).expect(400);
    const warned = await http().post(path).set(authOf(leadA)).send({ assignedStaffId: fa3.id, reason: 'Closer to the shop' }).expect(409);
    expect(warned.body.code).toBe('AGENT_ON_LEAVE');
    const done = await http().post(path).set(authOf(leadA)).send({ assignedStaffId: fa3.id, reason: 'Closer to the shop', confirmLeave: true }).expect(201);
    expect(done.body).toMatchObject({ assignedStaffId: fa3.id, onLeave: true });
    const moved = await http().post(path).set(authOf(leadA)).send({ assignedStaffId: fa1.id, reason: 'Back from leave' }).expect(201);
    expect(moved.body.onLeave).toBe(false);
    expect((await prisma.visitAssignment.findUniqueOrThrow({ where: { id: assignment.id } })).assignedStaffId).toBe(fa1.id);
    // Only one live handover row per piece: the earlier one ended.
    expect(await prisma.fieldHandover.count({ where: { kind: 'visit_assignment', recordId: assignment.id, endedAt: null } })).toBe(1);
  });

  // ------------------------------------------------------------- re-check of 21 Nov

  it('a cover finishes a handed-over interview: he marks the arrival, it stays on his Today and he records the owner\'s decision', async () => {
    clock.at = START;
    const leadC = await makeStaff('team_lead');
    const away = await makeStaff('field_agent', leadC.id);
    const cover = await makeStaff('field_agent', leadC.id);
    const biz = await makeBusiness({ suffix: '23', accountAgentId: away.id, verificationStatus: 'verified' });
    const vacancy = await prisma.vacancy.create({ data: { code: `VC-F21C${String(stamp).slice(-5)}`, businessId: biz.id, tradeSkill: 'Cook', status: 'open' } });
    const slot = await prisma.vacancyInterviewSlot.create({ data: { vacancyId: vacancy.id, startsAt: START, endsAt: new Date(START.getTime() + 30 * MIN) } });
    const seeker = await prisma.jobSeeker.create({
      data: { code: `JS-F21C${String(stamp).slice(-5)}`, name: 'Mohan Rao', phone: `+9184${String(stamp).slice(-8)}`, minSalary: 1500000, maxSalary: 2000000, preferredCallWindowStart: '09:00', preferredCallWindowEnd: '21:00' },
    });
    seekerIds.push(seeker.id);
    const interview = await prisma.interview.create({
      data: {
        code: `IV-F21C${String(stamp).slice(-5)}`, vacancyId: vacancy.id, businessId: biz.id, jobSeekerId: seeker.id, vacancyInterviewSlotId: slot.id,
        slotStartsAt: slot.startsAt, slotEndsAt: slot.endsAt, proposedByStaffId: away.id, agentWillAttend: true, suitabilitySnapshot: {}, offerSentAt: new Date(START.getTime() - 120 * MIN),
        replyDueAt: new Date(START.getTime() - 60 * MIN), resultDueAt: new Date(START.getTime() + 8 * 60 * MIN), status: 'confirmed', interviewType: 'at_shop',
      },
    });
    await http().post('/field-assignments/hand-over').set(authOf(leadC)).send({ fromStaffId: away.id, toStaffId: cover.id, reason: 'Sick leave', until: TODAY }).expect(201);

    await http().post(`/field-selling/interviews/${interview.id}/arrival`).set(authOf(cover)).send({ arrived: true, ...SHOP, accuracyM: 8 }).expect(201);
    // Arrived but undecided: still the cover's (never ended or cancelled at the arrival).
    const today = await http().get('/field-work/today').set(authOf(cover)).expect(200);
    expect(today.body.needsYou.find((n: { id: string }) => n.id === `interview_today:${interview.id}`)?.target).toMatchObject({ step: 'owner_decision' });
    expect(await prisma.fieldHandover.findFirst({ where: { kind: 'interview', recordId: interview.id, endedAt: null } })).not.toBeNull();
    await http().get(`/screens/field-selling/interviews/${interview.id}`).set(authOf(cover)).expect(200);

    const sent = await http().post(`/field-selling/interviews/${interview.id}/owner-otp`).set(authOf(cover)).send({ decision: 'not_selected', reason: 'experience' }).expect(201);
    const code = (app.get(OtpService).getProvider() as MockOtpProvider).getCode(sent.body.otpRequestId)!;
    await http().post(`/field-selling/interviews/${interview.id}/decision`).set(authOf(cover))
      .send({ decision: 'not_selected', reason: 'experience', otpRequestId: sent.body.otpRequestId, code }).expect(201);
    const after = await prisma.interview.findUniqueOrThrow({ where: { id: interview.id } });
    expect(after.resultRecordedAt).not.toBeNull();
    expect(after.resultRecordedByStaffId).toBe(cover.id);
    // The decision is the end of the piece: the cover of it ends now.
    await http().get('/field-work/today').set(authOf(cover)).expect(200);
    expect((await prisma.fieldHandover.findFirstOrThrow({ where: { kind: 'interview', recordId: interview.id } })).endedAt).not.toBeNull();
  });

  it('an arrived interview\'s attendance visit is never cancelled when the leave ends before the decision', async () => {
    clock.at = START;
    const leadC = await makeStaff('team_lead');
    const away = await makeStaff('field_agent', leadC.id);
    const cover = await makeStaff('field_agent', leadC.id);
    const biz = await makeBusiness({ suffix: '24', accountAgentId: away.id, verificationStatus: 'verified' });
    const vacancy = await prisma.vacancy.create({ data: { code: `VC-F21D${String(stamp).slice(-5)}`, businessId: biz.id, tradeSkill: 'Cook', status: 'open' } });
    const slot = await prisma.vacancyInterviewSlot.create({ data: { vacancyId: vacancy.id, startsAt: START, endsAt: new Date(START.getTime() + 30 * MIN) } });
    const seeker = await prisma.jobSeeker.create({
      data: { code: `JS-F21D${String(stamp).slice(-5)}`, name: 'Kiran S', phone: `+9183${String(stamp).slice(-8)}`, minSalary: 1500000, maxSalary: 2000000, preferredCallWindowStart: '09:00', preferredCallWindowEnd: '21:00' },
    });
    seekerIds.push(seeker.id);
    const interview = await prisma.interview.create({
      data: {
        code: `IV-F21D${String(stamp).slice(-5)}`, vacancyId: vacancy.id, businessId: biz.id, jobSeekerId: seeker.id, vacancyInterviewSlotId: slot.id,
        slotStartsAt: slot.startsAt, slotEndsAt: slot.endsAt, proposedByStaffId: away.id, agentWillAttend: true, suitabilitySnapshot: {}, offerSentAt: START,
        replyDueAt: START, resultDueAt: new Date(START.getTime() + 8 * 60 * MIN), status: 'confirmed', interviewType: 'at_shop',
      },
    });
    await http().post('/field-assignments/hand-over').set(authOf(leadC)).send({ fromStaffId: away.id, toStaffId: cover.id, reason: 'Sick leave', until: TODAY }).expect(201);
    await http().post(`/field-selling/interviews/${interview.id}/arrival`).set(authOf(cover)).send({ arrived: true, ...SHOP, accuracyM: 8 }).expect(201);
    clock.at = new Date('2026-11-23T19:00:00.000Z'); // after the leave's last day (IST midnight)
    await http().get('/field-work/today').set(authOf(cover)).expect(200);
    expect(await prisma.visitAssignment.findFirst({ where: { relatedType: 'interview', relatedId: interview.id, assignedStaffId: cover.id, status: 'cancelled' } })).toBeNull();
    clock.at = START;
  });

  it('a pin the agent moved himself never unlocks candidates until his Team Lead checks it; one agent move per business until then', async () => {
    clock.at = START;
    const lead = await makeBusiness({ suffix: '25', latitude: SHOP.latitude + 0.003, longitude: SHOP.longitude, leadCreatedByStaffId: null, verificationStatus: 'pending_visit' });
    const assignment = await prisma.visitAssignment.create({ data: { businessId: lead.id, purpose: 'verification', assignedStaffId: fa1.id, status: 'assigned' } });
    await http().post(`/field-work/verification-visits/${assignment.id}/pin`).set(authOf(fa1)).send({ ...SHOP, accuracy: 8, reason: 'Pin is on the next street' }).expect(201);
    const flag = await prisma.reviewFlag.findFirstOrThrow({ where: { kind: 'gps_mismatch', subjectType: 'business', subjectId: lead.id, status: 'open' } });

    // A second visit to the same business (another agent): no second move while the first waits for the Team Lead.
    const second = await prisma.visitAssignment.create({ data: { businessId: lead.id, purpose: 'business_signup', assignedStaffId: fa2.id, status: 'assigned' } });
    const refused = await http().post(`/field-work/verification-visits/${second.id}/pin`).set(authOf(fa2))
      .send({ latitude: SHOP.latitude + 0.0005, longitude: SHOP.longitude, accuracy: 8, reason: 'Pin is across the road' }).expect(400);
    expect(refused.body.message).toMatch(/waits for your Team Lead/);

    // Every other proof is perfect, yet the moved pin keeps candidates hidden.
    const visit = await prisma.businessVisit.create({
      data: {
        businessId: lead.id, staffId: fa1.id, latitude: SHOP.latitude, longitude: SHOP.longitude, purpose: 'verification', assignmentId: assignment.id,
        ownerOtpRequestId: 'otp-25', selfieUrl: 'visits/25/selfie.jpg', geofenceFlag: false, photoLive: true, selfieHash: 'h-25',
      },
    });
    await prisma.visitAssignment.update({ where: { id: assignment.id }, data: { status: 'done', visitId: visit.id } });
    await signAgreement(lead);
    await app.get(BusinessVerificationService).advanceToPendingTlCheckIfReady(lead.id, fa1.id);
    const after = await prisma.business.findUniqueOrThrow({ where: { id: lead.id } });
    expect(after.verificationStatus).toBe('pending_tl_check');
    expect(after.fieldVerifiedAt).toBeNull();
    expect(businessCandidateAccess(after).allowed).toBe(false);

    // Once the Team Lead checked the pin, the next visit may move it again.
    await prisma.reviewFlag.update({ where: { id: flag.id }, data: { status: 'resolved' } });
    await http().post(`/field-work/verification-visits/${second.id}/pin`).set(authOf(fa2))
      .send({ latitude: SHOP.latitude + 0.0005, longitude: SHOP.longitude, accuracy: 8, reason: 'Pin is across the road' }).expect(201);
  });

  it('hand-over by hand: an impossible last day is a 400, never a 500', async () => {
    for (const until of ['2026-13-45', '2026-02-30', 'tomorrow']) {
      await http().post('/field-assignments/hand-over').set(authOf(leadB)).send({ fromStaffId: fb1.id, reason: 'Leave', until }).expect(400);
    }
  });

  it('when the leave ends, a verification visit the cover has not started goes back to the agent', async () => {
    clock.at = START;
    const leadC = await makeStaff('team_lead');
    const away = await makeStaff('field_agent', leadC.id);
    const cover = await makeStaff('field_agent', leadC.id);
    const lead = await makeBusiness({ suffix: '26', verificationStatus: 'pending_visit' });
    const assignment = await prisma.visitAssignment.create({ data: { businessId: lead.id, purpose: 'verification', assignedStaffId: away.id, status: 'assigned' } });
    await http().post('/field-assignments/hand-over').set(authOf(leadC)).send({ fromStaffId: away.id, toStaffId: cover.id, reason: 'Leave', until: TODAY }).expect(201);
    expect((await prisma.visitAssignment.findUniqueOrThrow({ where: { id: assignment.id } })).assignedStaffId).toBe(cover.id);
    clock.at = new Date('2026-11-23T19:00:00.000Z');
    // The agent opens Laboura Field the next morning: the visit is his again.
    const back = await http().get('/field-work/visits').set(authOf(away)).expect(200);
    expect(JSON.stringify(back.body)).toContain(assignment.id);
    expect((await prisma.visitAssignment.findUniqueOrThrow({ where: { id: assignment.id } })).assignedStaffId).toBe(away.id);
    expect((await prisma.fieldHandover.findFirstOrThrow({ where: { kind: 'visit_assignment', recordId: assignment.id } })).endedAt).not.toBeNull();
    clock.at = START;
  });
});
