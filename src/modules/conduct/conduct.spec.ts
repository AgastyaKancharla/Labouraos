import { withSendingRules } from '../../test-support/messaging-double';
import { BadRequestException, ConflictException, ForbiddenException } from '@nestjs/common';
import { ConductService } from './conduct.service';
import { ReviewFlagService } from '../review-flag/review-flag.service';
import { aadhaarFingerprint, assertNotBanned, raisePossibleBanReview, businessIdFingerprint, EXAMPLE_BAN_HASH_KEY, getBanHashKey, phoneHash } from './permanent-ban.check';
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
    permanentBan: { update: jest.fn(), create: jest.fn(async (args: { data: Record<string, unknown> }): Promise<{ id: string }> => ({ id: args ? 'ban-new' : '' })), findFirst: jest.fn(async (...args: unknown[]): Promise<unknown> => (args.length ? null : null)), updateMany: jest.fn(async (...args: unknown[]) => ({ count: args.length })) },
    interview: {
      findMany: jest.fn(async (): Promise<unknown[]> => []),
      updateMany: jest.fn(async () => ({ count: 1 })),
    },
    reviewFlag: {
      findUnique: jest.fn(async (): Promise<unknown> => null),
      findFirst: jest.fn(async (): Promise<unknown> => null),
      findMany: jest.fn(async (): Promise<unknown[]> => []),
      update: jest.fn(),
      updateMany: jest.fn(async () => ({ count: 1 })),
    },
    replacementClaim: {
      updateMany: jest.fn(async () => ({ count: 1 })),
      findMany: jest.fn(async (): Promise<unknown[]> => []),
      update: jest.fn(),
    },
    payment: { findMany: jest.fn(async (...args: unknown[]): Promise<unknown[]> => (args.length ? [{ id: 'pay-open' }] : [])), updateMany: jest.fn() },
    statusHistory: { create: jest.fn() },
    ...overrides,
  };
  const withTx = Object.assign(prisma, { $executeRaw: jest.fn().mockResolvedValue(1), $transaction: jest.fn(async (cb: (tx: unknown) => unknown): Promise<unknown> => cb(prisma)) });
  const audit = { log: jest.fn() };
  const messaging = withSendingRules({ send: jest.fn().mockResolvedValue({}) });
  const notifications = { notify: jest.fn().mockResolvedValue({}) };
  const flags = { raise: jest.fn().mockResolvedValue({ id: 'flag-1' }), refreshBell: jest.fn() };
  const service = new ConductService(withTx as never, audit as never, { now: () => NOW } as never, messaging as never, notifications as never, flags as never);
  return { service, prisma: withTx, audit, business, messaging, notifications, flags };
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
    let lifted = false;
    prisma.permanentBan.findFirst.mockImplementation(async () => (lifted ? null : liveBan()));
    prisma.permanentBan.updateMany.mockImplementation(async () => { lifted = true; return { count: 1 }; });
    prisma.jobSeeker.findUnique.mockResolvedValue({ status: 'banned' });
    const out = await service.liftBan('job_seeker', 'js-1', 'ceo', { reason: 'Police cleared him; documents genuine' });
    expect(prisma.permanentBan.updateMany).toHaveBeenCalledWith({ where: { id: 'ban-1', liftedAt: null }, data: { liftedAt: NOW, liftedByStaffId: 'ceo', liftReason: 'Police cleared him; documents genuine' } });
    // H1: placed is not one he goes back to (active, paused, inactive): paused for review.
    expect(prisma.jobSeeker.update).toHaveBeenCalledWith({ where: { id: 'js-1' }, data: { status: 'paused' } });
    // Not kept for an older profile: paused for review.
    expect(prisma.jobSeeker.update).toHaveBeenCalledWith({ where: { id: 'js-old' }, data: { status: 'paused' } });
    expect(prisma.statusHistory.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ subjectId: 'js-old', reason: 'permanent_ban_lifted_needs_review' }) }));
    expect(prisma.referral.update).toHaveBeenCalledWith({ where: { id: 'rf-1' }, data: { pausedAt: null, pausedByStaffId: null, pauseReason: null } });
    expect(prisma.business.update).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 'bz-1' }, data: expect.objectContaining({ suspendedAt: null }) }));
    expect(prisma.replacementClaim.findMany).toHaveBeenCalled();
    expect(out.restored.map((r) => r.to)).toEqual(['paused', 'active', 'active', 'paused']);
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
      where: { OR: [{ decision: null }, { decision: 'accepted' }], placement: { businessId: 'bz-1', guaranteeEndedReason: null, replacementCandidates: { none: { status: 'accepted' } } }, searchPausedAt: null },
      data: { searchPausedAt: NOW },
    });
    const pausedAt = new Date(NOW.getTime() - 3 * DAY);
    prisma.replacementClaim.findMany.mockResolvedValueOnce([{ id: 'cl-1', searchPausedAt: pausedAt, searchPausedSeconds: 3600 }]);
    await service.liftSuspension('bz-1', 'ceo', { reason: 'Owner apologised in person' });
    expect(prisma.replacementClaim.updateMany).toHaveBeenCalledWith({ where: { id: 'cl-1', searchPausedAt: pausedAt, searchPausedSeconds: 3600 }, data: { searchPausedAt: null, searchPausedSeconds: 3600 + 3 * 24 * 3600 } });
  });
});

