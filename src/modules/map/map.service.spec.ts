import { BadRequestException } from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.service';
import { MapService, parseBounds } from './map.service';

describe('MapService', () => {
  const bounds = '77.5,12.8,77.7,13.1';
  let prisma: {
    business: { findMany: jest.Mock };
    staff: { findMany: jest.Mock };
    vacancy: { findMany: jest.Mock };
    consent: { findMany: jest.Mock };
    jobSeeker: { findMany: jest.Mock };
  };
  let service: MapService;

  beforeEach(() => {
    prisma = {
      business: { findMany: jest.fn().mockResolvedValue([
        { id: 'business-1', code: 'BZ-00001', name: 'Verified Shop', latitude: 12.9712, longitude: 77.5938, verificationStatus: 'verified', accountAgentId: 'staff-1' },
      ]) },
      staff: { findMany: jest.fn().mockResolvedValue([{ id: 'staff-1', name: 'Field Agent One' }]) },
      vacancy: { findMany: jest.fn().mockResolvedValue([
        { id: 'vacancy-1', code: 'VC-00001', latitude: 12.972, longitude: 77.594, roleTitle: 'Electrician', tradeSkill: 'Electrician', salaryMinPaise: 1500000, salaryMaxPaise: 1800000 },
      ]) },
      consent: { findMany: jest.fn().mockResolvedValue([{ subjectId: 'seeker-1' }, { subjectId: 'seeker-2' }]) },
      jobSeeker: { findMany: jest.fn().mockResolvedValue([
        { id: 'seeker-1', latitude: 12.9371, longitude: 77.6127, tradeSkill: null, trades: [{ trade: 'Electrician', isPrimary: true }] },
        { id: 'seeker-2', latitude: 12.9368, longitude: 77.6129, tradeSkill: null, trades: [{ trade: 'Painter', isPrimary: true }] },
      ]) },
    };
    service = new MapService(prisma as unknown as PrismaService);
  });

  it('returns exact business and vacancy pins with candidate locations grouped and rounded server-side', async () => {
    const points = await service.points(bounds);

    expect(points.businesses).toEqual([{
      id: 'business-1', code: 'BZ-00001', name: 'Verified Shop', latitude: 12.9712, longitude: 77.5938,
      verificationStatus: 'verified', accountAgentName: 'Field Agent One',
    }]);
    expect(points.vacancies[0]).toEqual({
      id: 'vacancy-1', code: 'VC-00001', latitude: 12.972, longitude: 77.594, roleTitle: 'Electrician',
      trade: 'Electrician', salaryMinPaise: 1500000, salaryMaxPaise: 1800000,
    });
    expect(points.candidateCells).toEqual([{
      latitude: 12.94, longitude: 77.61, count: 2, trades: ['Electrician', 'Painter'],
    }]);
    const response = JSON.stringify(points);
    expect(response).not.toContain('12.9371');
    expect(response).not.toContain('77.6127');
    for (const cell of points.candidateCells) {
      expect(Number.isInteger(cell.latitude * 100)).toBe(true);
      expect(Number.isInteger(cell.longitude * 100)).toBe(true);
    }
    expect(response).not.toMatch(/phone|address|jobSeekerId/i);
  });

  it('keeps businesses visible while a trade filter narrows vacancies and candidate cells', async () => {
    const points = await service.points(bounds, 'electrician');

    expect(points.businesses).toHaveLength(1);
    expect(prisma.vacancy.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ tradeSkill: { equals: 'electrician', mode: 'insensitive' } }),
    }));
    expect(points.candidateCells).toEqual([{
      latitude: 12.94, longitude: 77.61, count: 1, trades: ['Electrician'],
    }]);
  });

  it('queries only active job seekers with active job_matching consent', async () => {
    await service.points(bounds);

    expect(prisma.consent.findMany).toHaveBeenCalledWith({
      where: {
        subjectType: 'job_seeker', purpose: 'job_matching', granted: true,
        grantedAt: { not: null }, withdrawnAt: null,
      },
      select: { subjectId: true },
    });
    expect(prisma.jobSeeker.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ id: { in: ['seeker-1', 'seeker-2'] }, status: 'active' }),
    }));
  });

  it('rejects missing, malformed, and reversed bounding boxes', () => {
    expect(() => parseBounds(undefined)).toThrow(BadRequestException);
    expect(() => parseBounds('77,12,78')).toThrow('bbox must be west,south,east,north');
    expect(() => parseBounds('78,12,77,13')).toThrow('out of range or reversed');
    expect(() => parseBounds('77,13,78,12')).toThrow('out of range or reversed');
  });
});
