import { INestApplication, Injectable } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { JwtService } from '@nestjs/jwt';
import { randomUUID } from 'crypto';
import * as request from 'supertest';
import { AppModule } from '../../app.module';
import { PrismaService } from '../../common/prisma/prisma.service';
import { ConsentClock } from '../consent/consent-clock';
import { ConsentLinkService } from '../consent/consent-link.service';
import { PricingService } from '../pricing/pricing.service';
import { OtpService } from '../../common/otp/otp.service';
import { MockOtpProvider } from '../../common/otp/mock-otp.provider';
import { SMS_PROVIDER, SmsProvider } from '../message/sms.provider';
import { WHATSAPP_PROVIDER, WhatsAppProvider } from '../../common/whatsapp/whatsapp.interface';
import { calculateGst, calculatePlacementFee } from '../../common/money/money';
import { MatchingService } from './matching.service';
import { InterviewService } from './interview.service';

@Injectable()
class Phase15GateClock extends ConsentClock {
  current = new Date();
  override now() { return new Date(this.current); }
}

describe('Phase 15 gate end-to-end proof', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let jwt: JwtService;
  let otp: OtpService;
  let clock: Phase15GateClock;
  let links: ConsentLinkService;
  let interviews: InterviewService;
  let pricing: PricingService;
  let matching: MatchingService;

  const suffix = randomUUID().replace(/-/g, '').slice(0, 12).toUpperCase();
  const staffIds: string[] = [];
  const businessIds: string[] = [];
  const vacancyIds: string[] = [];
  const slotIds: string[] = [];
  const seekerIds: string[] = [];
  const interviewIds: string[] = [];
  const placementIds: string[] = [];
  const paymentIds: string[] = [];
  const callIds: string[] = [];
  const sentSms: Array<{ phone: string; template: string; variables: Record<string, string> }> = [];
  const sentWhatsApp: Array<{ phone: string; template: string; variables: Record<string, string> }> = [];
  const actionTokens = new Map<string, string>();
  let staffToken = '';
  let teamLeadToken = '';
  let businessPhone = '';
  let fieldAgentId = '';
  let businessId = '';
  let vacancyId = '';
  let slotId = '';
  let offerClock: Date;
  let slotStartsAt: Date;
  let slotEndsAt: Date;
  let policy: Awaited<ReturnType<PricingService['current']>>;

  beforeAll(async () => {
    process.env.PUBLIC_APP_URL = 'https://app.laboura.in';
    clock = new Phase15GateClock();
    clock.current = new Date();
    offerClock = clock.now();
    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit', day: '2-digit',
    }).formatToParts(offerClock);
    const year = Number(parts.find((part) => part.type === 'year')?.value);
    const month = Number(parts.find((part) => part.type === 'month')?.value);
    const day = Number(parts.find((part) => part.type === 'day')?.value);
    slotStartsAt = new Date(Date.UTC(year, month - 1, day + 1, 10, 30) - 330 * 60 * 1000);
    slotEndsAt = new Date(slotStartsAt.getTime() + 60 * 60 * 1000);

    const smsProvider: SmsProvider = {
      sendTemplate: async (phone, template, _dltTemplateId, variables) => {
        sentSms.push({ phone, template, variables });
        return { messageId: `phase15_sms_${randomUUID()}`, status: 'sent' };
      },
    };
    const whatsappProvider: WhatsAppProvider = {
      sendTemplateMessage: async (phone, templateName, params) => {
        sentWhatsApp.push({ phone, template: templateName, variables: params });
        return {
          messageId: `phase15_wa_${randomUUID()}`, status: 'sent', phone, templateName, timestamp: new Date(),
        };
      },
    };
    const moduleRef: TestingModule = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(ConsentClock).useValue(clock)
      .overrideProvider(SMS_PROVIDER).useValue(smsProvider)
      .overrideProvider(WHATSAPP_PROVIDER).useValue(whatsappProvider)
      .compile();
    app = moduleRef.createNestApplication();
    await app.init();
    prisma = app.get(PrismaService);
    jwt = app.get(JwtService);
    otp = app.get(OtpService);
    links = app.get(ConsentLinkService);
    interviews = app.get(InterviewService);
    pricing = app.get(PricingService);
    matching = app.get(MatchingService);
    policy = await pricing.current();

    const originalCreateToken = links.createInterviewActionToken.bind(links);
    jest.spyOn(links, 'createInterviewActionToken').mockImplementation((id, purpose, phone, expiresAt) => {
      const token = originalCreateToken(id, purpose, phone, expiresAt);
      actionTokens.set(`${id}:${purpose}`, token);
      return token;
    });
  }, 120000);

  afterAll(async () => {
    if (!prisma) return;
    const subjectIds = [...businessIds, ...vacancyIds, ...seekerIds, ...interviewIds, ...placementIds, ...paymentIds];
    await prisma.auditLog.deleteMany({ where: { actorId: { in: staffIds } } });
    await prisma.reviewFlag.deleteMany({ where: { subjectId: { in: subjectIds } } });
    await prisma.statusHistory.deleteMany({ where: { subjectId: { in: subjectIds } } });
    await prisma.contactAttempt.deleteMany({ where: { jobSeekerId: { in: seekerIds } } });
    await prisma.jobSeekerHit.deleteMany({ where: { jobSeekerId: { in: seekerIds } } });
    await prisma.candidateIntroduction.deleteMany({ where: { jobSeekerId: { in: seekerIds } } });
    await prisma.payment.deleteMany({ where: { id: { in: paymentIds } } });
    await prisma.placement.deleteMany({ where: { id: { in: placementIds } } });
    await prisma.interview.deleteMany({ where: { id: { in: interviewIds } } });
    await prisma.callRecord.deleteMany({ where: { id: { in: callIds } } });
    await prisma.messageLog.deleteMany({ where: { subjectId: { in: [...businessIds, ...seekerIds] } } });
    await prisma.visitAssignment.deleteMany({ where: { businessId: { in: businessIds } } });
    await prisma.fieldCheckIn.deleteMany({ where: { staffId: { in: staffIds } } });
    await prisma.businessAgreement.deleteMany({ where: { businessId: { in: businessIds } } });
    await prisma.consent.deleteMany({ where: { subjectId: { in: seekerIds } } });
    await prisma.jobSeekerTrade.deleteMany({ where: { jobSeekerId: { in: seekerIds } } });
    await prisma.jobSeekerLanguage.deleteMany({ where: { jobSeekerId: { in: seekerIds } } });
    await prisma.jobSeeker.deleteMany({ where: { id: { in: seekerIds } } });
    await prisma.vacancyInterviewSlot.deleteMany({ where: { id: { in: slotIds } } });
    await prisma.vacancy.deleteMany({ where: { id: { in: vacancyIds } } });
    await prisma.business.deleteMany({ where: { id: { in: businessIds } } });
    await prisma.staff.deleteMany({ where: { id: { in: staffIds } } });
    await app.close();
  }, 120000);

  it('proves the selected, no-reply, and no-result journeys through the public link and payment flows', async () => {
    const passwordHash = 'not-used-by-this-proof';
    const fieldAgent = await prisma.staff.create({
      data: {
        code: `P15-FA-${suffix}`, name: 'Phase 15 Field Agent', email: `p15-fa-${suffix.toLowerCase()}@laboura.local`,
        passwordHash, role: 'field_agent', status: 'active', city: 'Bengaluru',
      },
    });
    fieldAgentId = fieldAgent.id;
    staffIds.push(fieldAgent.id);
    const teamLead = await prisma.staff.create({
      data: {
        code: `P15-TL-${suffix}`, name: 'Phase 15 Team Lead', email: `p15-tl-${suffix.toLowerCase()}@laboura.local`,
        passwordHash, role: 'team_lead', status: 'active', city: 'Bengaluru',
      },
    });
    staffIds.push(teamLead.id);
    await prisma.staff.update({ where: { id: fieldAgent.id }, data: { teamLeadId: teamLead.id } });
    teamLeadToken = jwt.sign({ sub: teamLead.id, role: teamLead.role, code: teamLead.code, email: teamLead.email });
    const callAgent = await prisma.staff.create({
      data: {
        code: `P15-CA-${suffix}`, name: 'Phase 15 Call Agent', email: `p15-ca-${suffix.toLowerCase()}@laboura.local`,
        passwordHash, role: 'call_agent', status: 'active', city: 'Bengaluru',
      },
    });
    staffIds.push(callAgent.id);
    staffToken = jwt.sign({ sub: callAgent.id, role: callAgent.role, code: callAgent.code, email: callAgent.email });

    businessPhone = `9${String(Math.floor(100000000 + Math.random() * 900000000))}`;
    const business = await prisma.business.create({
      data: {
        code: `BZ-P15-${suffix}`, name: `Phase 15 Verified Electrical Shop ${suffix}`,
        address: `Private business address ${suffix}`, phone: businessPhone, ownerName: 'Proof Owner',
        city: 'Bengaluru', locality: `Gate Area ${suffix}`, latitude: 12.9716, longitude: 77.5946,
        verificationStatus: 'verified', verifiedAt: offerClock, verifiedByStaffId: callAgent.id,
        accountAgentId: fieldAgent.id, accountAgentAssignedAt: offerClock, leadCreatedByStaffId: fieldAgent.id,
      },
    });
    businessId = business.id;
    businessIds.push(business.id);
    await prisma.businessAgreement.create({
      data: {
        businessId, version: 'phase15-gate-proof', termsHash: randomUUID(),
        noBypassMonths: policy.noBypassMonths, noBypassPenaltyPercent: policy.noBypassPenaltyPercent,
        feePercent: policy.placementFeePercent, gstPercent: policy.gstPercent,
        signedName: 'Proof Owner', signedPhone: businessPhone, otpRequestId: `proof-${suffix}`,
        signedAt: offerClock, documentStoragePath: `phase15-proof/${suffix}.html`,
      },
    });

    const vacancy = await prisma.vacancy.create({
      data: {
        code: `VC-P15-${suffix}`, city: 'Bengaluru', businessId, capturedByStaffId: callAgent.id,
        tradeSkill: 'Electrician', roleTitle: 'Electrician', headcount: 3, status: 'open',
        salaryMinPaise: 1500000, salaryMaxPaise: 1800000, salaryPeriod: 'monthly', shift: 'day',
        latitude: 12.9716, longitude: 77.5946, locality: `Gate Area ${suffix}`, experienceRequiredYears: 2,
        languagesRequired: ['Kannada'], licencesRequired: [], interviewType: 'walk_in',
      },
    });
    vacancyId = vacancy.id;
    vacancyIds.push(vacancy.id);
    const slot = await prisma.vacancyInterviewSlot.create({
      data: { vacancyId, startsAt: slotStartsAt, endsAt: slotEndsAt, capacity: 3 },
    });
    slotId = slot.id;
    slotIds.push(slot.id);

    await prisma.fieldCheckIn.create({
      data: { staffId: fieldAgent.id, latitude: 12.9716, longitude: 77.5946, accuracyMeters: 5, checkedInAt: offerClock },
    });

    const candidates = await Promise.all(['Selected', 'NoReply', 'NoResult'].map(async (label, index) => {
      const phone = `8${String(100000000 + Number.parseInt(suffix.slice(-7), 16) + index).slice(-9)}`;
      const seeker = await prisma.jobSeeker.create({
        data: {
          code: `JS-P15-${label}-${suffix}`, name: `Phase 15 ${label} Candidate`, phone, phoneVerified: true,
          minSalary: 1500000, maxSalary: 1800000, preferredCallWindowStart: '09:00', preferredCallWindowEnd: '21:00',
          status: 'active', paymentReceivedAt: offerClock, dateOfBirth: new Date('1990-01-01T00:00:00.000Z'),
          latitude: 12.9716, longitude: 77.5946, travelDistanceKm: 20, salaryPeriod: 'monthly',
          shiftPreference: 'day', locality: `Gate Area ${suffix}`, jobType: 'full_time',
          trades: { create: { trade: 'Electrician', yearsExperience: 4, isPrimary: true } },
          languages: { create: { language: 'Kannada', speaks: true, reads: true, writes: true } },
        },
      });
      seekerIds.push(seeker.id);
      await prisma.consent.createMany({
        data: ['job_matching', 'profile_sharing', 'call_recording'].map((purpose) => ({
          subjectType: 'job_seeker', subjectId: seeker.id, purpose, granted: true,
          noticeVersion: `phase15-gate-${suffix}`, language: 'en', method: 'in_app', grantedAt: offerClock,
        })),
      });
      return seeker;
    }));

    const shortlist = await matching.match(vacancyId, { page: 1 });
    expect(shortlist.matches.map((candidate) => candidate.jobSeekerId)).toContain(candidates[0].id);
    const server = app.getHttpServer();
    const offerSmsStart = sentSms.length;
    const offerWaStart = sentWhatsApp.length;
    const booked = [] as Array<{ id: string; jobSeekerId: string }>;
    for (const seeker of candidates) {
      const response = await request(server).post('/interviews').set('Authorization', `Bearer ${staffToken}`)
        .send({ vacancyId, jobSeekerId: seeker.id, slotId }).expect(201);
      booked.push({ id: response.body.id as string, jobSeekerId: seeker.id });
      interviewIds.push(response.body.id as string);
      expect(response.body.status).toBe('offered');
      expect(response.body.agentAttendanceRequired).toBe(booked.length === 1);
    }
    const offerSms = sentSms.slice(offerSmsStart).filter(({ template }) => template === 'interview_offer');
    expect(offerSms).toHaveLength(candidates.length);
    expect(offerSms.every(({ variables }) => !JSON.stringify(variables).includes(business.name) && !JSON.stringify(variables).includes(business.address!))).toBe(true);
    expect(offerSms.every(({ variables }) => variables.link.startsWith('https://app.laboura.in/interviews/reply/'))).toBe(true);
    expect(sentWhatsApp.slice(offerWaStart).filter(({ template }) => template === 'interview_offer')).toHaveLength(candidates.length);
    expect(await prisma.candidateIntroduction.count({ where: { vacancyId, channel: 'interview' } })).toBe(candidates.length);

    const candidateReplyToken = actionTokens.get(`${booked[0].id}:candidate_reply`)!;
    await request(server).get(`/interviews/reply/${candidateReplyToken}`).expect(200).expect((response) => {
      expect(response.text).toContain('Can you attend this interview?');
      expect(response.text).not.toContain(business.name);
      expect(response.text).not.toContain(business.address);
    });
    await request(server).post(`/interviews/reply/${candidateReplyToken}`).send({ answer: 'yes' }).expect(201);
    const confirmed = await prisma.interview.findUniqueOrThrow({ where: { id: booked[0].id } });
    expect(confirmed.status).toBe('confirmed');
    const bookedMessages = sentWhatsApp.filter(({ template, phone }) => template === 'interview_booked' && phone === candidates[0].phone);
    expect(bookedMessages).toHaveLength(1);
    expect(bookedMessages[0].variables.businessName).toBe(business.name);
    expect(bookedMessages[0].variables.address).toBe(business.address);
    expect(sentSms.filter(({ template, phone }) => template === 'interview_booked' && phone === candidates[0].phone)).toHaveLength(1);
    const attendance = await prisma.visitAssignment.findFirstOrThrow({
      where: { businessId, purpose: 'interview_attendance', relatedType: 'interview', relatedId: booked[0].id },
    });
    expect(attendance.suggestedStaffId).toBe(fieldAgentId);
    await request(server).post(`/businesses/${businessId}/visit-assignments/${attendance.id}/assign`)
      .set('Authorization', `Bearer ${teamLeadToken}`).send({ assignedStaffId: fieldAgentId }).expect(201);
    expect((await prisma.visitAssignment.findUniqueOrThrow({ where: { id: attendance.id } })).assignedStaffId).toBe(fieldAgentId);

    await request(server).post(`/interviews/reply/${actionTokens.get(`${booked[2].id}:candidate_reply`)!}`)
      .send({ answer: 'yes' }).expect(201);

    clock.current = slotEndsAt;
    expect(await interviews.processResultDeadlines(clock.now())).toMatchObject({ requestsSent: 2, dueNotices: 0, overdueFlags: 0, closed: 0 });
    const resultToken = actionTokens.get(`${booked[0].id}:owner_result`)!;
    const otpResponse = await request(server).post(`/interviews/result/${resultToken}/otp`).send({}).expect(201);
    const otpCode = (otp.getProvider() as MockOtpProvider).getCode(otpResponse.body.requestId)!;
    const joiningDate = new Date(slotStartsAt.getTime() + 7 * 24 * 60 * 60 * 1000);
    const resultResponse = await request(server).post(`/interviews/result/${resultToken}`).send({
      otpRequestId: otpResponse.body.requestId, otpCode, result: 'selected',
      selectedSalaryPaise: 1600000, selectedJoiningDate: joiningDate.toISOString(),
    }).expect(201);
    const placement = resultResponse.body.placement as { id: string; status: string; agreedSalary: number; placementFee: number; gstAmount: number; feePercentAtCreation: number; gstPercentAtCreation: number; payment: { id: string; gatewayReference: string; amount: number; upiReference?: string } };
    placementIds.push(placement.id);
    paymentIds.push(placement.payment.id);
    expect(placement.status).toBe('awaiting_payment');
    expect(placement.agreedSalary).toBe(1600000);
    expect(placement.feePercentAtCreation).toBe(policy.placementFeePercent);
    expect(placement.gstPercentAtCreation).toBe(policy.gstPercent);
    expect(placement.placementFee).toBe(calculatePlacementFee(1600000, policy.placementFeePercent));
    expect(placement.gstAmount).toBe(calculateGst(placement.placementFee, policy.gstPercent));
    expect((await prisma.jobSeeker.findUniqueOrThrow({ where: { id: candidates[0].id } })).status).toBe('active');

    const candidateCheckToken = actionTokens.get(`${booked[0].id}:candidate_check`)!;
    await request(server).get(`/interviews/check/${candidateCheckToken}`).expect(200).expect((response) => {
      expect(response.text).toContain('Did the business offer you the job?');
    });
    await request(server).post(`/interviews/check/${candidateCheckToken}`).send({ answer: 'yes' }).expect(201);
    expect((await prisma.interview.findUniqueOrThrow({ where: { id: booked[0].id } })).candidateCheckAnswer).toBe('offered_yes');

    let paymentGatewayRef = placement.payment.gatewayReference;
    if (!paymentGatewayRef && placement.payment.upiReference) {
      await request(server).post(`/payments/request/${encodeURIComponent(placement.payment.upiReference)}/card`).expect(200);
      const updated = await prisma.payment.findUniqueOrThrow({ where: { id: placement.payment.id } });
      paymentGatewayRef = updated.gatewayReference!;
    }
    const paymentSuccess = { gatewayReference: paymentGatewayRef, status: 'succeeded' };
    await request(server).post('/payments/mock/simulate-webhook').send(paymentSuccess).expect(201);
    const paidPlacement = await prisma.placement.findUniqueOrThrow({ where: { id: placement.id } });
    expect(paidPlacement.status).toBe('confirmed');
    expect(paidPlacement.paidAt).toBeTruthy();
    expect((await prisma.jobSeeker.findUniqueOrThrow({ where: { id: candidates[0].id } })).status).toBe('placed');
    await request(server).post('/payments/mock/simulate-webhook').send(paymentSuccess).expect(201);
    expect(sentSms.filter(({ template, phone }) => template === 'joining_confirmed' && phone === candidates[0].phone)).toHaveLength(1);
    expect(sentWhatsApp.filter(({ template, phone }) => template === 'joining_confirmed' && phone === candidates[0].phone)).toHaveLength(1);

    const noReplyCall = await prisma.callRecord.create({
      data: {
        code: `CL-P15-${suffix}`, provider: 'phase15-gate', providerCallId: `phase15-gate-${suffix}`,
        direction: 'outbound', staffId: callAgent.id, subjectType: 'job_seeker', subjectId: candidates[1].id,
        purpose: 'offer', relatedType: 'interview', relatedId: booked[1].id, providerStatus: 'completed',
        answered: false, startedAt: new Date(offerClock.getTime() + 60 * 60 * 1000),
        endedAt: new Date(offerClock.getTime() + 60 * 60 * 1000 + 30 * 1000), durationSec: 0,
      },
    });
    callIds.push(noReplyCall.id);
    clock.current = new Date(offerClock.getTime() + policy.offerReplyHours * 60 * 60 * 1000);
    expect(await interviews.processDueReplies(clock.now())).toEqual({ processed: 1 });
    expect((await prisma.interview.findUniqueOrThrow({ where: { id: booked[1].id } })).status).toBe('no_reply');
    expect(await prisma.jobSeekerHit.count({ where: { jobSeekerId: candidates[1].id, reason: 'offer_no_reply', interviewId: booked[1].id } })).toBe(1);

    const resultDueAt = await prisma.interview.findUniqueOrThrow({ where: { id: booked[2].id } }).then((row) => row.resultDueAt);
    clock.current = resultDueAt;
    expect(await interviews.processResultDeadlines(clock.now())).toMatchObject({ dueNotices: 1, overdueFlags: 0, closed: 0 });
    expect(await prisma.reviewFlag.count({ where: { kind: 'interview_result_due', subjectId: booked[2].id, status: 'open' } })).toBe(1);
    clock.current = new Date(slotEndsAt.getTime() + policy.interviewResultEscalateHours * 60 * 60 * 1000);
    expect(await interviews.processResultDeadlines(clock.now())).toMatchObject({ overdueFlags: 1, closed: 0 });
    expect(await prisma.reviewFlag.count({ where: { kind: 'interview_result_overdue', subjectId: booked[2].id, status: 'open' } })).toBe(1);
    clock.current = new Date(slotEndsAt.getTime() + policy.interviewResultCloseHours * 60 * 60 * 1000);
    expect(await interviews.processResultDeadlines(clock.now())).toMatchObject({ closed: 1 });
    expect(await interviews.processResultDeadlines(clock.now())).toMatchObject({ closed: 0 });
    const noResult = await prisma.interview.findUniqueOrThrow({ where: { id: booked[2].id } });
    expect(noResult.status).toBe('no_result');
    expect(noResult.candidateCheckAnswer).toBe('no_answer');
    expect(await prisma.reviewFlag.count({ where: { kind: 'interview_no_result', subjectId: businessId, status: 'open' } })).toBe(1);
    expect(await prisma.jobSeekerHit.count({ where: { jobSeekerId: candidates[2].id } })).toBe(0);
    const rematch = await matching.match(vacancyId, { page: 1 });
    expect(rematch.matches.map((candidate) => candidate.jobSeekerId)).toContain(candidates[2].id);

    console.log('PHASE 15 GATE END-TO-END PROOF:', JSON.stringify({
      vacancy: vacancy.code,
      business: business.code,
      selected: {
        interview: (await prisma.interview.findUniqueOrThrow({ where: { id: booked[0].id } })).code,
        placement: paidPlacement.code,
        agreementFeePercent: policy.placementFeePercent,
        agreementGstPercent: policy.gstPercent,
        salaryPaise: placement.agreedSalary,
        feePaise: placement.placementFee,
        gstPaise: placement.gstAmount,
        seekerStatus: 'placed',
        joiningDateMessageSentOnce: true,
      },
      noReply: { interview: booked[1].id, callRecord: noReplyCall.code, hitCount: 1 },
      noResult: { interview: booked[2].id, overdueFlag: true, status: noResult.status, hitCount: 0, reappearsInMatching: true },
      attendanceAssignment: attendance.id,
    }));
  }, 120000);
});