describe('H1: overlapping bans on the same person', () => {
  const NOW2 = NOW;
  it('a second ban does not overwrite what a profile was: it copies the earlier ban\'s "before" and does not block it again; the cover lookup runs under the advisory lock', async () => {
    const { service, prisma } = setup();
    const earlier = { id: 'ban-1', subjectType: 'job_seeker', subjectId: 'js-1', subjectCode: 'JS-00001', coveredProfiles: [{ subjectType: 'referral', subjectId: 'rf-1', code: 'RF-00001', before: { pausedAt: null, pausedByStaffId: null, pauseReason: 'kept' } }] };
    prisma.jobSeeker.findUnique.mockResolvedValue({ id: 'js-2', code: 'JS-00002', phone: '+919000000002', name: 'Ravi Kumar', status: 'active', city: 'Bengaluru', identityVerifications: [] });
    prisma.jobSeeker.findMany.mockResolvedValue([{ id: 'js-2', code: 'JS-00002', phone: '+919000000002', name: 'Ravi Kumar', status: 'active', identityVerifications: [] }]);
    prisma.referral.findMany.mockResolvedValueOnce([{ id: 'rf-1', code: 'RF-00001', name: 'Ravi Kumar', phone: '+919000000002', pausedAt: NOW2, pausedByStaffId: 'mgr', pauseReason: 'Permanent ban (fraud)', identityVerifications: [] }]);
    prisma.permanentBan.findFirst.mockImplementation(async (args?: unknown) =>
      JSON.stringify((args as { where: { OR: unknown[] } }).where.OR).includes('rf-1') ? earlier : null);
    await service.ban('ceo', { subjectType: 'job_seeker', subjectId: 'js-2', category: 'fraud', reason: 'Same person again' });
    expect(prisma.$executeRaw).toHaveBeenCalled();
    const covered = prisma.permanentBan.create.mock.calls[0][0].data.coveredProfiles as { subjectId: string; before: Record<string, unknown>; alreadyBannedBy?: string }[];
    expect(covered.find((p) => p.subjectId === 'rf-1')).toMatchObject({ before: { pauseReason: 'kept' }, alreadyBannedBy: 'ban-1' });
    expect(prisma.referral.update).not.toHaveBeenCalled();
  });

  it('lifting one of two bans leaves the shared profile blocked; lifting the other restores it (either order)', async () => {
    for (const order of [['ban-1', 'ban-2'], ['ban-2', 'ban-1']]) {
      const { service, prisma } = setup();
      const shared = { subjectType: 'referral', subjectId: 'rf-1', code: 'RF-00001', before: { pausedAt: null, pausedByStaffId: null, pauseReason: null } };
      const bans: Record<string, { id: string; subjectType: string; subjectId: string; subjectCode: string; category: string; coveredProfiles: unknown[]; lifted?: boolean }> = {
        'ban-1': { id: 'ban-1', subjectType: 'job_seeker', subjectId: 'js-1', subjectCode: 'JS-00001', category: 'fraud', coveredProfiles: [{ subjectType: 'job_seeker', subjectId: 'js-1', code: 'JS-00001', before: { status: 'active' } }, shared] },
        'ban-2': { id: 'ban-2', subjectType: 'job_seeker', subjectId: 'js-2', subjectCode: 'JS-00002', category: 'fraud', coveredProfiles: [{ subjectType: 'job_seeker', subjectId: 'js-2', code: 'JS-00002', before: { status: 'active' } }, { ...shared, alreadyBannedBy: 'ban-1' }] },
      };
      prisma.permanentBan.findFirst.mockImplementation(async (args?: unknown) => {
        const where = (args as { where: { id?: string; OR?: unknown[] } }).where;
        if (where.id) return bans[where.id] && !bans[where.id].lifted ? bans[where.id] : null;
        const text = JSON.stringify(where.OR);
        return Object.values(bans).find((b) => !b.lifted && (text.includes(`"${b.subjectId}"`) || b.coveredProfiles.some((p) => text.includes(`"${(p as { subjectId: string }).subjectId}"`)))) ?? null;
      });
      prisma.permanentBan.updateMany.mockImplementation(async (args?: unknown) => { bans[(args as { where: { id: string } }).where.id].lifted = true; return { count: 1 }; });
      prisma.jobSeeker.findUnique.mockResolvedValue({ status: 'banned' });
      const first = bans[order[0]];
      const out1 = await service.liftBan('job_seeker', first.subjectId, 'ceo', { reason: 'First lift reason' });
      expect(out1.restored.find((r) => r.code === 'RF-00001')?.to).toBe('still_banned');
      expect(prisma.referral.update).not.toHaveBeenCalled();
      const second = bans[order[1]];
      const out2 = await service.liftBan('job_seeker', second.subjectId, 'ceo', { reason: 'Second lift reason' });
      expect(out2.restored.find((r) => r.code === 'RF-00001')?.to).toBe('active');
      expect(prisma.referral.update).toHaveBeenCalledWith({ where: { id: 'rf-1' }, data: { pausedAt: null, pausedByStaffId: null, pauseReason: null } });
    }
  });
});

