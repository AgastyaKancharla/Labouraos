import { BadRequestException } from '@nestjs/common';
import { InterviewService } from './interview.service';

describe('InterviewService booking', () => {
  type Mock = jest.Mock;
  type TxMock = {
    $queryRaw: Mock;
    vacancyInterviewSlot: { findUnique: Mock };
    interview: { findFirst: Mock; count: Mock; create: Mock; update: Mock };
    candidateIntroduction: { create: Mock };
  };
  type PrismaMock = {
    staff: { findUnique: Mock; findFirst: Mock };
    vacancy: { findFirst: Mock };
    jobSeeker: { findFirst: Mock };
    vacancyInterviewSlot: { findUnique: Mock };
    $transaction: Mock;
  };
  const now = new Date('2026-11-06T09:00:00.000Z');
  let service: InterviewService;
  let prisma: PrismaMock;
  let tx: TxMock;
  let messaging: { send: jest.Mock };
  let matching: { match: jest.Mock };
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
        findFirst: jest.fn().mockResolvedValue(null), count: jest.fn().mockResolvedValue(0),
        create: jest.fn().mockImplementation(({ data }) => Promise.resolve({ id: 'interview-id', code: data.code, ...data })),
        update: jest.fn().mockImplementation(({ data }) => Promise.resolve({ id: 'interview-id', ...data })),
      },
      candidateIntroduction: { create: jest.fn().mockResolvedValue({ id: 'intro-id' }) },
    };
    prisma = {
      staff: { findUnique: jest.fn().mockResolvedValue({ id: 'call-1', role: 'call_agent' }), findFirst: jest.fn() },
      vacancy: { findFirst: jest.fn().mockResolvedValue(vacancy) },
      jobSeeker: { findFirst: jest.fn().mockResolvedValue(seeker) },
      vacancyInterviewSlot: { findUnique: jest.fn().mockResolvedValue(slot) },
      $transaction: jest.fn().mockImplementation((callback: (client: TxMock) => unknown) => callback(tx)),
    };
    messaging = { send: jest.fn().mockImplementation(({ channel }) => Promise.resolve({ id: `msg-${channel}`, status: 'sent' })) };
    matching = { match: jest.fn().mockResolvedValue({ total: 1, pageSize: 10, matches: [match] }) };
    service = new InterviewService(
      prisma as never,
      { generateCode: jest.fn().mockResolvedValue('INT-00001') } as never,
      { log: jest.fn().mockResolvedValue(undefined) } as never,
      { current: jest.fn().mockResolvedValue({ offerReplyHours: 48, interviewResultDeadline: '20:00' }) } as never,
      { now: () => now } as never,
      {
        createInterviewActionToken: jest.fn().mockReturnValue('single-use-token'),
      } as never,
      messaging as never,
      matching as never,
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
  });
});
