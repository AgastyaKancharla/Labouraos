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
  const business = { id: 'bz-1', code: 'BZ-00001', city: 'Bengaluru', phone: '+919811100000', gstNumber: '29ABCDE1234F1Z5', pan: null, suspendedAt: null as Date | null, suspendedUntil: null as Date | null, suspendedByStaffId: null as string | null, suspensionReason: null as string | null };
  const prisma = {
    staff: { findUnique: jest.fn(async ({ where }: { where: { id: string } }) => STAFF[where.id] ?? null) },
    business: {
      findUnique: jest.fn(async () => business),
      findMany: jest.fn(async (): Promise<unknown[]> => []),
      update: jest.fn(async ({ data }: { data: Record<string, unknown> }) => Object.assign(business, data)),
    },
    jobSeeker: {
      findUnique: jest.fn(async (): Promise<unknown> => ({ id: 'js-1', code: 'JS-00001', phone: '+919876512345', name: 'Ravi Kumar', status: 'active', city: 'Bengaluru', identityVerifications: [{ id: 'iv-1', method: 'aadhaar_qr', last4: '1234' }] })),
      findUniqueOrThrow: jest.fn(async () => ({ status: 'active' })),
      findMany: jest.fn(async (): Promise<unknown[]> => [{ id: 'js-1', code: 'JS-00001', phone: '+919876512345', name: 'Ravi Kumar', status: 'active', identityVerifications: [{ id: 'iv-1', method: 'aadhaar_qr', last4: '1234' }] }]),
      update: jest.fn(),
    },
    referral: { findUnique: jest.fn(), findMany: jest.fn(async (): Promise<unknown[]> => []), update: jest.fn() },
    idCheckDetail: { findMany: jest.fn(async () => [{ verificationId: 'iv-1', dateOfBirth: '1990-01-01', nameOnId: 'Ravi Kumar' }]) },
    permanentBan: { create: jest.fn(), findFirst: jest.fn(async (): Promise<unknown> => null), updateMany: jest.fn(async () => ({ count: 1 })) },
    replacementClaim: {
      updateMany: jest.fn(async () => ({ count: 1 })),
      findMany: jest.fn(async (): Promise<unknown[]> => []),
      update: jest.fn(),
    },
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
    prisma.permanentBan.findFirst.mockResolvedValueOnce({ id: 'ban-1' });
    await expect(service.suspendBusiness('bz-1', 'ceo', { days: 30, reason: 'Repeated no-shows' })).rejects.toThrow(ConflictException);
    expect(prisma.business.update).not.toHaveBeenCalled();
  });

  it('a business ban suspends it permanently and keeps its GSTIN fingerprint; banning twice is refused', async () => {
    const { service, prisma } = setup();
    await service.ban('ceo', { subjectType: 'business', subjectId: 'bz-1', category: 'fraud', reason: 'Fake vacancies to collect candidates' });
    expect(prisma.permanentBan.create.mock.calls[0][0].data.idFingerprints).toEqual([businessIdFingerprint('gstin', '29ABCDE1234F1Z5')]);
    expect(prisma.business.update).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ suspendedUntil: null }) }));
    prisma.permanentBan.findFirst.mockResolvedValueOnce({ id: 'ban-1' } as never);
    await expect(service.ban('ceo', { subjectType: 'business', subjectId: 'bz-1', category: 'fraud', reason: 'Fake vacancies again' })).rejects.toThrow(ConflictException);
  });

  it('the same phone or ID cannot register again', async () => {
    const prisma = { permanentBan: { findFirst: jest.fn(async () => ({ id: 'ban-1', subjectType: 'job_seeker', category: 'fraud' })) } };
    await expect(assertNotBanned(prisma as never, { phone: '9876512345' })).rejects.toThrow(ForbiddenException);
    expect(prisma.permanentBan.findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: { liftedAt: null, OR: [{ phoneHash: phoneHash('+91 98765 12345') }] } }));
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