describe('M4 (review): a suspended business interviews no one — its upcoming interviews are cancelled', () => {
  it('cancels offered and confirmed interviews still ahead, and tells the job seeker (app + SMS) and the business', async () => {
    const { service, prisma, messaging, notifications } = setup();
    prisma.interview.findMany.mockResolvedValueOnce([{ id: 'int-1', jobSeekerId: 'js-1', status: 'confirmed' }, { id: 'int-2', jobSeekerId: 'js-2', status: 'offered' }]);
    await service.suspendBusiness('bz-1', 'ceo', { days: 30, reason: 'Repeated cancellations' });
    expect(prisma.interview.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { businessId: 'bz-1', status: { in: ['offered', 'confirmed'] }, slotStartsAt: { gt: NOW } } }));
    expect(prisma.interview.updateMany).toHaveBeenCalledWith({ where: { id: 'int-1', status: 'confirmed' }, data: { status: 'cancelled', cancelReason: 'business_suspended' } });
    expect(notifications.notify).toHaveBeenCalledWith({ jobSeekerId: 'js-1' }, 'interview_cancelled', {}, expect.anything());
    expect(notifications.notify).toHaveBeenCalledWith({ businessId: 'bz-1' }, 'interview_cancelled', {}, expect.anything());
    expect(messaging.send).toHaveBeenCalledWith(expect.objectContaining({ template: 'interview_cancelled', subjectId: 'js-2' }));
  });
});

