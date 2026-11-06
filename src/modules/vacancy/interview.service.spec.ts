import { BadRequestException } from '@nestjs/common';
import { InterviewService } from './interview.service';

describe('InterviewService booking', () => {
  type Mock = jest.Mock;
  type TxMock = {
    $queryRaw: Mock;
    vacancyInterviewSlot: { findUnique: Mock };
    interview: { findFirst: Mock; findUnique: Mock; findMany: Mock; count: Mock; create: Mock; update: Mock; updateMany: Mock };
    candidateIntroduction: { create: Mock };
    statusHistory: { create: Mock };
  };
  type PrismaMock = {
    staff: { findUnique: Mock; findFirst: Mock };
    vacancy: { findFirst: Mock };
    jobSeeker: { findFirst: Mock };
    vacancyInterviewSlot: { findUnique: Mock };
    interview: { findUnique: Mock; findMany: Mock; update: Mock; count: Mock };
    callRecord: { findUnique: Mock; findFirst: Mock };
    messageLog: { findMany: Mock };
    reviewFlag: { findFirst: Mock };
    $transaction: Mock;
  };
  const now = new Date('2026-11-06T09:00:00.000Z');
  let service: InterviewService;
  let prisma: PrismaMock;
  let tx: TxMock;
  let messaging: { send: jest.Mock };
  let matching: { match: jest.Mock };
  let hits: { recordHit: jest.Mock };
  let calls: { recordOutcome: jest.Mock };
  let attendance: { createInterviewAttendanceAssignment: jest.Mock };
  let linkService: { createInterviewActionToken: Mock; validateInterviewActionToken: Mock; consumeInterviewActionToken: Mock };
  const previousPublicAppUrl = process.env.PUBLIC_APP_URL;

  const vacancy = {
    id: 'vacancy-id', code: 'VC-00001', businessId: 'business-id', city: 'Bengaluru',
    replacementForPlacementId: null, tradeSkill: 'cook', roleTitle: 'Cook', salaryMinPaise: 1600000,
    salaryMaxPaise: 1800000, salaryPeriod: 'monthly', shift: 'day', locality: 'Indiranagar',
    business: {
      id: 'business-id', verificationStatus: 'verified', accountAgentId: 'field-1',
      leadCreatedByStaffId: null, name: 'PRIVATE BUSINESS', address: 'PRIVATE ADDRESS',
      locality: 'Indiranagar',
    },
  };
  const seeker = {
    id: 'seeker-id', code: 'JS-00001', phone: '+919876543210', travelDistanceKm: 10,
    shiftPreference: 'day',
  };
  const slot = {
    id: 'slot-id', vacancyId: 'vacancy-id', startsAt: new Date('2026-11-10T04:30:00.000Z'),
    endsAt: new Date('2026-11-10T05:30:00.000Z'), capacity: 2,
  };
  const match = {
    jobSeekerId: 'seeker-id', score: 72, matchReasons: ['trade', 'salary'],
    card: {
      trade: 'cook', distanceKm: 2,
      expectedSalary: { minPaise: 1500000, maxPaise: 2000000 }, matchReasons: ['trade'],
    },
  };

  beforeEach(() => {
    process.env.PUBLIC_APP_URL = 'https://app.laboura.example';
    tx = {
      $queryRaw: jest.fn(),
      vacancyInterviewSlot: { findUnique: jest.fn().mockResolvedValue(slot) },
      interview: {
        findFirst: jest.fn().mockResolvedValue(null), findUnique: jest.fn(), findMany: jest.fn(),
        count: jest.fn().mockResolvedValue(0), updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        create: jest.fn().mockImplementation(({ data }) => Promise.resolve({ id: 'interview-id', code: data.code, ...data })),
        update: jest.fn().mockImplementation(({ data }) => Promise.resolve({ id: 'interview-id', ...data })),
      },
      candidateIntroduction: { create: jest.fn().mockResolvedValue({ id: 'intro-id' }) },
      statusHistory: { create: jest.fn().mockResolvedValue({}) },
    };
    prisma = {
      staff: { findUnique: jest.fn().mockResolvedValue({ id: 'call-1', role: 'call_agent' }), findFirst: jest.fn() },
      vacancy: { findFirst: jest.fn().mockResolvedValue(vacancy) },
      jobSeeker: { findFirst: jest.fn().mockResolvedValue(seeker) },
      vacancyInterviewSlot: { findUnique: jest.fn().mockResolvedValue(slot) },
      interview: { findUnique: jest.fn(), findMany: jest.fn(), update: jest.fn().mockResolvedValue({}), count: jest.fn().mockResolvedValue(0) },
      callRecord: { findUnique: jest.fn(), findFirst: jest.fn() },
      messageLog: { findMany: jest.fn().mockResolvedValue([{ channel: 'sms' }, { channel: 'whatsapp' }]) },
      reviewFlag: { findFirst: jest.fn().mockResolvedValue(null) },
      $transaction: jest.fn().mockImplementation((callback: (client: TxMock) => unknown) => callback(tx)),
    };
    messaging = { send: jest.fn().mockImplementation(({ channel }) => Promise.resolve({ id: `msg-${channel}`, status: 'sent' })) };
    matching = { match: jest.fn().mockResolvedValue({ total: 1, pageSize: 10, matches: [match] }) };
    hits = { recordHit: jest.fn().mockResolvedValue({}) };
    calls = { recordOutcome: jest.fn().mockResolvedValue({}) };
    attendance = { createInterviewAttendanceAssignment: jest.fn().mockResolvedValue({ id: 'assignment-id' }) };
    linkService = {
      createInterviewActionToken: jest.fn().mockReturnValue('single-use-token'),
      validateInterviewActionToken: jest.fn().mockReturnValue({ interviewId: 'interview-id' }),
      consumeInterviewActionToken: jest.fn().mockReturnValue({}),
    };
    service = new InterviewService(
      prisma as never,
      { generateCode: jest.fn().mockResolvedValue('INT-00001') } as never,
      { log: jest.fn().mockResolvedValue(undefined) } as never,
      { current: jest.fn().mockResolvedValue({ offerReplyHours: 48, interviewResultDeadline: '20:00' }) } as never,
      { now: () => now } as never,
      linkService as never,
      messaging as never,
      matching as never,
      hits as never,
      calls as never,
      attendance as never,
    );
  });

  afterAll(() => {
    if (previousPublicAppUrl === undefined) delete process.env.PUBLIC_APP_URL;
    else process.env.PUBLIC_APP_URL = previousPublicAppUrl;
  });

  it('refuses candidates absent from the current Phase 14 matching results', async () => {
    matching.match.mockResolvedValue({ total: 0, pageSize: 10, matches: [] });
    await expect(service.book({ vacancyId: 'vacancy-id', jobSeekerId: 'seeker-id', slotId: 'slot-id' }, 'call-1'))
      .rejects.toThrow(BadRequestException);
    expect(tx.interview.create).not.toHaveBeenCalled();
  });

  it('refuses a full slot', async () => {
    tx.interview.count.mockResolvedValue(2);
    await expect(service.book({ vacancyId: 'vacancy-id', jobSeekerId: 'seeker-id', slotId: 'slot-id' }, 'call-1'))
      .rejects.toThrow('The interview slot has no remaining capacity');
  });

  it('refuses replacement vacancies', async () => {
    prisma.vacancy.findFirst.mockResolvedValue({ ...vacancy, replacementForPlacementId: 'placement-id' });
    await expect(service.book({ vacancyId: 'vacancy-id', jobSeekerId: 'seeker-id', slotId: 'slot-id' }, 'call-1'))
      .rejects.toThrow('only available for fresh vacancies');
  });

  it('sends SMS and WhatsApp without business details, records an introduction, and uses the policy reply window', async () => {
    await service.book({ vacancyId: 'vacancy-id', jobSeekerId: 'seeker-id', slotId: 'slot-id' }, 'call-1');

    expect(messaging.send).toHaveBeenCalledTimes(2);
    for (const call of messaging.send.mock.calls) {
      expect(call[0].template).toBe('interview_offer');
      expect(call[0].variables.link).toMatch(/^https:\/\//);
      expect(JSON.stringify(call[0].variables)).not.toContain('PRIVATE BUSINESS');
      expect(JSON.stringify(call[0].variables)).not.toContain('PRIVATE ADDRESS');
      expect(call[0].variables.jobType).toBe('Cook');
      expect(call[0].variables.area).toBe('Indiranagar');
      expect(call[0].variables.salaryRange).toBeTruthy();
      expect(call[0].variables.shift).toBe('day');
      expect(call[0].variables.interviewDay).toBeTruthy();
      expect(call[0].variables.interviewTime).toBeTruthy();
    }
    expect(tx.interview.create.mock.calls[0][0].data.replyDueAt).toEqual(new Date('2026-11-08T09:00:00.000Z'));
    expect(tx.candidateIntroduction.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ channel: 'interview', businessId: 'business-id', jobSeekerId: 'seeker-id' }),
    }));
    expect(tx.interview.create.mock.calls[0][0].data.suitabilitySnapshot).toMatchObject({
      trade: { vacancy: 'cook', matched: 'cook' }, salary: { passed: true }, distance: { passed: true }, shift: { passed: true }, slot: { passed: true },
    });
    expect(tx.interview.create.mock.calls[0][0].data.agentAttendanceRequired).toBe(true);
    expect(attendance.createInterviewAttendanceAssignment).not.toHaveBeenCalled();
  });

  const liveInterview = () => ({
    id: 'interview-id', code: 'INT-00001', status: 'offered', jobSeekerId: 'seeker-id', businessId: 'business-id',
    vacancyId: 'vacancy-id', offerSentAt: now, replyDueAt: new Date(now.getTime() + 48 * 60 * 60 * 1000),
    candidateRespondedAt: null, slotStartsAt: slot.startsAt, callRecordId: null, offerMessageLogIds: ['msg-sms', 'msg-whatsapp'],
    agentAttendanceRequired: true, proposedByStaffId: 'call-1',
    business: { id: 'business-id', name: 'PRIVATE BUSINESS', address: 'PRIVATE ADDRESS', locality: 'Indiranagar', ownerName: 'Owner', additionalContactName: 'Manager', contactName: null },
    jobSeeker: { id: 'seeker-id', name: 'Candidate Sample', photoStoragePath: null },
    vacancy: { locality: 'Indiranagar' },
  });

  it('a Yes link confirms and then sends business details to the candidate and only first name, photo and time to the owner', async () => {
    prisma.interview.findUnique.mockResolvedValue(liveInterview());
    const result = await service.respondFromLink('single-use-token', 'yes');

    expect(result.status).toBe('confirmed');
    expect(tx.interview.updateMany).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ status: 'confirmed' }) }));
    expect(messaging.send).toHaveBeenCalledTimes(4);
    const candidateMessages = messaging.send.mock.calls.filter(([input]) => input.subjectType === 'job_seeker');
    expect(candidateMessages).toHaveLength(2);
    expect(candidateMessages[0][0]).toMatchObject({ template: 'interview_booked', variables: { businessName: 'PRIVATE BUSINESS', address: 'PRIVATE ADDRESS' } });
    const ownerMessages = messaging.send.mock.calls.filter(([input]) => input.subjectType === 'business');
    expect(ownerMessages).toHaveLength(2);
    expect(ownerMessages[0][0]).toMatchObject({
      template: 'interview_candidate_for_owner',
      variables: { firstName: 'Candidate', photoLink: '', interviewTime: expect.any(String) },
    });
    expect(Object.keys(ownerMessages[0][0].variables).sort()).toEqual(['firstName', 'interviewTime', 'photoLink']);
    expect(linkService.consumeInterviewActionToken).toHaveBeenCalledWith('single-use-token', 'candidate_reply');
    expect(prisma.interview.update).toHaveBeenCalledWith(expect.objectContaining({ data: { businessDetailsSentAt: now } }));
    expect(attendance.createInterviewAttendanceAssignment).toHaveBeenCalledWith('business-id', 'interview-id', 'call-1');
  });

  it('a No link declines and records one offer_declined hit', async () => {
    prisma.interview.findUnique.mockResolvedValue(liveInterview());
    const result = await service.respondFromLink('single-use-token', 'no');
    expect(result.status).toBe('declined');
    expect(hits.recordHit).toHaveBeenCalledWith('seeker-id', 'offer_declined', undefined, 'system', undefined, {
      interviewId: 'interview-id', callRecordId: undefined,
    });
    expect(messaging.send).toHaveBeenCalledTimes(0);
  });

  it('accepts only an answered offer call and records the call id on a declined reply hit', async () => {
    const interview = liveInterview();
    prisma.staff.findUnique.mockResolvedValue({ id: 'call-1', role: 'call_agent' });
    prisma.interview.findUnique.mockResolvedValue(interview);
    prisma.callRecord.findUnique.mockResolvedValue({
      id: 'call-record-id', purpose: 'offer', subjectType: 'job_seeker', subjectId: 'seeker-id', answered: true,
      createdAt: new Date(now.getTime() + 1000), startedAt: null, staffId: 'call-1',
    });
    const result = await service.respondFromCall('interview-id', 'call-record-id', 'rejected_offer', 'Salary too low', 'call-1');
    expect(result.status).toBe('declined');
    expect(calls.recordOutcome).toHaveBeenCalledWith(
      { id: 'call-1', role: 'call_agent' }, 'call-record-id', { agentOutcome: 'rejected_offer', reason: 'Salary too low' },
    );
    expect(hits.recordHit).toHaveBeenCalledWith('seeker-id', 'offer_declined', 'Salary too low', 'system', undefined, {
      interviewId: 'interview-id', callRecordId: 'call-record-id',
    });
  });

  it('refuses a reply call that is not answered', async () => {
    prisma.staff.findUnique.mockResolvedValue({ id: 'call-1', role: 'call_agent' });
    prisma.interview.findUnique.mockResolvedValue(liveInterview());
    calls.recordOutcome.mockRejectedValue(new BadRequestException('A call that was not answered cannot have an outcome'));
    await expect(service.respondFromCall('interview-id', 'call-record-id', 'accepted_offer', undefined, 'call-1'))
      .rejects.toThrow('A call that was not answered cannot have an outcome');
  });

  it('refuses used or expired Phase 12 reply tokens', async () => {
    linkService.validateInterviewActionToken.mockImplementation(() => {
      throw new BadRequestException('Consent link has expired');
    });
    await expect(service.respondFromLink('expired-token', 'yes')).rejects.toThrow('Consent link has expired');
    expect(prisma.interview.findUnique).not.toHaveBeenCalled();
  });

  it('closes a due reply after a documented call and sent messages as no_reply with one hit', async () => {
    prisma.interview.findMany.mockResolvedValue([liveInterview()]);
    prisma.callRecord.findFirst.mockResolvedValue({ id: 'call-record-id' });
    const result = await service.processDueReplies(new Date(now.getTime() + 48 * 60 * 60 * 1000));
    expect(result.processed).toBe(1);
    expect(tx.interview.updateMany).toHaveBeenCalledWith(expect.objectContaining({ data: { status: 'no_reply', cancelReason: null } }));
    expect(hits.recordHit).toHaveBeenCalledWith('seeker-id', 'offer_no_reply', expect.any(String), 'system', undefined, {
      interviewId: 'interview-id', callRecordId: 'call-record-id',
    });
  });

  it('cancels an offer that was never followed up with a call without recording a hit', async () => {
    prisma.interview.findMany.mockResolvedValue([liveInterview()]);
    prisma.callRecord.findFirst.mockResolvedValue(null);
    const result = await service.processDueReplies(new Date(now.getTime() + 48 * 60 * 60 * 1000));
    expect(result.processed).toBe(1);
    expect(tx.interview.updateMany).toHaveBeenCalledWith(expect.objectContaining({ data: { status: 'cancelled', cancelReason: 'offer_not_followed_up' } }));
    expect(hits.recordHit).not.toHaveBeenCalled();
  });

  it('requires attendance for the first interview and open flags, and always for no-documents businesses', async () => {
    await service.book({ vacancyId: 'vacancy-id', jobSeekerId: 'seeker-id', slotId: 'slot-id' }, 'call-1');
    expect(tx.interview.create.mock.calls[0][0].data.agentAttendanceRequired).toBe(true);

    prisma.interview.count.mockResolvedValue(1);
    await service.book({ vacancyId: 'vacancy-id', jobSeekerId: 'seeker-id', slotId: 'slot-id' }, 'call-1');
    expect(tx.interview.create.mock.calls[1][0].data.agentAttendanceRequired).toBe(false);

    prisma.reviewFlag.findFirst.mockResolvedValue({ id: 'flag-id' });
    await service.book({ vacancyId: 'vacancy-id', jobSeekerId: 'seeker-id', slotId: 'slot-id' }, 'call-1');
    expect(tx.interview.create.mock.calls[2][0].data.agentAttendanceRequired).toBe(true);

    prisma.reviewFlag.findFirst.mockResolvedValue(null);
    prisma.vacancy.findFirst.mockResolvedValue({ ...vacancy, business: { ...vacancy.business, documentsStatus: 'no_documents' } });
    await service.book({ vacancyId: 'vacancy-id', jobSeekerId: 'seeker-id', slotId: 'slot-id' }, 'call-1');
    expect(tx.interview.create.mock.calls[3][0].data.agentAttendanceRequired).toBe(true);
  });
});
