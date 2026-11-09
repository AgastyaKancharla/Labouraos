import { BadRequestException, UnauthorizedException } from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.service';
import { ConsentClock } from '../consent/consent-clock';
import { MatchingService } from './matching.service';
import { CandidateIntroductionService } from './candidate-introduction.service';

describe('CandidateIntroductionService', () => {
  const shownAt = new Date('2026-11-06T03:00:00.000Z');
  let prisma: {
    vacancy: { findFirst: jest.Mock };
    business: { findFirst: jest.Mock };
    candidateIntroduction: { createMany: jest.Mock; findFirst: jest.Mock; findMany: jest.Mock };
    candidateIntroductionLink: { create: jest.Mock; delete: jest.Mock; findUnique: jest.Mock; updateMany: jest.Mock };
    $transaction: jest.Mock;
  };
  let matching: { match: jest.Mock };
  let messaging: { send: jest.Mock };
  let service: CandidateIntroductionService;

  beforeEach(() => {
    process.env.PUBLIC_APP_URL = 'https://app.laboura.in';
    prisma = {
      vacancy: { findFirst: jest.fn().mockResolvedValue({ id: 'vacancy-1', businessId: 'business-1' }) },
      business: { findFirst: jest.fn().mockResolvedValue({ id: 'business-1', code: 'BZ-00001' }) },
      candidateIntroduction: { createMany: jest.fn().mockResolvedValue({ count: 2 }), findFirst: jest.fn(), findMany: jest.fn() },
      candidateIntroductionLink: { create: jest.fn(), delete: jest.fn(), findUnique: jest.fn(), updateMany: jest.fn() },
      $transaction: jest.fn(async (callback: (tx: unknown) => Promise<unknown>) => callback(prisma)),
    };
    matching = { match: jest.fn() };
    messaging = { send: jest.fn().mockResolvedValue({ id: 'message-1', status: 'sent' }) };
    service = new CandidateIntroductionService(
      prisma as unknown as PrismaService,
      matching as unknown as MatchingService,
      messaging as never,
      { now: () => shownAt } as ConsentClock,
    );
  });

  it('shares selected candidates with one message and logs every introduction', async () => {
    matching.match.mockResolvedValue({
      page: 1,
      pageSize: 3,
      total: 3,
      matches: [
        { jobSeekerId: 'seeker-1', score: 91, matchReasons: ['Electrician, 4 yrs'] },
        { jobSeekerId: 'seeker-2', score: 73, matchReasons: ['Electrician, 2 yrs'] },
        { jobSeekerId: 'seeker-3', score: 64, matchReasons: ['Electrician, 1 yrs'] },
      ],
    });

    await expect(service.shareByLink('vacancy-1', ['seeker-1', 'seeker-2', 'seeker-3'], 'staff-1', 'whatsapp'))
      .resolves.toEqual({ count: 3, channel: 'share_link', messageLogId: 'message-1' });
    expect(messaging.send).toHaveBeenCalledWith(expect.objectContaining({
      channel: 'whatsapp', template: 'candidates_shared', subjectType: 'business', subjectId: 'business-1',
      variables: { link: expect.stringMatching(/^https:\/\/app\.laboura\.in\/candidate-introductions\/[a-f0-9]{64}$/) },
    }));
    const sentLink = messaging.send.mock.calls[0][0].variables.link as string;
    expect(sentLink).toMatch(/^https:\/\//);
    expect(prisma.candidateIntroduction.createMany).toHaveBeenCalledWith({ data: expect.arrayContaining([
      expect.objectContaining({ jobSeekerId: 'seeker-1', channel: 'share_link', messageLogId: 'message-1', rank: 1 }),
      expect.objectContaining({ jobSeekerId: 'seeker-2', channel: 'share_link', messageLogId: 'message-1', rank: 2 }),
      expect.objectContaining({ jobSeekerId: 'seeker-3', channel: 'share_link', messageLogId: 'message-1', rank: 3 }),
    ]) });
    expect(messaging.send).toHaveBeenCalledTimes(1);
  });

  it('does not record introductions when delivery fails', async () => {
    matching.match.mockResolvedValue({ page: 1, pageSize: 1, total: 1, matches: [
      { jobSeekerId: 'seeker-1', score: 80, matchReasons: ['Salary fits'] },
    ] });
    messaging.send.mockResolvedValue({ id: 'message-failed', status: 'failed' });

    await expect(service.shareByLink('vacancy-1', ['seeker-1'], 'staff-1')).rejects.toThrow('could not be sent');
    expect(prisma.candidateIntroductionLink.delete).toHaveBeenCalledWith({
      where: { tokenHash: expect.any(String) },
    });
    expect(prisma.candidateIntroduction.createMany).not.toHaveBeenCalled();
  });

  it('redeems a share link once and returns only current candidate cards', async () => {
    prisma.candidateIntroductionLink.findUnique.mockResolvedValue({
      id: 'link-1', vacancyId: 'vacancy-1', jobSeekerIds: ['seeker-1'], consumedAt: null,
    });
    prisma.candidateIntroductionLink.updateMany.mockResolvedValue({ count: 1 });
    matching.match.mockResolvedValue({ page: 1, pageSize: 3, total: 1, matches: [
      { jobSeekerId: 'seeker-1', card: { firstName: 'Asha', age: 25 }, score: 80, matchReasons: [] },
    ] });

    await expect(service.redeemShareLink('a'.repeat(64))).resolves.toEqual({
      cards: [{ firstName: 'Asha', age: 25 }],
    });
    expect(prisma.candidateIntroductionLink.updateMany).toHaveBeenCalledWith({
      where: { id: 'link-1', consumedAt: null }, data: { consumedAt: shownAt },
    });
  });

  it('rejects an already redeemed share link', async () => {
    prisma.candidateIntroductionLink.findUnique.mockResolvedValue({ id: 'link-1', consumedAt: shownAt });
    prisma.candidateIntroductionLink.updateMany.mockResolvedValue({ count: 0 });
    await expect(service.redeemShareLink('a'.repeat(64))).rejects.toBeInstanceOf(UnauthorizedException);
    expect(matching.match).not.toHaveBeenCalled();
  });

  it('records one immutable in-person introduction per currently eligible candidate', async () => {
    matching.match
      .mockResolvedValueOnce({
        page: 1,
        pageSize: 2,
        total: 3,
        matches: [
          { jobSeekerId: 'seeker-1', score: 91, matchReasons: ['Electrician, 4 yrs'] },
          { jobSeekerId: 'seeker-2', score: 73, matchReasons: ['Electrician, 2 yrs'] },
        ],
      })
      .mockResolvedValueOnce({
        page: 2,
        pageSize: 2,
        total: 3,
        matches: [{ jobSeekerId: 'seeker-3', score: 64, matchReasons: ['Electrician, 1 yrs'] }],
      });

    await expect(service.showInPerson('vacancy-1', ['seeker-3', 'seeker-1'], 'staff-1')).resolves.toEqual({
      count: 2,
      channel: 'in_person',
    });
    expect(prisma.candidateIntroduction.createMany).toHaveBeenCalledWith({
      data: [
        {
          businessId: 'business-1', vacancyId: 'vacancy-1', jobSeekerId: 'seeker-3',
          shownByStaffId: 'staff-1', shownAt, rank: 3, score: 64,
          matchReasons: ['Electrician, 1 yrs'], channel: 'in_person', messageLogId: null,
        },
        {
          businessId: 'business-1', vacancyId: 'vacancy-1', jobSeekerId: 'seeker-1',
          shownByStaffId: 'staff-1', shownAt, rank: 1, score: 91,
          matchReasons: ['Electrician, 4 yrs'], channel: 'in_person', messageLogId: null,
        },
      ],
    });
    expect(matching.match).toHaveBeenNthCalledWith(1, 'vacancy-1', { page: 1 });
    expect(matching.match).toHaveBeenNthCalledWith(2, 'vacancy-1', { page: 2 });
  });

  it('refuses a candidate who no longer passes the current matching rules', async () => {
    matching.match.mockResolvedValue({ page: 1, pageSize: 3, total: 0, matches: [] });
    await expect(service.showInPerson('vacancy-1', ['no-longer-eligible'], 'staff-1'))
      .rejects.toThrow('does not pass current matching rules');
    expect(prisma.candidateIntroduction.createMany).not.toHaveBeenCalled();
  });

  it('rejects duplicate or empty candidate selections', async () => {
    await expect(service.showInPerson('vacancy-1', [], 'staff-1')).rejects.toBeInstanceOf(BadRequestException);
    await expect(service.showInPerson('vacancy-1', ['seeker-1', 'seeker-1'], 'staff-1')).rejects.toThrow('must not contain duplicates');
    expect(matching.match).not.toHaveBeenCalled();
  });

  it('returns the earliest showing time for a business and job seeker', async () => {
    prisma.candidateIntroduction.findFirst.mockResolvedValue({ shownAt });
    await expect(service.firstIntroduction('business-1', 'seeker-1')).resolves.toEqual(shownAt);
    expect(prisma.candidateIntroduction.findFirst).toHaveBeenCalledWith({
      where: { businessId: 'business-1', jobSeekerId: 'seeker-1' },
      orderBy: [{ shownAt: 'asc' }, { id: 'asc' }],
      select: { shownAt: true },
    });
  });

  it('lists introductions with only the business history fields and no candidate contact or location data', async () => {
    prisma.candidateIntroduction.findMany.mockResolvedValue([{
      vacancyId: 'vacancy-1', shownAt, rank: 2, channel: 'in_person',
      jobSeeker: { name: 'Asha Kumar', trades: [{ trade: 'Electrician', isPrimary: true }] },
      vacancy: { code: 'VC-00001' }, shownBy: { name: 'Field Agent One' },
    }]);

    const result = await service.listForBusiness('BZ-00001');
    expect(result).toEqual({
      businessId: 'business-1', businessCode: 'BZ-00001',
      introductions: [{
        vacancyId: 'vacancy-1', vacancyCode: 'VC-00001', candidateFirstName: 'Asha', trade: 'Electrician',
        shownAt, shownByName: 'Field Agent One', channel: 'in_person', rank: 2,
      }],
    });
    expect(JSON.stringify(result)).not.toMatch(/phone|address|latitude|longitude|dateOfBirth|\bdob\b/i);
    expect(prisma.candidateIntroduction.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { businessId: 'business-1' },
      select: expect.objectContaining({ jobSeeker: expect.objectContaining({ select: { name: true, trades: { select: { trade: true, isPrimary: true } } } }) }),
    }));
  });
});