describe('H2 (rev 181): a match only on another ID goes to a Manager or the CEO', () => {
  it('at ban time a profile matching only on a PAN (type + last 4 + name) is not covered: a review item is raised', async () => {
    const { service, prisma, flags } = setup();
    prisma.jobSeeker.findUnique.mockResolvedValue({ id: 'js-1', code: 'JS-00001', phone: '+919876512345', name: 'Ravi Kumar', status: 'active', city: 'Bengaluru', identityVerifications: [{ id: 'iv-9', method: 'pan', last4: '234F' }] });
    prisma.jobSeeker.findMany.mockResolvedValue([
      { id: 'js-1', code: 'JS-00001', phone: '+919876512345', name: 'Ravi Kumar', status: 'active', identityVerifications: [{ id: 'iv-9', method: 'pan', last4: '234F' }] },
      { id: 'js-7', code: 'JS-00007', phone: '+919000000007', name: 'Ravi Kumar', status: 'active', identityVerifications: [{ id: 'iv-7', method: 'pan', last4: '234F' }] },
    ]);
    prisma.permanentBan.create.mockResolvedValue({ id: 'ban-9' });
    const out = await service.ban('ceo', { subjectType: 'job_seeker', subjectId: 'js-1', category: 'fraud', reason: 'Took money from others' });
    expect(out.profiles.map((p) => p.code)).toEqual(['JS-00001']);
    expect(prisma.jobSeeker.update).not.toHaveBeenCalledWith({ where: { id: 'js-7' }, data: { status: 'banned' } });
    expect(flags.raise).toHaveBeenCalledWith(expect.objectContaining({ kind: 'possible_banned_person', subjectType: 'job_seeker', subjectId: 'js-7', owner: { role: 'manager' }, details: expect.objectContaining({ banId: 'ban-9' }) }));
  });

  const flag = { id: 'flag-1', kind: 'possible_banned_person', status: 'open', subjectType: 'job_seeker', subjectId: 'js-7', details: { banId: 'ban-9', subjectCode: 'JS-00007' } };
  const ban = { id: 'ban-9', subjectType: 'job_seeker', subjectId: 'js-1', subjectCode: 'JS-00001', category: 'fraud', reason: 'x', coveredProfiles: [{ subjectType: 'job_seeker', subjectId: 'js-1', code: 'JS-00001', before: { status: 'active' } }] };

  it('"Confirm — same person": Manager or CEO with a reason; the profile is covered and blocked; audited', async () => {
    const { service, prisma, audit } = setup();
    await expect(service.confirmPossibleMatch('flag-1', 'tl', { reason: 'Same photo' })).rejects.toThrow(ForbiddenException);
    prisma.reviewFlag.findUnique.mockResolvedValue(flag);
    prisma.permanentBan.findFirst.mockImplementation(async (...args: unknown[]) => (JSON.stringify(args).includes('"id":"ban-9"') ? ban : null));
    prisma.jobSeeker.findUnique.mockResolvedValue({ id: 'js-7', code: 'JS-00007', status: 'active' });
    await service.confirmPossibleMatch('flag-1', 'mgr', { reason: 'Same photo and same date of birth' });
    const update = (prisma.permanentBan as unknown as { update: jest.Mock }).update;
    expect(update).toHaveBeenCalledWith({ where: { id: 'ban-9' }, data: { coveredProfiles: [...ban.coveredProfiles, { subjectType: 'job_seeker', subjectId: 'js-7', code: 'JS-00007', before: { status: 'active' } }] } });
    expect(prisma.jobSeeker.update).toHaveBeenCalledWith({ where: { id: 'js-7' }, data: { status: 'banned' } });
    expect(prisma.reviewFlag.updateMany).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 'flag-1', status: 'open' }, data: expect.objectContaining({ status: 'resolved', details: expect.objectContaining({ decision: 'same_person' }) }) }));
    expect(audit.log).toHaveBeenCalledWith(expect.objectContaining({ action: 'permanent_ban.possible_match_confirmed', reason: 'Same photo and same date of birth' }));
  });

  it('"Not the same person": clears the item with a reason, audited', async () => {
    const { service, prisma, audit } = setup();
    prisma.reviewFlag.findUnique.mockResolvedValue(flag);
    await service.rejectPossibleMatch('flag-1', 'ceo', { reason: 'Different person, checked on a call' });
    expect(prisma.reviewFlag.updateMany).toHaveBeenCalledWith({ where: { id: 'flag-1', status: 'open' }, data: expect.objectContaining({ status: 'dismissed', details: expect.objectContaining({ decision: 'not_same' }) }) });
    expect(audit.log).toHaveBeenCalledWith(expect.objectContaining({ action: 'permanent_ban.possible_match_rejected' }));
  });

  it('the generic "Resolve" refuses a possible-match item: only the two decisions close it', async () => {
    const prisma = { reviewFlag: { findUnique: jest.fn(async () => flag), update: jest.fn() } };
    const flags = new ReviewFlagService(prisma as never, {} as never, { log: jest.fn() } as never);
    await expect(flags.resolve('flag-1', { id: 'ceo', role: 'ceo' }, { status: 'dismissed', resolution: 'Looked fine' })).rejects.toThrow(/Confirm — same person/);
    expect(prisma.reviewFlag.update).not.toHaveBeenCalled();
  });
});

