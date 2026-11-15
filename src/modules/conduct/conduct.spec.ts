import { BadRequestException, ConflictException, ForbiddenException } from '@nestjs/common';
import { ConductService } from './conduct.service';
import { aadhaarFingerprint, assertNotBanned, businessIdFingerprint, phoneHash } from './permanent-ban.check';
import { businessAccessMessage, businessCandidateAccess, BUSINESS_SUSPENDED_MESSAGE, isBusinessSuspended } from '../business/business-candidate-access';
import { isAcceptClaimReason, isRejectClaimReason, ACCEPT_CLAIM_REASONS } from '../placement/claim-reasons';

const NOW = new Date('2026-11-15T10:00:00Z');
const DAY = 24 * 60 * 60 * 1000;
const STAFF: Record<string, { id: string; role: string }> = {
  ceo: { id: 'ceo', role: 'ceo' },
  mgr: { id: 'mgr', role: 'manager' },
  tl: { id: 'tl', role: 'team_lead' },
  ca: { id: 'ca', role: 'call_agent' },
};

function setup(overrides: Record<string, unknown> = {}) {
  const business = { id: 'bz-1', code: 'BZ-00001', city: 'Bengaluru', phone: '+919811100000', gstNumber: '29ABCDE1234F1Z5', pan: null, suspendedAt: null as Date | null, suspendedUntil: null as Date | null, suspensionReason: null };
  const prisma = {
    staff: { findUnique: jest.fn(async ({ where }: { where: { id: string } }) => STAFF[where.id] ?? null) },
    business: {
      findUnique: jest.fn(async () => business),
      update: jest.fn(async ({ data }: { data: Record<string, unknown> }) => Object.assign(business, data)),
    },
    jobSeeker: {
      findUnique: jest.fn(async () => ({ id: 'js-1', code: 'JS-00001', phone: '+919876512345', name: 'Ravi Kumar', status: 'active', city: 'Bengaluru', identityVerifications: [{ id: 'iv-1', method: 'aadhaar_qr', last4: '1234' }] })),
      findUniqueOrThrow: jest.fn(async () => ({ status: 'active' })),
      update: jest.fn(),
    },
    referral: { findUnique: jest.fn(), update: jest.fn() },
    idCheckDetail: { findMany: jest.fn(async () => [{ verificationId: 'iv-1', dateOfBirth: '1990-01-01', nameOnId: 'Ravi Kumar' }]) },
    permanentBan: { findUnique: jest.fn(async (): Promise<unknown> => null), create: jest.fn(), findFirst: jest.fn(async () => null) },
    payment: { findMany: jest.fn(async () => [{ id: 'pay-open' }]), updateMany: jest.fn() },
    statusHistory: { create: jest.fn() },
    ...overrides,
  };
  const withTx = Object.assign(prisma, { $transaction: jest.fn(async (cb: (tx: unknown) => unknown): Promise<unknown> => cb(prisma)) });
  const audit = { log: jest.fn() };
  const service = new ConductService(withTx as never, audit as never, { now: () => NOW } as never);
  return { service, prisma: withTx, audit, business };
}

describe('D6 business suspension (CEO only, 30–90 days or permanent)', () => {
  it('only the CEO suspends; a Manager or Team Lead is refused', async () => {
    const { service } = setup();
    await expect(service.suspendBusiness('bz-1', 'mgr', { days: 30, reason: 'Repeated no-shows' })).rejects.toThrow(ForbiddenException);
    await expect(service.suspendBusiness('bz-1', 'tl', { days: 30, reason: 'Repeated no-shows' })).rejects.toThrow(ForbiddenException);
  });

  it('needs 30 to 90 days (or permanent) and a written reason', async () => {
    const { service } = setup();
    await expect(service.suspendBusiness('bz-1', 'ceo', { days: 29, reason: 'Repeated no-shows' })).rejects.toThrow(BadRequestException);
    await expect(service.suspendBusiness('bz-1', 'ceo', { days: 91, reason: 'Repeated no-shows' })).rejects.toThrow(BadRequestException);
    await expect(service.suspendBusiness('bz-1', 'ceo', { days: 30, reason: '' })).rejects.toThrow(BadRequestException);
  });

  it('suspends until the end date, audited; then lifts it with a reason', async () => {
    const { service, audit, business } = setup();
    const result = await service.suspendBusiness('bz-1', 'ceo', { days: 45, reason: 'Repeated cancellations' });
    expect(result).toMatchObject({ suspended: true, permanent: false });
    expect(business.suspendedUntil?.getTime()).toBe(NOW.getTime() + 45 * DAY);
    expect(audit.log).toHaveBeenCalledWith(expect.objectContaining({ action: 'business.suspended', reason: 'Repeated cancellations', actorId: 'ceo' }));
    await service.liftSuspension('bz-1', 'ceo', { reason: 'Owner apologised in person' });
    expect(business.suspendedAt).toBeNull();
    expect(audit.log).toHaveBeenCalledWith(expect.objectContaining({ action: 'business.suspension_lifted' }));
  });

  it('permanent suspension has no end date', async () => {
    const { service, business } = setup();
    expect(await service.suspendBusiness('bz-1', 'ceo', { permanent: true, reason: 'Forged licence' })).toMatchObject({ suspended: true, permanent: true });
    expect(business.suspendedUntil).toBeNull();
  });

  it('while suspended: no candidates, no bookings (business-candidate-access); it ends by itself on the date', () => {
    const verified = { verificationStatus: 'verified', suspendedAt: NOW, suspendedUntil: new Date(NOW.getTime() + 30 * DAY) };
    const access = businessCandidateAccess(verified, new Date(NOW.getTime() + DAY));
    expect(access).toEqual({ allowed: false, reason: 'suspended' });
    expect(businessAccessMessage(access, 'x')).toBe(BUSINESS_SUSPENDED_MESSAGE);
    expect(businessCandidateAccess(verified, new Date(NOW.getTime() + 31 * DAY)).allowed).toBe(true);
    expect(isBusinessSuspended({ suspendedAt: NOW, suspendedUntil: null }, new Date(NOW.getTime() + 400 * DAY))).toBe(true);
    expect(isBusinessSuspended({ suspendedAt: null, suspendedUntil: null })).toBe(false);
  });
});