describe('M9 (rev 178): a ban covers every profile of the person', () => {
  it('banning a job seeker also blocks his referral profile and the business he owns on the same phone, and remembers what each was', async () => {
    const { service, prisma } = setup();
    prisma.referral.findMany.mockResolvedValueOnce([{ id: 'rf-1', code: 'RF-00001', name: 'Ravi Kumar', phone: '+919876512345', pausedAt: null, pausedByStaffId: null, pauseReason: null, identityVerifications: [] }]);
    prisma.business.findMany.mockResolvedValueOnce([{ id: 'bz-9', code: 'BZ-00009', suspendedAt: null, suspendedUntil: null, suspendedByStaffId: null, suspensionReason: null }]);
    const out = await service.ban('mgr', { subjectType: 'job_seeker', subjectId: 'js-1', category: 'fraud', reason: 'Took money from candidates' });
    expect(out.profiles.map((p) => p.code)).toEqual(['JS-00001', 'RF-00001', 'BZ-00009']);
    const covered = prisma.permanentBan.create.mock.calls[0][0].data.coveredProfiles;
    expect(covered).toEqual([
      expect.objectContaining({ subjectType: 'job_seeker', subjectId: 'js-1', before: { status: 'active' } }),
      expect.objectContaining({ subjectType: 'referral', subjectId: 'rf-1', before: expect.objectContaining({ pausedAt: null }) }),
      expect.objectContaining({ subjectType: 'business', subjectId: 'bz-9', before: expect.objectContaining({ suspendedAt: null }) }),
    ]);
    expect(prisma.referral.update).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 'rf-1' }, data: expect.objectContaining({ pauseReason: expect.stringContaining('Permanent ban') }) }));
    expect(prisma.business.update).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 'bz-9' }, data: expect.objectContaining({ suspendedUntil: null }) }));
    // The business's open claims keep their replacement clocks paused (M10).
    expect(prisma.replacementClaim.updateMany).toHaveBeenCalledWith(expect.objectContaining({ data: { searchPausedAt: NOW } }));
  });

  it('a profile on another phone but with the same Aadhaar is covered too', async () => {
    const { service, prisma } = setup();
    prisma.jobSeeker.findMany.mockResolvedValueOnce([
      { id: 'js-1', code: 'JS-00001', phone: '+919876512345', name: 'Ravi Kumar', status: 'active', identityVerifications: [{ id: 'iv-1', method: 'aadhaar_qr', last4: '1234' }] },
      { id: 'js-2', code: 'JS-00002', phone: '+919000000002', name: 'Ravi Kumar', status: 'placed', identityVerifications: [{ id: 'iv-1', method: 'aadhaar_qr', last4: '1234' }] },
    ]);
    const out = await service.ban('ceo', { subjectType: 'job_seeker', subjectId: 'js-1', category: 'forged_id', reason: 'Altered Aadhaar photo' });
    expect(out.profiles.map((p) => p.code)).toEqual(['JS-00001', 'JS-00002']);
    expect(prisma.jobSeeker.update).toHaveBeenCalledWith({ where: { id: 'js-2' }, data: { status: 'banned' } });
  });

  it('another profile already covered by a live ban cannot be banned again; banOf says which profile the ban came through', async () => {
    const { service, prisma } = setup();
    const ban = { id: 'ban-1', subjectType: 'job_seeker', subjectId: 'js-1', subjectCode: 'JS-00001', category: 'fraud', reason: 'x', bannedAt: NOW, bannedByStaffId: 'mgr', coveredProfiles: [{ subjectType: 'job_seeker', subjectId: 'js-1', code: 'JS-00001', before: {} }, { subjectType: 'referral', subjectId: 'rf-1', code: 'RF-00001', before: {} }] };
    prisma.permanentBan.findFirst.mockResolvedValue(ban);
    await expect(service.ban('ceo', { subjectType: 'referral', subjectId: 'rf-1', category: 'fraud', reason: 'Took money again' })).rejects.toThrow(ConflictException);
    expect(await service.banOf('referral', 'rf-1')).toMatchObject({ banned: true, viaProfile: { subjectType: 'job_seeker', code: 'JS-00001' } });
    expect(prisma.permanentBan.findFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: { liftedAt: null, OR: [{ subjectType: 'referral', subjectId: 'rf-1' }, { coveredProfiles: { array_contains: [{ subjectType: 'referral', subjectId: 'rf-1' }] } }] },
    }));
  });
});