describe('Fable final check: ban, lift and review decisions under one lock', () => {
  const ban = { id: 'ban-9', subjectType: 'job_seeker', subjectId: 'js-1', subjectCode: 'JS-00001', category: 'fraud', reason: 'x', coveredProfiles: [{ subjectType: 'job_seeker', subjectId: 'js-1', code: 'JS-00001', before: { status: 'active' } }] };
  const flag = { id: 'flag-1', kind: 'possible_banned_person', status: 'open', subjectType: 'job_seeker', subjectId: 'js-7', raisedAt: new Date(NOW.getTime() - DAY), details: { banId: 'ban-9', subjectCode: 'JS-00007' } };

  it('M-B: the lift takes the lock first and restores the ban as it is now (a profile confirmed a moment earlier too)', async () => {
    const { service, prisma } = setup();
    const order: string[] = [];
    prisma.$executeRaw.mockImplementation(async () => { order.push('lock'); return 1; });
    const confirmedMeanwhile = { ...ban, coveredProfiles: [...ban.coveredProfiles, { subjectType: 'job_seeker', subjectId: 'js-7', code: 'JS-00007', before: { status: 'inactive' } }] };
    prisma.permanentBan.findFirst.mockImplementation(async (args?: unknown) => {
      const where = (args as { where: { id?: string } }).where;
      if (where.id) { order.push('read'); return confirmedMeanwhile; }
      return order.includes('read') ? null : ban; // what the lift saw before the lock; lifted afterwards
    });
    prisma.jobSeeker.findUnique.mockResolvedValue({ status: 'banned' });
    const out = await service.liftBan('job_seeker', 'js-1', 'ceo', { reason: 'Police cleared him' });
    expect(order.slice(0, 2)).toEqual(['lock', 'read']);
    expect(out.restored.map((r) => r.code)).toEqual(['JS-00001', 'JS-00007']);
    expect(prisma.jobSeeker.update).toHaveBeenCalledWith({ where: { id: 'js-7' }, data: { status: 'inactive' } });
    expect(prisma.$transaction).toHaveBeenCalledWith(expect.any(Function), { maxWait: 10_000, timeout: 60_000 });
  });

  it('M-B: a ban lifted meanwhile (by another lift) is refused, and nothing is restored', async () => {
    const { service, prisma } = setup();
    prisma.permanentBan.findFirst.mockImplementation(async (args?: unknown) => ((args as { where: { id?: string } }).where.id ? null : ban));
    await expect(service.liftBan('job_seeker', 'js-1', 'ceo', { reason: 'Police cleared him' })).rejects.toThrow('already lifted');
    expect(prisma.jobSeeker.update).not.toHaveBeenCalled();
  });

  it('M-B: a new ban and a lift wait for each other on the same lock', async () => {
    const { service, prisma } = setup();
    await service.ban('ceo', { subjectType: 'job_seeker', subjectId: 'js-1', category: 'fraud', reason: 'Forged papers' });
    prisma.permanentBan.findFirst.mockResolvedValue(ban);
    prisma.jobSeeker.findUnique.mockResolvedValue({ status: 'banned' });
    await service.liftBan('job_seeker', 'js-1', 'ceo', { reason: 'Police cleared him' });
    const locks = prisma.$executeRaw.mock.calls.map((c: unknown[]) => JSON.stringify(c[0]));
    expect(locks.length).toBe(2);
    expect(locks[0]).toContain('permanent-ban');
    expect(locks[1]).toEqual(locks[0]);
  });

  it('the lift dismisses the open "possibly the same person" items about that ban, audited', async () => {
    const { service, prisma, audit, flags } = setup();
    prisma.permanentBan.findFirst.mockResolvedValue(ban);
    prisma.jobSeeker.findUnique.mockResolvedValue({ status: 'banned' });
    prisma.reviewFlag.findMany.mockResolvedValue([{ id: 'flag-1', details: { banId: 'ban-9', subjectCode: 'JS-00007' } }]);
    await service.liftBan('job_seeker', 'js-1', 'ceo', { reason: 'Police cleared him' });
    expect(prisma.reviewFlag.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { kind: 'possible_banned_person', status: 'open', details: { path: ['banId'], equals: 'ban-9' } } }));
    expect(prisma.reviewFlag.updateMany).toHaveBeenCalledWith({ where: { id: 'flag-1', status: 'open' }, data: expect.objectContaining({ status: 'dismissed', resolution: 'The ban was lifted: Police cleared him' }) });
    expect(flags.refreshBell).toHaveBeenCalledWith('flag-1');
    expect(audit.log).toHaveBeenCalledWith(expect.objectContaining({ action: 'permanent_ban.possible_matches_dismissed', after: { openReviews: 0, profiles: ['JS-00007'] } }));
  });

  it('Confirm racing "Not the same person": the loser changes nothing', async () => {
    const { service, prisma } = setup();
    prisma.reviewFlag.findUnique.mockResolvedValue(flag);
    prisma.permanentBan.findFirst.mockImplementation(async (...args: unknown[]) => (JSON.stringify(args).includes('"id":"ban-9"') ? ban : null));
    prisma.jobSeeker.findUnique.mockResolvedValue({ id: 'js-7', code: 'JS-00007', status: 'active' });
    prisma.reviewFlag.updateMany.mockResolvedValueOnce({ count: 0 });
    await expect(service.confirmPossibleMatch('flag-1', 'mgr', { reason: 'Same photo' })).rejects.toThrow('already decided');
    expect((prisma.permanentBan as unknown as { update: jest.Mock }).update).not.toHaveBeenCalled();
    expect(prisma.jobSeeker.update).not.toHaveBeenCalled();
  });

  it('Confirm on a profile already under another ban keeps what he was before that ban', async () => {
    const { service, prisma } = setup();
    const other = { id: 'ban-3', subjectType: 'job_seeker', subjectId: 'js-3', subjectCode: 'JS-00003', coveredProfiles: [{ subjectType: 'job_seeker', subjectId: 'js-7', code: 'JS-00007', before: { status: 'paused' } }] };
    prisma.reviewFlag.findUnique.mockResolvedValue(flag);
    prisma.permanentBan.findFirst.mockImplementation(async (...args: unknown[]) => (JSON.stringify(args).includes('"id":"ban-9"') ? ban : other));
    prisma.jobSeeker.findUnique.mockResolvedValue({ id: 'js-7', code: 'JS-00007', status: 'banned' });
    await service.confirmPossibleMatch('flag-1', 'ceo', { reason: 'Same photo' });
    const update = (prisma.permanentBan as unknown as { update: jest.Mock }).update;
    expect(update.mock.calls[0][0].data.coveredProfiles.at(-1)).toEqual({ subjectType: 'job_seeker', subjectId: 'js-7', code: 'JS-00007', before: { status: 'paused' }, alreadyBannedBy: 'ban-3' });
    expect(prisma.jobSeeker.update).not.toHaveBeenCalled();
  });

  it('M-A: Confirm raises a refund flag for a ₹499 that came in after the item was raised', async () => {
    const { service, prisma, flags } = setup();
    prisma.reviewFlag.findUnique.mockResolvedValue(flag);
    prisma.permanentBan.findFirst.mockImplementation(async (...args: unknown[]) => (JSON.stringify(args).includes('"id":"ban-9"') ? ban : null));
    prisma.jobSeeker.findUnique.mockResolvedValue({ id: 'js-7', code: 'JS-00007', status: 'registered' });
    prisma.payment.findMany.mockImplementation(async (...args: unknown[]) => (JSON.stringify(args).includes('"status":"succeeded"') ? [{ id: 'pay-499', code: 'PAY-00499', amount: 49900 }] : []));
    await service.confirmPossibleMatch('flag-1', 'mgr', { reason: 'Same photo and address' });
    expect(prisma.payment.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { jobSeekerId: 'js-7', type: 'activation', status: 'succeeded', confirmedAt: { gte: flag.raisedAt } } }));
    expect(flags.raise).toHaveBeenCalledWith(expect.objectContaining({ kind: 'payment_mismatch', subjectType: 'payment', subjectId: 'pay-499', details: expect.objectContaining({ reason: 'paid_while_ban_review_open', refund: true, jobSeekerCode: 'JS-00007' }) }));
  });

  it('one open review item per profile: raised in a transaction under a lock for that profile', async () => {
    let open: unknown = null;
    const tx = {
      $executeRaw: jest.fn().mockResolvedValue(1),
      reviewFlag: { findFirst: jest.fn(async () => open) },
    };
    const prisma = { $transaction: jest.fn(async (cb: (t: unknown) => unknown) => cb(tx)) };
    const flags = { raise: jest.fn(async () => { open = { id: 'flag-1' }; return { id: 'flag-1' }; }), refreshBell: jest.fn() };
    const input = { subjectType: 'job_seeker', subjectId: 'js-7', details: { banId: 'ban-9' } };
    expect(await raisePossibleBanReview(prisma as never, flags as never, input)).toEqual({ id: 'flag-1' });
    expect(await raisePossibleBanReview(prisma as never, flags as never, input)).toBeNull();
    expect(flags.raise).toHaveBeenCalledTimes(1);
    expect(flags.raise).toHaveBeenCalledWith(expect.objectContaining({ kind: 'possible_banned_person', subjectId: 'js-7', owner: { role: 'manager' } }), { tx });
    expect(JSON.stringify(tx.$executeRaw.mock.calls[0])).toContain('possible-ban:job_seeker:js-7');
    expect(flags.refreshBell).toHaveBeenCalledWith('flag-1');
  });

  it('a suspension tells only about interviews it really cancelled', async () => {
    const { service, prisma, messaging, notifications } = setup();
    prisma.interview.findMany.mockResolvedValueOnce([{ id: 'int-1', jobSeekerId: 'js-1', status: 'confirmed' }, { id: 'int-2', jobSeekerId: 'js-2', status: 'offered' }]);
    prisma.interview.updateMany.mockResolvedValueOnce({ count: 0 }).mockResolvedValueOnce({ count: 1 });
    await service.suspendBusiness('bz-1', 'ceo', { days: 30, reason: 'Repeated cancellations' });
    expect(notifications.notify).not.toHaveBeenCalledWith({ jobSeekerId: 'js-1' }, 'interview_cancelled', {}, expect.anything());
    expect(messaging.send).not.toHaveBeenCalledWith(expect.objectContaining({ subjectId: 'js-1' }));
    expect(messaging.send).toHaveBeenCalledWith(expect.objectContaining({ template: 'interview_cancelled', subjectId: 'js-2' }));
  });
});

describe('PERMANENT_BAN_HASH_KEY', () => {
  const keep = { key: process.env.PERMANENT_BAN_HASH_KEY, env: process.env.NODE_ENV };
  afterEach(() => {
    process.env.PERMANENT_BAN_HASH_KEY = keep.key;
    process.env.NODE_ENV = keep.env;
  });
  it('refuses the .env.example placeholder in production, and a short or missing key anywhere', () => {
    process.env.PERMANENT_BAN_HASH_KEY = EXAMPLE_BAN_HASH_KEY;
    process.env.NODE_ENV = 'production';
    expect(() => getBanHashKey()).toThrow('example value');
    process.env.NODE_ENV = 'test';
    expect(getBanHashKey()).toBe(EXAMPLE_BAN_HASH_KEY);
    process.env.PERMANENT_BAN_HASH_KEY = 'short';
    expect(() => getBanHashKey()).toThrow('at least 32');
  });
});
