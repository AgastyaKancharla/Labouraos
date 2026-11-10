import { BadRequestException } from '@nestjs/common';
import { InterviewService } from './interview.service';

describe('InterviewService booking', () => {
  type Mock = jest.Mock;
  type TxMock = {
    $queryRaw: Mock;
    vacancyInterviewSlot: { findUnique: Mock };
    interview: { findFirst: Mock; findUnique: Mock; findMany: Mock; count: Mock; create: Mock; update: Mock; updateMany: Mock };
    candidateIntroduction: { create: Mock };
    replacementCandidate: { create: Mock; updateMany: Mock };
    statusHistory: { create: Mock };
  };
  type PrismaMock = {
    staff: { findUnique: Mock; findFirst: Mock; findMany: Mock };
    vacancy: { findFirst: Mock };
    jobSeeker: { findFirst: Mock };
    vacancyInterviewSlot: { findUnique: Mock; findMany: Mock };
    interview: { findUnique: Mock; findMany: Mock; update: Mock; updateMany: Mock; count: Mock };
    callRecord: { findUnique: Mock; findFirst: Mock };
    messageLog: { findMany: Mock };
    reviewFlag: { findFirst: Mock };
    businessBranch: { findUnique: Mock };
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
  let linkService: {
    createInterviewActionToken: Mock;
    validateInterviewActionToken: Mock;
    consumeInterviewActionToken: Mock;
    verifyInterviewOwnerOtp: Mock;
  };
  let reviewFlags: { raise: jest.Mock };
  let placements: { createAwaitingPaymentFromInterview: jest.Mock };
  const previousPublicAppUrl = process.env.PUBLIC_APP_URL;

  const vacancy = {
    id: 'vacancy-id', code: 'VC-00001', businessId: 'business-id', city: 'Bengaluru', branchId: null as string | null,
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
      replacementCandidate: { create: jest.fn().mockResolvedValue({ id: 'rc-1' }), updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
      statusHistory: { create: jest.fn().mockResolvedValue({}) },
    };
    prisma = {
      staff: { findUnique: jest.fn().mockResolvedValue({ id: 'call-1', role: 'call_agent' }), findFirst: jest.fn(), findMany: jest.fn().mockResolvedValue([]) },
      vacancy: { findFirst: jest.fn().mockResolvedValue(vacancy) },
      jobSeeker: { findFirst: jest.fn().mockResolvedValue(seeker) },
      vacancyInterviewSlot: { findUnique: jest.fn().mockResolvedValue(slot), findMany: jest.fn().mockResolvedValue([]) },
      interview: { findUnique: jest.fn(), findMany: jest.fn(), update: jest.fn().mockResolvedValue({}), updateMany: jest.fn().mockResolvedValue({ count: 1 }), count: jest.fn().mockResolvedValue(0) },
      callRecord: { findUnique: jest.fn(), findFirst: jest.fn() },
      messageLog: { findMany: jest.fn().mockResolvedValue([{ channel: 'sms' }, { channel: 'whatsapp' }]) },
      reviewFlag: { findFirst: jest.fn().mockResolvedValue(null) },
      businessBranch: { findUnique: jest.fn().mockResolvedValue(null) },
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
      verifyInterviewOwnerOtp: jest.fn().mockResolvedValue({ interviewId: 'interview-id', phone: '+911234567890' }),
    };
    reviewFlags = { raise: jest.fn().mockResolvedValue({ id: 'flag-id' }) };
    placements = { createAwaitingPaymentFromInterview: jest.fn().mockResolvedValue({ id: 'placement-id', status: 'awaiting_payment' }) };
    service = new InterviewService(
      prisma as never,
      { generateCode: jest.fn().mockResolvedValue('INT-00001') } as never,
      { log: jest.fn().mockResolvedValue(undefined) } as never,
      { current: jest.fn().mockResolvedValue({
        offerReplyHours: 48, interviewResultDeadline: '20:00', interviewResultCloseHours: 48,
        interviewResultEscalateHours: 24,
      }) } as never,
      { now: () => now } as never,
      linkService as never,
      messaging as never,
      matching as never,
      hits as never,
      calls as never,
      { createInterviewAttendanceAssignment: attendance.createInterviewAttendanceAssignment } as never,
      reviewFlags as never,
      placements as never,
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

  it('allows replacement vacancies and records replacement candidate history', async () => {
    prisma.vacancy.findFirst.mockResolvedValue({ ...vacancy, replacementForPlacementId: 'placement-id' });
    await service.book({ vacancyId: 'vacancy-id', jobSeekerId: 'seeker-id', slotId: 'slot-id' }, 'call-1');
    expect(tx.replacementCandidate.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          placementId: 'placement-id',
          jobSeekerId: 'seeker-id',
          status: 'offered',
        }),
      }),
    );
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
    jobSeeker: {
      id: 'seeker-id', name: 'Candidate Sample', photoStoragePath: null,
      minSalary: 1600000, salaryPeriod: 'monthly', guaranteeFloorPaise: 1600000,
    },
    vacancy: { locality: 'Indiranagar', salaryMinPaise: 1600000, salaryMaxPaise: 1800000, salaryPeriod: 'monthly' },
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

  it('does not count declining an offer below the guarantee floor as a hit', async () => {
    const interview = liveInterview();
    interview.vacancy.salaryMinPaise = 1456000;
    interview.vacancy.salaryMaxPaise = 1456000;
    prisma.interview.findUnique.mockResolvedValue(interview);
    const result = await service.respondFromLink('single-use-token', 'no');
    expect(result.status).toBe('declined');
    expect(hits.recordHit).not.toHaveBeenCalled();
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

  const confirmedInterview = () => ({
    id: 'interview-id', code: 'INT-00001', status: 'confirmed', resultRecordedAt: null,
    slotStartsAt: slot.startsAt, slotEndsAt: slot.endsAt, resultDueAt: new Date('2026-11-10T14:30:00.000Z'),
    resultRequestSentAt: null, candidateCheckAnswer: null, businessId: 'business-id',
    jobSeekerId: 'seeker-id', proposedByStaffId: 'call-1',
    business: { ...vacancy.business, phone: '+911234567890' },
    jobSeeker: { ...seeker, name: 'Candidate Sample', photoStoragePath: null },
    vacancy: { ...vacancy },
  });

  it('records a result only after the owner OTP is verified and sends the candidate check', async () => {
    prisma.interview.findUnique.mockResolvedValue(confirmedInterview());
    const result = await service.submitOwnerResult('single-use-token', {
      otpRequestId: 'otp-request-id', otpCode: '123456', result: 'selected',
      selectedSalaryPaise: 1600000, selectedJoiningDate: '2026-11-20',
    });

    expect(linkService.verifyInterviewOwnerOtp).toHaveBeenCalledWith('single-use-token', 'otp-request-id', '123456');
    expect(result).toMatchObject({ status: 'completed', result: 'selected', placement: { id: 'placement-id', status: 'awaiting_payment' } });
    expect(placements.createAwaitingPaymentFromInterview).toHaveBeenCalledWith('interview-id', now);
    expect(tx.interview.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'interview-id', status: 'confirmed', resultRecordedAt: null },
      data: expect.objectContaining({
        status: 'completed', result: 'selected', resultOtpRequestId: 'otp-request-id',
        selectedSalaryPaise: 1600000, selectedJoiningDate: new Date('2026-11-20T00:00:00.000Z'),
      }),
    }));
    expect(messaging.send).not.toHaveBeenCalled();
    expect(linkService.consumeInterviewActionToken).toHaveBeenCalledWith('single-use-token', 'owner_result');
  });

  it('does not record an owner result when OTP verification fails', async () => {
    linkService.verifyInterviewOwnerOtp.mockRejectedValue(new BadRequestException('Valid owner OTP is required'));
    await expect(service.submitOwnerResult('single-use-token', {
      otpRequestId: 'otp-request-id', otpCode: '000000', result: 'not_selected', resultReason: 'skills',
    })).rejects.toThrow('Valid owner OTP is required');
    expect(tx.interview.updateMany).not.toHaveBeenCalled();
  });

  it('records a no-show hit but never a hit for not selected', async () => {
    prisma.interview.findUnique.mockResolvedValue(confirmedInterview());
    await service.submitOwnerResult('single-use-token', {
      otpRequestId: 'otp-request-id', otpCode: '123456', result: 'candidate_no_show',
    });
    expect(hits.recordHit).toHaveBeenCalledWith('seeker-id', 'interview_no_show', undefined, 'system', undefined, {
      interviewId: 'interview-id',
    });

    hits.recordHit.mockClear();
    prisma.interview.findUnique.mockResolvedValue(confirmedInterview());
    await service.submitOwnerResult('single-use-token', {
      otpRequestId: 'otp-request-id', otpCode: '123456', result: 'not_selected', resultReason: 'skills',
    });
    expect(hits.recordHit).not.toHaveBeenCalled();
  });

  it('raises an idempotent mismatch flag when the candidate says yes and the owner did not select them', async () => {
    prisma.interview.findUnique.mockResolvedValue({
      ...confirmedInterview(), status: 'completed', result: 'not_selected', resultRecordedAt: now,
      candidateCheckAnswer: 'offered_yes',
    });
    await service.submitCandidateOfferCheck('single-use-token', 'yes');
    expect(reviewFlags.raise).toHaveBeenCalledWith(expect.objectContaining({
      kind: 'interview_result_mismatch', subjectType: 'interview', subjectId: 'interview-id',
    }));
  });

  it('sends the owner result request, due notice, overdue flag and no-result close once at their deadlines', async () => {
    const interview = confirmedInterview();
    prisma.interview.findMany.mockResolvedValue([interview]);
    const result = await service.processResultDeadlines(new Date('2026-11-12T06:30:00.000Z'));
    expect(result).toMatchObject({ requestsSent: 1, dueNotices: 1, overdueFlags: 1, closed: 1 });
    expect(messaging.send).toHaveBeenCalledTimes(4);
    expect(messaging.send.mock.calls.filter(([input]) => input.template === 'interview_result_request')).toHaveLength(2);
    expect(messaging.send.mock.calls.filter(([input]) => input.template === 'candidate_offer_check')).toHaveLength(2);
    expect(reviewFlags.raise).toHaveBeenCalledWith(expect.objectContaining({ kind: 'interview_result_due' }));
    expect(reviewFlags.raise).toHaveBeenCalledWith(expect.objectContaining({ kind: 'interview_result_overdue' }));
    expect(reviewFlags.raise).toHaveBeenCalledWith(expect.objectContaining({ kind: 'interview_no_result' }));
    expect(tx.interview.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ status: 'no_result', candidateCheckAnswer: 'no_answer' }),
    }));
    expect(hits.recordHit).not.toHaveBeenCalled();
  });

  it('sends a branch vacancy interview result request and OTP to its branch contact', async () => {
    const interview = confirmedInterview();
    interview.vacancy = { ...vacancy, branchId: 'branch-1' };
    prisma.interview.findMany.mockResolvedValue([interview]);
    prisma.businessBranch.findUnique.mockResolvedValue({ contactPersonPhone: '+919999999999' });

    await service.processResultDeadlines(new Date('2026-11-10T05:31:00.000Z'));

    expect(linkService.createInterviewActionToken).toHaveBeenCalledWith(
      'interview-id', 'owner_result', '+919999999999', expect.any(Date),
    );
    expect(messaging.send).toHaveBeenCalledWith(expect.objectContaining({
      template: 'interview_result_request', recipientPhone: '+919999999999',
    }));
  });

  it('lists only the agent’s interviews and exposes a reply call only after an answered offer call', async () => {
    const interview = {
      id: 'interview-id', jobSeekerId: 'seeker-id', offerSentAt: now, status: 'offered',
      jobSeeker: { id: 'seeker-id', code: 'JS-00001', name: 'Candidate' },
      vacancy: { id: 'vacancy-id', code: 'VC-00001', tradeSkill: 'cook', roleTitle: 'Cook' },
      placement: null,
    };
    prisma.interview.findMany.mockResolvedValue([interview]);
    prisma.callRecord.findFirst.mockResolvedValue({ id: 'answered-offer-call' });

    const rows = await service.list('call-1', { vacancyId: 'VC-00001' });

    expect(prisma.interview.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { proposedByStaffId: 'call-1', vacancyId: 'vacancy-id' },
    }));
    expect(prisma.callRecord.findFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ purpose: 'offer', answered: true, subjectId: 'seeker-id' }),
    }));
    expect(rows[0].answeredOfferCallId).toBe('answered-offer-call');
  });

  it('restricts team lead interview lists to their own team', async () => {
    prisma.staff.findUnique.mockResolvedValue({ id: 'lead-1', role: 'team_lead' });
    prisma.staff.findMany.mockResolvedValue([{ id: 'lead-1' }, { id: 'agent-1' }]);
    prisma.interview.findMany.mockResolvedValue([]);

    await service.list('lead-1');
    expect(prisma.interview.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { proposedByStaffId: { in: ['lead-1', 'agent-1'] } },
    }));
    await expect(service.list('lead-1', { agentId: 'outside-agent' })).rejects.toThrow('your team');
  });

  it('lists future slots with remaining capacity calculated from live interviews', async () => {
    prisma.vacancyInterviewSlot.findMany.mockResolvedValue([slot]);
    prisma.interview.count.mockResolvedValue(1);

    const rows = await service.listSlots('VC-00001', 'call-1');

    expect(rows).toEqual([{ ...slot, booked: 1, remainingCapacity: 1 }]);
  });
});