describe('D11 permanent ban (Manager or CEO, forged ID / fraud / theft / violence)', () => {
  it('refuses a Team Lead or agent, a missing reason and an unknown category', async () => {
    const { service } = setup();
    await expect(service.ban('tl', { subjectType: 'job_seeker', subjectId: 'js-1', category: 'fraud', reason: 'Took money from others' })).rejects.toThrow(ForbiddenException);
    await expect(service.ban('ca', { subjectType: 'job_seeker', subjectId: 'js-1', category: 'fraud', reason: 'Took money from others' })).rejects.toThrow(ForbiddenException);
    await expect(service.ban('mgr', { subjectType: 'job_seeker', subjectId: 'js-1', category: 'rudeness', reason: 'Was rude to the owner' })).rejects.toThrow(BadRequestException);
    await expect(service.ban('mgr', { subjectType: 'job_seeker', subjectId: 'js-1', category: 'fraud', reason: '' })).rejects.toThrow(BadRequestException);
  });

  it('a Manager bans a job seeker: status banned, phone and Aadhaar fingerprints kept as hashes, audited', async () => {
    const { service, prisma, audit } = setup();
    await service.ban('mgr', { subjectType: 'job_seeker', subjectId: 'js-1', category: 'forged_id', reason: 'Altered Aadhaar photo' });
    expect(prisma.permanentBan.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        subjectType: 'job_seeker', category: 'forged_id', phoneHash: phoneHash('+919876512345'),
        idFingerprints: [aadhaarFingerprint('1234', '1990-01-01', 'Ravi Kumar')], bannedByStaffId: 'mgr',
      }),
    });
    const created = prisma.permanentBan.create.mock.calls[0][0].data;
    expect(JSON.stringify(created)).not.toContain('9876512345');
    expect(prisma.jobSeeker.update).toHaveBeenCalledWith({ where: { id: 'js-1' }, data: { status: 'banned' } });
    expect(audit.log).toHaveBeenCalledWith(expect.objectContaining({ action: 'permanent_ban.created', reason: 'Altered Aadhaar photo' }));
    // His open ₹499 request is closed.
    expect(prisma.payment.updateMany).toHaveBeenCalledWith({ where: { id: { in: ['pay-open'] }, status: 'pending' }, data: { status: 'failed' } });
    expect(prisma.statusHistory.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ subjectType: 'payment', reason: 'closed_permanent_ban' }) }));
  });

  it('a permanently banned business cannot be given a time-limited suspension (it would end the ban)', async () => {
    const { service, prisma } = setup();
    prisma.permanentBan.findUnique.mockResolvedValueOnce({ id: 'ban-1' });
    await expect(service.suspendBusiness('bz-1', 'ceo', { days: 30, reason: 'Repeated no-shows' })).rejects.toThrow(ConflictException);
    expect(prisma.business.update).not.toHaveBeenCalled();
  });

  it('a business ban suspends it permanently and keeps its GSTIN fingerprint; banning twice is refused', async () => {
    const { service, prisma } = setup();
    await service.ban('ceo', { subjectType: 'business', subjectId: 'bz-1', category: 'fraud', reason: 'Fake vacancies to collect candidates' });
    expect(prisma.permanentBan.create.mock.calls[0][0].data.idFingerprints).toEqual([businessIdFingerprint('gstin', '29ABCDE1234F1Z5')]);
    expect(prisma.business.update).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ suspendedUntil: null }) }));
    prisma.permanentBan.findUnique.mockResolvedValueOnce({ id: 'ban-1' } as never);
    await expect(service.ban('ceo', { subjectType: 'business', subjectId: 'bz-1', category: 'fraud', reason: 'Fake vacancies again' })).rejects.toThrow(ConflictException);
  });

  it('the same phone or ID cannot register again', async () => {
    const prisma = { permanentBan: { findFirst: jest.fn(async () => ({ id: 'ban-1', subjectType: 'job_seeker', category: 'fraud' })) } };
    await expect(assertNotBanned(prisma as never, { phone: '9876512345' })).rejects.toThrow(ForbiddenException);
    expect(prisma.permanentBan.findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: { OR: [{ phoneHash: phoneHash('+91 98765 12345') }] } }));
    const clear = { permanentBan: { findFirst: jest.fn(async () => null) } };
    await expect(assertNotBanned(clear as never, { phone: '9000000001', idFingerprints: [aadhaarFingerprint('1111', '1995-05-05', 'Someone')] })).resolves.toBeUndefined();
    expect(phoneHash('+919876512345')).toBe(phoneHash('98765 12345'));
  });
});

describe('D1 claim reason: medically unfit or moved out of the city (covered)', () => {
  it('is a covered reason, next to the agreed list', () => {
    expect(isAcceptClaimReason('medically_unfit_or_relocated')).toBe(true);
    expect(isRejectClaimReason('medically_unfit_or_relocated')).toBe(false);
    expect(ACCEPT_CLAIM_REASONS).toContain('never_joined');
  });
});
