import { INestApplication, Injectable } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { JwtService } from '@nestjs/jwt';
import { randomUUID } from 'crypto';
import * as request from 'supertest';
import { AppModule } from '../../app.module';
import { PrismaService } from '../../common/prisma/prisma.service';
import { OtpService } from '../../common/otp/otp.service';
import { MockOtpProvider } from '../../common/otp/mock-otp.provider';
import { calculateGst, calculatePlacementFee } from '../../common/money/money';
import { ConsentClock } from '../consent/consent-clock';
import { CallClock } from '../call/call-clock';
import { PricingService } from '../pricing/pricing.service';
import { SMS_PROVIDER, SmsProvider } from '../message/sms.provider';
import { WHATSAPP_PROVIDER, WhatsAppProvider } from '../../common/whatsapp/whatsapp.interface';
import { TELEPHONY_PROVIDER } from '../telephony/telephony.interface';
import { MockTelephonyProvider } from '../telephony/mock-telephony.provider';
import { encryptCallRoutingPhone } from '../staff/call-routing-key';
import { openAvailableDay } from '../../test-support/available-day';
import { FieldSellingService, istInstant } from './field-selling.service';

const IST = 330 * 60 * 1000;

@Injectable()
class FrozenClock extends ConsentClock {
  current = new Date();
  override now() { return new Date(this.current); }
}

class FrozenCallClock extends CallClock {
  constructor(private readonly source: FrozenClock) { super(); }
  override now() { return this.source.now(); }
}

function istDateKey(instant: Date, plusDays = 0): string {
  return new Date(instant.getTime() + IST + plusDays * 86_400_000).toISOString().slice(0, 10);
}

/**
 * Laboura Field: on-the-spot matching and selling (Master Guide, "Confirming
 * in the shop", decided 9 Nov). Proves the in-shop call (no = hit, yes = the
 * first interview), "Handing phone to owner", Selected now with the owner's
 * OTP → placement and fee link, Not selected (no hit), booking with a picked
 * date and time, "candidate arrived" with GPS, the phone interview through the
 * 3-way call, the owner's favourite, owner complaints and the guards.
 */