describe('M7 (rev 178): only the CEO lifts a ban, with a reason; the profiles go back to what they were', () => {
  const liveBan = () => ({
    id: 'ban-1', subjectType: 'job_seeker', subjectId: 'js-1', subjectCode: 'JS-00001', category: 'fraud', reason: 'x', bannedAt: NOW, bannedByStaffId: 'mgr',
    coveredProfiles: [
      { subjectType: 'job_seeker', subjectId: 'js-1', code: 'JS-00001', before: { status: 'placed' } },
      { subjectType: 'referral', subjectId: 'rf-1', code: 'RF-00001', before: { pausedAt: null, pausedByStaffId: null, pauseReason: null } },
      { subjectType: 'business', subjectId: 'bz-1', code: 'BZ-00001', before: { suspendedAt: null, suspendedUntil: null, suspendedByStaffId: null, suspensionReason: null } },
      { subjectType: 'job_seeker', subjectId: 'js-old', code: 'JS-00002', before: {} },
    ],
  });

  it('a Manager cannot lift; the CEO needs a reason', async () => {
    const { service, prisma } = setup();
    prisma.permanentBan.findFirst.mockResolvedValue(liveBan());
    await expect(service.liftBan('job_seeker', 'js-1', 'mgr', { reason: 'Police cleared him' })).rejects.toThrow(ForbiddenException);
    await expect(service.liftBan('job_seeker', 'js-1', 'ceo', { reason: '' })).rejects.toThrow(BadRequestException);
    expect(prisma.permanentBan.updateMany).not.toHaveBeenCalled();
  });

  it('marks the ban lifted (never deleted), restores each profile, resumes the business claims and audits it', async () => {
    const { service, prisma, audit } = setup();
    prisma.permanentBan.findFirst.mockResolvedValue(liveBan());
    prisma.jobSeeker.findUnique.mockResolvedValue({ status: 'banned' });
    const out = await service.liftBan('job_seeker', 'js-1', 'ceo', { reason: 'Police cleared him; documents genuine' });
    expect(prisma.permanentBan.updateMany).toHaveBeenCalledWith({ where: { id: 'ban-1', liftedAt: null }, data: { liftedAt: NOW, liftedByStaffId: 'ceo', liftReason: 'Police cleared him; documents genuine' } });
    expect(prisma.jobSeeker.update).toHaveBeenCalledWith({ where: { id: 'js-1' }, data: { status: 'placed' } });
    // Not kept for an older profile: paused for review.
    expect(prisma.jobSeeker.update).toHaveBeenCalledWith({ where: { id: 'js-old' }, data: { status: 'paused' } });
    expect(prisma.statusHistory.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ subjectId: 'js-old', reason: 'permanent_ban_lifted_needs_review' }) }));
    expect(prisma.referral.update).toHaveBeenCalledWith({ where: { id: 'rf-1' }, data: { pausedAt: null, pausedByStaffId: null, pauseReason: null } });
    expect(prisma.business.update).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 'bz-1' }, data: expect.objectContaining({ suspendedAt: null }) }));
    expect(prisma.replacementClaim.findMany).toHaveBeenCalled();
    expect(out.restored.map((r) => r.to)).toEqual(['placed', 'active', 'active', 'paused']);
    expect(audit.log).toHaveBeenCalledWith(expect.objectContaining({ action: 'permanent_ban.lifted', reason: 'Police cleared him; documents genuine' }));
  });

  it('nothing to lift: 404', async () => {
    const { service } = setup();
    await expect(service.liftBan('job_seeker', 'js-1', 'ceo', { reason: 'Police cleared him' })).rejects.toThrow('No permanent ban to lift');
  });
});

describe('M10 (rev 178): suspension pauses the 15-day replacement clock of open claims', () => {
  it('suspending pauses every open claim; lifting folds the pause into the claim and the clock continues', async () => {
    const { service, prisma } = setup();
    await service.suspendBusiness('bz-1', 'ceo', { days: 30, reason: 'Repeated cancellations' });
    expect(prisma.replacementClaim.updateMany).toHaveBeenCalledWith({
      where: { OR: [{ decision: null }, { decision: 'accepted' }], placement: { businessId: 'bz-1', guaranteeEndedReason: null }, searchPausedAt: null },
      data: { searchPausedAt: NOW },
    });
    const pausedAt = new Date(NOW.getTime() - 3 * DAY);
    prisma.replacementClaim.findMany.mockResolvedValueOnce([{ id: 'cl-1', searchPausedAt: pausedAt, searchPausedSeconds: 3600 }]);
    await service.liftSuspension('bz-1', 'ceo', { reason: 'Owner apologised in person' });
    expect(prisma.replacementClaim.update).toHaveBeenCalledWith({ where: { id: 'cl-1' }, data: { searchPausedAt: null, searchPausedSeconds: 3600 + 3 * 24 * 3600 } });
  });
});