describe('Laboura Field selling (in-shop confirmation)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let jwt: JwtService;
  let otp: OtpService;
  let telephony: MockTelephonyProvider;
  let selling: FieldSellingService;
  const clock = new FrozenClock();
  const suffix = randomUUID().replace(/-/g, '').slice(0, 10).toUpperCase();
  const staffIds: string[] = [];
  const seekerIds: string[] = [];
  const businessIds: string[] = [];
  const sent: Array<{ phone: string; template: string; variables: Record<string, string> }> = [];

  const server = () => app.getHttpServer();
  const tokenFor = (s: { id: string; role: string; code: string; email: string | null }) =>
    jwt.sign({ sub: s.id, role: s.role, code: s.code, email: s.email });

  beforeAll(async () => {
    process.env.CALL_ROUTING_KEY = 'field_selling_routing_key_32_chars_ok';
    // Today, 11:30 AM IST: inside calling hours and the walk-in window.
    const today = istDateKey(new Date());
    clock.current = istInstant(today, '11:30');
    const sms: SmsProvider = {
      sendTemplate: async (phone, template, _dlt, variables) => {
        sent.push({ phone, template, variables });
        return { messageId: `fs_sms_${randomUUID()}`, status: 'sent' };
      },
    };
    const wa: WhatsAppProvider = {
      sendTemplateMessage: async (phone, templateName, params) => {
        sent.push({ phone, template: templateName, variables: params });
        return { messageId: `fs_wa_${randomUUID()}`, status: 'sent', phone, templateName, timestamp: new Date() };
      },
    };
    const moduleRef: TestingModule = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(ConsentClock).useValue(clock)
      .overrideProvider(CallClock).useValue(new FrozenCallClock(clock))
      .overrideProvider(SMS_PROVIDER).useValue(sms)
      .overrideProvider(WHATSAPP_PROVIDER).useValue(wa)
      .compile();
    app = moduleRef.createNestApplication();
    await app.init();
    prisma = app.get(PrismaService);
    jwt = app.get(JwtService);
    otp = app.get(OtpService);
    telephony = app.get(TELEPHONY_PROVIDER);
    selling = app.get(FieldSellingService);
  }, 120000);

  afterAll(async () => {
    if (!prisma) return;
    const safe = async (fn: () => Promise<unknown>) => { try { await fn(); } catch { /* best-effort cleanup */ } };
    const vacancies = await prisma.vacancy.findMany({ where: { businessId: { in: businessIds } }, select: { id: true } });
    const vacancyIds = vacancies.map((v) => v.id);
    const interviews = await prisma.interview.findMany({ where: { vacancyId: { in: vacancyIds } }, select: { id: true } });
    const placements = await prisma.placement.findMany({ where: { vacancyId: { in: vacancyIds } }, select: { id: true } });
    const subjectIds = [...businessIds, ...vacancyIds, ...seekerIds, ...interviews.map((i) => i.id), ...placements.map((p) => p.id)];
    await safe(() => prisma.auditLog.deleteMany({ where: { actorId: { in: staffIds } } }));
    await safe(() => prisma.reviewFlag.deleteMany({ where: { subjectId: { in: subjectIds } } }));
    await safe(() => prisma.statusHistory.deleteMany({ where: { subjectId: { in: subjectIds } } }));
    await safe(() => prisma.callTask.deleteMany({ where: { staffId: { in: staffIds } } }));
    await safe(() => prisma.contactAttempt.deleteMany({ where: { jobSeekerId: { in: seekerIds } } }));
    await safe(() => prisma.jobSeekerHit.deleteMany({ where: { jobSeekerId: { in: seekerIds } } }));
    await safe(() => prisma.candidateIntroduction.deleteMany({ where: { jobSeekerId: { in: seekerIds } } }));
    await safe(() => prisma.ownerFavourite.deleteMany({ where: { vacancyId: { in: vacancyIds } } }));
    await safe(() => prisma.payment.deleteMany({ where: { placementId: { in: placements.map((p) => p.id) } } }));
    await safe(() => prisma.placement.deleteMany({ where: { vacancyId: { in: vacancyIds } } }));
    await safe(() => prisma.interview.deleteMany({ where: { vacancyId: { in: vacancyIds } } }));
    await safe(() => prisma.callRecord.deleteMany({ where: { staffId: { in: staffIds } } }));
    await safe(() => prisma.messageLog.deleteMany({ where: { subjectId: { in: [...businessIds, ...seekerIds] } } }));
    await safe(() => prisma.visitAssignment.deleteMany({ where: { businessId: { in: businessIds } } }));
    await safe(() => prisma.businessAgreement.deleteMany({ where: { businessId: { in: businessIds } } }));
    await safe(() => prisma.consent.deleteMany({ where: { subjectId: { in: seekerIds } } }));
    await safe(() => prisma.jobSeekerTrade.deleteMany({ where: { jobSeekerId: { in: seekerIds } } }));
    await safe(() => prisma.jobSeekerLanguage.deleteMany({ where: { jobSeekerId: { in: seekerIds } } }));
    await safe(() => prisma.jobSeeker.deleteMany({ where: { id: { in: seekerIds } } }));
    await safe(() => prisma.vacancyInterviewSlot.deleteMany({ where: { vacancyId: { in: vacancyIds } } }));
    await safe(() => prisma.vacancy.deleteMany({ where: { id: { in: vacancyIds } } }));
    await safe(() => prisma.business.deleteMany({ where: { id: { in: businessIds } } }));
    await safe(() => prisma.attendanceDay.deleteMany({ where: { staffId: { in: staffIds } } }));
    await safe(() => prisma.staff.deleteMany({ where: { id: { in: staffIds } } }));
    await app.close();
  }, 120000);

  async function makeStaff(role: string, label: string, teamLeadId?: string) {
    const staff = await prisma.staff.create({
      data: {
        code: `FS-${label}-${suffix}`, name: `Selling ${label}`, email: `fs-${label.toLowerCase()}-${suffix.toLowerCase()}@laboura.local`,
        passwordHash: 'not-used', role, status: 'active', city: 'Bengaluru', teamLeadId: teamLeadId ?? null,
        callRoutingPhone: encryptCallRoutingPhone(`+9198${String(Date.now()).slice(-8)}`),
      },
    });
    staffIds.push(staff.id);
    return staff;
  }

  async function makeSeeker(label: string, index: number) {
    const phone = `+918${String(100000000 + Number.parseInt(suffix.slice(-6), 16) * 10 + index).slice(-9)}`;
    const seeker = await prisma.jobSeeker.create({
      data: {
        code: `JS-FS${label}-${suffix}`, name: `${label} Kumar`, phone, phoneVerified: true,
        minSalary: 1500000, maxSalary: 1800000, preferredCallWindowStart: '09:00', preferredCallWindowEnd: '21:00',
        status: 'active', paymentReceivedAt: clock.now(), dateOfBirth: new Date('1995-01-01T00:00:00.000Z'),
        latitude: 12.9616, longitude: 77.5946, travelDistanceKm: 10, salaryPeriod: 'monthly',
        shiftPreference: 'day', locality: 'Madiwala', jobType: 'full_time',
        trades: { create: { trade: 'Electrician', yearsExperience: 4, isPrimary: true } },
        languages: { create: { language: 'Kannada', speaks: true, reads: false, writes: false } },
      },
    });
    seekerIds.push(seeker.id);
    await prisma.consent.createMany({
      data: ['job_matching', 'profile_sharing', 'call_recording'].map((purpose) => ({
        subjectType: 'job_seeker', subjectId: seeker.id, purpose, granted: true,
        noticeVersion: `fs-${suffix}`, language: 'en', method: 'in_app', grantedAt: clock.now(),
      })),
    });
    return seeker;
  }

  async function answeredCall(token: string, vacancyId: string, jobSeekerId: string) {
    const placed = await request(server()).post('/field-selling/calls').set('Authorization', `Bearer ${token}`)
      .send({ vacancyId, jobSeekerId }).expect(201);
    const callRecordId = placed.body.callRecordId as string;
    // "Answered" comes only from the phone system's webhook; the test stands in for it.
    await prisma.callRecord.update({ where: { id: callRecordId }, data: { answered: true, providerStatus: 'completed', answeredAt: clock.now() } });
    return callRecordId;
  }

  function codeOf(requestId: string): string {
    return (otp.getProvider() as MockOtpProvider).getCode(requestId)!;
  }

  it('sells in the shop: a no is a hit, a yes is the first interview, and the owner decides by OTP', async () => {
    const teamLead = await makeStaff('team_lead', 'TL');
    const agent = await makeStaff('field_agent', 'FA', teamLead.id);
    const otherAgent = await makeStaff('field_agent', 'FB', teamLead.id);
    const manager = await makeStaff('manager', 'MG');
    await openAvailableDay(app, agent.id);
    const token = tokenFor(agent);
    const otherToken = tokenFor(otherAgent);
    const policy = await app.get(PricingService).current();

    const businessPhone = `+917${String(100000000 + Number.parseInt(suffix.slice(-6), 16)).slice(-9)}`;
    const business = await prisma.business.create({
      data: {
        code: `BZ-FS-${suffix}`, name: `Annapoorna Mess ${suffix}`, phone: businessPhone, ownerName: 'Shankar',
        contactRole: 'owner', city: 'Bengaluru', locality: 'BTM Layout', latitude: 12.9716, longitude: 77.5946,
        verificationStatus: 'pending_tl_check', inPersonOnboardedAt: clock.now(),
        accountAgentId: agent.id, accountAgentAssignedAt: clock.now(), leadCreatedByStaffId: agent.id,
      },
    });
    businessIds.push(business.id);
    await prisma.businessAgreement.create({
      data: {
        businessId: business.id, version: 'fs-test', termsHash: randomUUID(), noBypassMonths: policy.noBypassMonths,
        noBypassPenaltyPercent: policy.noBypassPenaltyPercent, feePercent: policy.placementFeePercent, gstPercent: policy.gstPercent,
        signedName: 'Shankar', signedPhone: businessPhone, otpRequestId: `fs-${suffix}`, signedAt: clock.now(),
        documentStoragePath: `fs/${suffix}.html`,
      },
    });
    const vacancy = await prisma.vacancy.create({
      data: {
        code: `VC-FS-${suffix}`, city: 'Bengaluru', businessId: business.id, capturedByStaffId: agent.id,
        tradeSkill: 'Electrician', headcount: 3, status: 'open', salaryMinPaise: 1600000, salaryMaxPaise: 2000000,
        salaryPeriod: 'monthly', shift: 'day', latitude: 12.9716, longitude: 77.5946, locality: 'BTM Layout',
        interviewType: 'walk_in',
      },
    });
    const [yes, no, notSelected, booked, phone] = await Promise.all(
      ['Manjunath', 'Sunil', 'Revathi', 'Ramesh', 'Arjun'].map((label, i) => makeSeeker(label, i)),
    );

    // Settings: the fee calculator reads the percentages from Settings; Managers see no money.
    const settings = await request(server()).get('/screens/field-selling/settings').set('Authorization', `Bearer ${token}`).expect(200);
    expect(settings.body).toMatchObject({ feePercent: policy.placementFeePercent, gstPercent: policy.gstPercent, threeWayCalls: true });
    await request(server()).get('/screens/field-selling/settings').set('Authorization', `Bearer ${tokenFor(manager)}`).expect(403);

    // Type-ahead finds the business; the agent's own list has it.
    const search = await request(server()).get('/screens/field-selling/businesses').query({ q: 'Annapoorna' })
      .set('Authorization', `Bearer ${token}`).expect(200);
    expect(search.body.results.find((b: { id: string }) => b.id === business.id)).toMatchObject({
      canShowCandidates: true, signedToday: true, isMine: true, openVacancies: 3,
    });
    const mine = await request(server()).get('/screens/field-selling/businesses').set('Authorization', `Bearer ${token}`).expect(200);
    expect(mine.body.results.map((b: { id: string }) => b.id)).toContain(business.id);

    // Matches: best 3, no phone numbers, rough area only; the heart is stored.
    await request(server()).post(`/field-selling/vacancies/${vacancy.id}/favourites/${yes.id}`).set('Authorization', `Bearer ${token}`).expect(201);
    await request(server()).post(`/field-selling/vacancies/${vacancy.id}/favourites/${yes.id}`).set('Authorization', `Bearer ${otherToken}`).expect(403);
    const matches = await request(server()).get(`/screens/field-selling/vacancies/${vacancy.id}/matches`).set('Authorization', `Bearer ${token}`).expect(200);
    expect(matches.body.pageSize).toBe(policy.matchPageSize);
    expect(matches.body.total).toBeGreaterThanOrEqual(5);
    expect(JSON.stringify(matches.body)).not.toContain(yes.phone);
    expect(matches.body.likedCount).toBe(1);
    for (const row of matches.body.matches as Array<{ jobSeekerId: string; liked: boolean; area: { latitude: number | null } }>) {
      expect(row.liked).toBe(row.jobSeekerId === yes.id);
      if (row.area.latitude !== null) expect(Math.round(row.area.latitude * 100) / 100).toBe(row.area.latitude);
    }
    const card = await request(server()).get(`/screens/field-selling/candidates/${yes.id}`).query({ vacancyId: vacancy.id })
      .set('Authorization', `Bearer ${token}`).expect(200);
    expect(card.body).toMatchObject({ firstName: 'Manjunath', liked: true, suitable: true, distanceKm: 1, locality: 'Madiwala' });
    expect(JSON.stringify(card.body)).not.toContain(yes.phone);
    expect(card.body).not.toHaveProperty('dateOfBirth');

    // Only the account agent calls for this business.
    await request(server()).post('/field-selling/calls').set('Authorization', `Bearer ${otherToken}`)
      .send({ vacancyId: vacancy.id, jobSeekerId: yes.id }).expect(403);

    // Sunil says no on the call: a hit, because the job suited him on every count.
    const noCall = await answeredCall(token, vacancy.id, no.id);
    await request(server()).post(`/field-selling/calls/${noCall}/answer`).set('Authorization', `Bearer ${token}`)
      .send({ answer: 'no' }).expect(400);
    const declined = await request(server()).post(`/field-selling/calls/${noCall}/answer`).set('Authorization', `Bearer ${token}`)
      .send({ answer: 'no', reason: 'too_far' }).expect(201);
    expect(declined.body).toMatchObject({ status: 'declined', hit: true });
    expect(await prisma.jobSeekerHit.count({ where: { jobSeekerId: no.id, reason: 'offer_declined' } })).toBe(1);

    // An unanswered call cannot carry an answer (connected comes only from the phone system).
    const unanswered = await request(server()).post('/field-selling/calls').set('Authorization', `Bearer ${token}`)
      .send({ vacancyId: vacancy.id, jobSeekerId: yes.id }).expect(201);
    await request(server()).post(`/field-selling/calls/${unanswered.body.callRecordId}/answer`).set('Authorization', `Bearer ${token}`)
      .send({ answer: 'yes' }).expect(400);

    // Manjunath says yes → in-shop interview; the agent hands his phone to the owner.
    const yesCall = await answeredCall(token, vacancy.id, yes.id);
    const confirmed = await request(server()).post(`/field-selling/calls/${yesCall}/answer`).set('Authorization', `Bearer ${token}`)
      .send({ answer: 'yes' }).expect(201);
    expect(confirmed.body).toMatchObject({ status: 'confirmed', hit: false });
    const again = await request(server()).post(`/field-selling/calls/${yesCall}/answer`).set('Authorization', `Bearer ${token}`)
      .send({ answer: 'yes' }).expect(201);
    expect(again.body.interviewId).toBe(confirmed.body.interviewId);
    const interviewId = confirmed.body.interviewId as string;
    await request(server()).post(`/field-selling/interviews/${interviewId}/hand-over`).set('Authorization', `Bearer ${token}`).expect(201);
    expect((await prisma.interview.findUniqueOrThrow({ where: { id: interviewId } })).interviewType).toBe('in_shop_call');

    // Selected now: the owner confirms salary and joining date on his own phone by OTP.
    const joiningDate = istDateKey(clock.now(), 5);
    const decisionBody = { decision: 'selected', salaryPaise: 1700000, joiningDate };
    await request(server()).post(`/field-selling/interviews/${interviewId}/owner-otp`).set('Authorization', `Bearer ${token}`)
      .send({ ...decisionBody, joiningDate: istDateKey(clock.now(), -1) }).expect(400);
    const otpSent = await request(server()).post(`/field-selling/interviews/${interviewId}/owner-otp`).set('Authorization', `Bearer ${token}`)
      .send(decisionBody).expect(201);
    expect(otpSent.body.sentToLast4).toBe(businessPhone.slice(-4));
    expect(sent.some((m) => m.template === 'interview_result_confirm_details' && m.variables.decision === 'selected')).toBe(true);
    await request(server()).post(`/field-selling/interviews/${interviewId}/decision`).set('Authorization', `Bearer ${token}`)
      .send({ ...decisionBody, otpRequestId: otpSent.body.otpRequestId, code: '000000' }).expect(400);
    const selected = await request(server()).post(`/field-selling/interviews/${interviewId}/decision`).set('Authorization', `Bearer ${token}`)
      .send({ ...decisionBody, otpRequestId: otpSent.body.otpRequestId, code: codeOf(otpSent.body.otpRequestId) });
    // A wrong code consumed nothing; if the mock locked the request, resend and try again.
    let selectedBody = selected.body;
    if (selected.status !== 201) {
      const resent = await request(server()).post(`/field-selling/interviews/${interviewId}/owner-otp`).set('Authorization', `Bearer ${token}`)
        .send(decisionBody).expect(201);
      selectedBody = (await request(server()).post(`/field-selling/interviews/${interviewId}/decision`).set('Authorization', `Bearer ${token}`)
        .send({ ...decisionBody, otpRequestId: resent.body.otpRequestId, code: codeOf(resent.body.otpRequestId) }).expect(201)).body;
    }
    const fee = calculatePlacementFee(1700000, policy.placementFeePercent);
    expect(selectedBody).toMatchObject({ decision: 'selected', placement: { status: 'awaiting_payment', feePaise: fee, gstPaise: calculateGst(fee, policy.gstPercent) } });
    const afterSelect = await prisma.interview.findUniqueOrThrow({ where: { id: interviewId } });
    expect(afterSelect).toMatchObject({ status: 'completed', result: 'selected', resultRecordedByStaffId: agent.id, selectedSalaryPaise: 1700000 });
    const view = await request(server()).get(`/screens/field-selling/interviews/${interviewId}`).set('Authorization', `Bearer ${token}`).expect(200);
    expect(view.body.placement).toMatchObject({ status: 'awaiting_payment', agreedSalaryPaise: 1700000 });
    expect(JSON.stringify(view.body)).not.toContain(businessPhone);

    // Revathi: yes, then Not selected with a reason by OTP — no hit for her.
    const nsCall = await answeredCall(token, vacancy.id, notSelected.id);
    const nsInterview = (await request(server()).post(`/field-selling/calls/${nsCall}/answer`).set('Authorization', `Bearer ${token}`)
      .send({ answer: 'yes' }).expect(201)).body.interviewId as string;
    const nsOtp = await request(server()).post(`/field-selling/interviews/${nsInterview}/owner-otp`).set('Authorization', `Bearer ${token}`)
      .send({ decision: 'not_selected', reason: 'experience' }).expect(201);
    await request(server()).post(`/field-selling/interviews/${nsInterview}/decision`).set('Authorization', `Bearer ${token}`)
      .send({ decision: 'not_selected', reason: 'experience', otpRequestId: nsOtp.body.otpRequestId, code: codeOf(nsOtp.body.otpRequestId) })
      .expect(201);
    expect(await prisma.interview.findUniqueOrThrow({ where: { id: nsInterview } })).toMatchObject({ status: 'completed', result: 'not_selected', resultReason: 'experience' });
    expect(await prisma.jobSeekerHit.count({ where: { jobSeekerId: notSelected.id } })).toBe(0);

    // Book an interview for tomorrow at 11:00 at the shop, "I will attend".
    const tomorrow = istDateKey(clock.now(), 1);
    await request(server()).post('/field-selling/interviews').set('Authorization', `Bearer ${token}`)
      .send({ vacancyId: vacancy.id, jobSeekerId: booked.id, date: istDateKey(clock.now(), -1), time: '11:00', type: 'at_shop' }).expect(400);
    const bookedRes = await request(server()).post('/field-selling/interviews').set('Authorization', `Bearer ${token}`)
      .send({ vacancyId: vacancy.id, jobSeekerId: booked.id, date: tomorrow, time: '11:00', type: 'at_shop', agentWillAttend: true }).expect(201);
    expect(bookedRes.body).toMatchObject({ type: 'at_shop', agentWillAttend: true });
    const bookedRow = await prisma.interview.findUniqueOrThrow({ where: { id: bookedRes.body.interviewId } });
    expect(bookedRow).toMatchObject({ status: 'offered', interviewType: 'at_shop', agentWillAttend: true });
    expect(bookedRow.slotStartsAt.toISOString()).toBe(istInstant(tomorrow, '11:00').toISOString());
    expect(bookedRow.slotEndsAt.getTime() - bookedRow.slotStartsAt.getTime()).toBe(60 * 60 * 1000);

    // Interview day: he said yes; the agent marks "candidate arrived" with GPS at the shop.
    await prisma.interview.update({ where: { id: bookedRow.id }, data: { status: 'confirmed', candidateRespondedAt: clock.now() } });
    const arrivalBody = { arrived: true, latitude: 12.9717, longitude: 77.5946, accuracyM: 8 };
    await request(server()).post(`/field-selling/interviews/${bookedRow.id}/arrival`).set('Authorization', `Bearer ${token}`)
      .send(arrivalBody).expect(400); // not the interview day yet
    clock.current = istInstant(tomorrow, '10:55');
    const arrived = await request(server()).post(`/field-selling/interviews/${bookedRow.id}/arrival`).set('Authorization', `Bearer ${token}`)
      .send(arrivalBody).expect(201);
    expect(arrived.body.distanceMeters).toBeLessThan(30);
    expect(await prisma.interview.findUniqueOrThrow({ where: { id: bookedRow.id } })).toMatchObject({ candidateArrivedByStaffId: agent.id });
    await request(server()).post(`/field-selling/interviews/${bookedRow.id}/arrival`).set('Authorization', `Bearer ${token}`)
      .send({ arrived: false, latitude: 12.9717, longitude: 77.5946 }).expect(400);

    // Phone interview: Laboura rings both at the set time (3-way call through the calling system).
    clock.current = istInstant(istDateKey(clock.now()), '11:30');
    const phoneDay = istDateKey(clock.now(), 1);
    const phoneRes = await request(server()).post('/field-selling/interviews').set('Authorization', `Bearer ${token}`)
      .send({ vacancyId: vacancy.id, jobSeekerId: phone.id, date: phoneDay, time: '12:00', type: 'phone' }).expect(201);
    await prisma.interview.update({ where: { id: phoneRes.body.interviewId }, data: { status: 'confirmed', candidateRespondedAt: clock.now() } });
    clock.current = istInstant(phoneDay, '12:05');
    await expect(selling.processDuePhoneInterviews(clock.now())).resolves.toEqual({ dialled: 1 });
    await expect(selling.processDuePhoneInterviews(clock.now())).resolves.toEqual({ dialled: 0 });
    expect(telephony.lastThreeWay?.recordCall).toBe(true);
    const phoneRow = await prisma.interview.findUniqueOrThrow({ where: { id: phoneRes.body.interviewId } });
    expect(phoneRow.phoneInterviewCallRecordId).toBeTruthy();
    expect(await prisma.callRecord.findUniqueOrThrow({ where: { id: phoneRow.phoneInterviewCallRecordId! } }))
      .toMatchObject({ purpose: 'phone_interview', subjectId: phone.id });

    // Why there are no more: counts only.
    const why = await request(server()).get(`/screens/field-selling/vacancies/${vacancy.id}/no-more`).set('Authorization', `Bearer ${token}`).expect(200);
    expect(why.body.withinDistance).toBeGreaterThanOrEqual(5);
    expect(why.body).toHaveProperty('leftOutSalaryAbove');
  }, 120000);

  it('records a complaint from an owner call for the Team Lead, with the call', async () => {
    const teamLead = await makeStaff('team_lead', 'TL2');
    const agent = await makeStaff('field_agent', 'FC', teamLead.id);
    const business = await prisma.business.create({
      data: {
        code: `BZ-FS2-${suffix}`, name: `Green Leaf ${suffix}`, phone: `+916${String(100000000 + Number.parseInt(suffix.slice(-6), 16)).slice(-9)}`,
        city: 'Bengaluru', verificationStatus: 'verified', accountAgentId: agent.id,
      },
    });
    businessIds.push(business.id);
    const call = await prisma.callRecord.create({
      data: {
        code: `CR-FS-${suffix}`, provider: 'mock', providerCallId: `fs-${suffix}`, direction: 'outbound', staffId: agent.id,
        subjectType: 'business', subjectId: business.id, purpose: 'check_in', providerStatus: 'completed', answered: true,
      },
    });
    await request(server()).post(`/field-selling/owner-calls/${call.id}/outcome`).set('Authorization', `Bearer ${tokenFor(agent)}`)
      .send({ outcome: 'complaint', note: 'Worker late every day' }).expect(201);
    const flag = await prisma.reviewFlag.findFirst({ where: { kind: 'owner_complaint', subjectId: business.id } });
    expect(flag).toMatchObject({ raisedForStaffId: teamLead.id });
    expect((flag?.details as { callRecordId: string }).callRecordId).toBe(call.id);
    expect(await prisma.callRecord.findUniqueOrThrow({ where: { id: call.id } })).toMatchObject({ agentOutcome: 'other' });
  }, 60000);
});
