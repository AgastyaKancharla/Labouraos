import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { ageInYears, ScreensCallRegistrationService } from './screens-call-registration.service';
import { BENGALURU_AREAS, cityForPincode } from './bengaluru-areas';
import { encryptCallRoutingPhone } from '../staff/call-routing-key';

const NOW = new Date('2026-11-11T05:30:00.000Z'); // 11:00 IST

function makeService(prisma: Record<string, unknown>, registration?: unknown) {
  const jobSeekers = {
    getRegistrationStatus: jest.fn().mockResolvedValue(
      registration ?? {
        jobSeekerId: 'js-1',
        steps: {
          phone: { state: 'done', time: NOW, reason: null },
          consent: { state: 'not_started', time: null, reason: null },
          selfie: { state: 'not_started', time: null, reason: null },
          idCheck: { state: 'not_started', time: null, reason: null },
          payment: { state: 'not_started', time: null, reason: null },
        },
        registrationLinkExpiresAt: null,
        paymentOnlyLink: { live: false, expiresAt: null },
      },
    ),
  };
  const pricing = { current: jest.fn().mockResolvedValue({ jobSeekerGuaranteeDays: 30 }) };
  const clock = { now: () => NOW };
  const areas = { options: jest.fn().mockResolvedValue([...BENGALURU_AREAS]) };
  return new ScreensCallRegistrationService(prisma as never, jobSeekers as never, pricing as never, clock as never, areas as never);
}

const seekerRow = {
  id: '0b8f7c1e-1111-4222-8333-944444444444',
  code: 'JS-01042',
  name: 'Kavya Reddy',
  phone: '9845012345',
  phoneVerified: true,
  createdAt: new Date('2026-11-09T05:01:00.000Z'),
  dateOfBirth: new Date('1998-03-14T00:00:00.000Z'),
  gender: 'female',
  messageLanguage: 'kn',
  locality: 'BTM Layout 2nd Stage',
  travelDistanceKm: 8,
  shiftPreference: 'day',
  salaryPeriod: 'monthly',
  minSalary: 1300000,
  maxSalary: 1600000,
  status: 'lead',
  paymentReceivedAt: null as Date | null,
  trades: [
    { trade: 'Housekeeping', yearsExperience: 3, isPrimary: true },
    { trade: 'Laundry / ironing', yearsExperience: 2, isPrimary: false },
  ],
};

function seekerPrisma(overrides: Record<string, unknown> = {}) {
  return {
    jobSeeker: { findFirst: jest.fn().mockResolvedValue({ ...seekerRow, ...overrides }) },
    payment: { findFirst: jest.fn().mockResolvedValue(null) },
    publicLink: { findMany: jest.fn().mockResolvedValue([]), findFirst: jest.fn().mockResolvedValue(null) },
    consent: { findMany: jest.fn().mockResolvedValue([]) },
    trade: { findMany: jest.fn().mockResolvedValue([{ nameKey: 'housekeeping' }]) },
  };
}

describe('ScreensCallRegistrationService', () => {
  it('serves the managed Bengaluru area list with a pincode and pin for each area', async () => {
    const service = makeService({});
    const { areas, city } = await service.options();
    expect(city).toBe('Bengaluru');
    expect(areas).toEqual(BENGALURU_AREAS);
    for (const area of areas) {
      expect(area.pincode).toMatch(/^560\d{3}$/);
      expect(area.latitude).toBeGreaterThan(12.7);
      expect(area.latitude).toBeLessThan(13.2);
    }
  });

  it('fills the city from a Bengaluru pincode only', () => {
    expect(cityForPincode('560076')).toBe('Bengaluru');
    expect(cityForPincode('600001')).toBeNull();
    expect(cityForPincode('5600')).toBeNull();
  });

  it('counts age in IST calendar years', () => {
    expect(ageInYears(new Date('1998-03-14T00:00:00.000Z'), NOW)).toBe(28);
    expect(ageInYears(new Date('2008-11-11T00:00:00.000Z'), NOW)).toBe(18);
    expect(ageInYears(new Date('2008-11-12T00:00:00.000Z'), NOW)).toBe(17);
  });

  describe('job seeker summary and step panel', () => {
    it('shows a just-saved job seeker as registered with nothing sent', async () => {
      const prisma = seekerPrisma();
      const result = await makeService(prisma).jobSeeker(seekerRow.id);
      expect(prisma.jobSeeker.findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: { id: seekerRow.id } }));
      expect(result).toMatchObject({
        code: 'JS-01042',
        age: 28,
        stage: 'registered',
        nextStep: 'consent',
        phoneVerifiedAt: seekerRow.createdAt,
        guaranteeEndsAt: null,
      });
      expect(result.trades).toEqual([
        { trade: 'Housekeeping', yearsExperience: 3, isPrimary: true, listed: true },
        { trade: 'Laundry / ironing', yearsExperience: 2, isPrimary: false, listed: false },
      ]);
    });

    it('finds a job seeker by JS- code too', async () => {
      const prisma = seekerPrisma();
      await makeService(prisma).jobSeeker('JS-01042');
      expect(prisma.jobSeeker.findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: { code: 'JS-01042' } }));
    });

    it('404s for an unknown job seeker', async () => {
      const prisma = seekerPrisma();
      prisma.jobSeeker.findFirst.mockResolvedValue(null);
      await expect(makeService(prisma).jobSeeker('JS-09999')).rejects.toBeInstanceOf(NotFoundException);
    });

    it('shows "Paid — confirming" while the payer reported paying but the bank has not matched it', async () => {
      const prisma = seekerPrisma();
      prisma.payment.findFirst.mockResolvedValue({ status: 'pending', payerUtrHint: '123456789012', confirmedAt: null });
      const result = await makeService(prisma, {
        steps: {
          phone: { state: 'done', time: NOW, reason: null },
          consent: { state: 'done', time: NOW, reason: null },
          selfie: { state: 'done', time: NOW, reason: null },
          idCheck: { state: 'done', time: NOW, reason: null },
          payment: { state: 'in_progress', time: NOW, reason: null },
        },
        registrationLinkExpiresAt: new Date('2026-11-13T05:30:00.000Z'),
        paymentOnlyLink: { live: false, expiresAt: null },
      }).jobSeeker(seekerRow.id);
      expect(result.steps.payment.state).toBe('confirming');
      expect(result.stage).toBe('in_progress');
      expect(result.nextStep).toBe('payment');
    });

    it('reports who else was sent the payment link, with the relation', async () => {
      // PublicLink.phone holds AES-GCM ciphertext: the answer is the decrypted number
      // in the one stored format, which the interceptor then masks to its last 4 digits.
      const prisma = seekerPrisma();
      prisma.publicLink.findMany.mockResolvedValue([
        {
          phone: encryptCallRoutingPhone('9886041207'),
          metadata: { paymentId: 'p1', relation: 'brother' },
          usedAt: null,
          revokedAt: null,
          expiresAt: new Date(NOW.getTime() + 10 * 60_000),
          createdAt: new Date(NOW.getTime() - 5 * 60_000),
        },
      ]);
      const result = await makeService(prisma).jobSeeker(seekerRow.id);
      expect(result.paymentOnlyLink).toMatchObject({ payerPhone: '+919886041207', relation: 'brother', live: true, used: false });
    });

    it('reads an older payment link that holds the plain number in the same format', async () => {
      const prisma = seekerPrisma();
      prisma.publicLink.findMany.mockResolvedValue([
        {
          phone: '98860 41207',
          metadata: { paymentId: 'p1' },
          usedAt: null,
          revokedAt: null,
          expiresAt: new Date(NOW.getTime() + 10 * 60_000),
          createdAt: new Date(NOW.getTime() - 5 * 60_000),
        },
      ]);
      const result = await makeService(prisma).jobSeeker(seekerRow.id);
      expect(result.paymentOnlyLink).toMatchObject({ payerPhone: '+919886041207', relation: null });
    });

    it('shows an active job seeker with the 30-day end date once the bank confirmed the ₹499', async () => {
      const paidAt = new Date('2026-11-09T05:50:00.000Z');
      const prisma = seekerPrisma({ paymentReceivedAt: paidAt, status: 'active' });
      prisma.consent.findMany.mockResolvedValue(
        ['job_matching', 'profile_sharing', 'call_recording', 'aadhaar_verification', 'job_updates'].map((purpose) => ({ purpose })),
      );
      const done = { state: 'done', time: NOW, reason: null };
      const result = await makeService(prisma, {
        steps: { phone: done, consent: done, selfie: done, idCheck: done, payment: done },
        registrationLinkExpiresAt: null,
        paymentOnlyLink: { live: false, expiresAt: null },
      }).jobSeeker(seekerRow.id);
      expect(result.stage).toBe('active');
      expect(result.nextStep).toBe('complete');
      expect(result.consent).toEqual({ requiredGiven: 5, requiredTotal: 5, promotions: false });
      expect(result.guaranteeEndsAt).toEqual(new Date('2026-12-09T05:50:00.000Z'));
    });
  });

  describe('signed consent', () => {
    it('says not signed when no purpose was ever given', async () => {
      const prisma = { jobSeeker: { findFirst: jest.fn().mockResolvedValue(seekerRow) }, consent: { findMany: jest.fn().mockResolvedValue([]) } };
      await expect(makeService(prisma).signedConsent(seekerRow.id)).resolves.toMatchObject({ signed: false, code: 'JS-01042' });
    });

    it('lists every purpose given or not, with OTP time, language, notice version and the explaining call', async () => {
      const grantedAt = new Date('2026-11-09T05:12:00.000Z');
      const row = (purpose: string, granted: boolean) => ({
        purpose,
        granted,
        grantedAt: granted ? grantedAt : null,
        withdrawnAt: null,
        language: 'kn',
        noticeVersion: 'v3',
        method: 'sms_link',
        otpRequestId: 'otp-1',
        createdAt: grantedAt,
      });
      const prisma = {
        jobSeeker: { findFirst: jest.fn().mockResolvedValue(seekerRow) },
        consent: {
          findMany: jest.fn().mockResolvedValue([
            ...['job_matching', 'profile_sharing', 'call_recording', 'aadhaar_verification', 'job_updates'].map((p) => row(p, true)),
            row('promotions', false),
          ]),
        },
        otpSession: { findUnique: jest.fn().mockResolvedValue({ verified: true, usedAt: new Date('2026-11-09T05:11:00.000Z'), updatedAt: grantedAt }) },
        callRecord: {
          findFirst: jest.fn().mockResolvedValue({ startedAt: new Date('2026-11-09T04:59:00.000Z'), recordingStoragePath: 'rec/1', staff: { name: 'Deepa Nair' } }),
        },
      };
      const result = await makeService(prisma).signedConsent(seekerRow.id);
      expect(result.signed).toBe(true);
      if (!result.signed) throw new Error('expected signed');
      expect(result.purposes.map((p) => [p.purpose, p.given])).toEqual([
        ['job_matching', true],
        ['profile_sharing', true],
        ['call_recording', true],
        ['aadhaar_verification', true],
        ['job_updates', true],
        ['promotions', false],
      ]);
      expect(result).toMatchObject({
        language: 'kn',
        noticeVersion: 'v3',
        otpPhone: '9845012345',
        otpVerifiedAt: new Date('2026-11-09T05:11:00.000Z'),
        explainedOnCall: { staffName: 'Deepa Nair', recorded: true },
      });
    });
  });

  describe('already registered record', () => {
    const seeker = { id: 's1', code: 'JS-01042', name: 'Kavya Reddy', createdAt: NOW, registeredByStaffId: 'staff-1', registeredBy: { name: 'Deepa Nair' } };

    it('names the record, the date and who registered it', async () => {
      const prisma = { jobSeeker: { findUnique: jest.fn().mockResolvedValue(seeker) } };
      await expect(makeService(prisma).record('js-01042', { id: 'staff-2', role: 'call_agent' })).resolves.toEqual({
        type: 'job_seeker', id: 's1', code: 'JS-01042', name: 'Kavya Reddy', registeredAt: NOW, registeredBy: 'Deepa Nair',
      });
    });

    it('denies a Team Lead a record outside their team', async () => {
      const prisma = {
        jobSeeker: { findUnique: jest.fn().mockResolvedValue(seeker) },
        staff: { findFirst: jest.fn().mockResolvedValue(null) },
      };
      await expect(makeService(prisma).record('JS-01042', { id: 'tl-9', role: 'team_lead' })).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('lets a Team Lead open a record registered by their own team', async () => {
      const prisma = {
        jobSeeker: { findUnique: jest.fn().mockResolvedValue(seeker) },
        staff: { findFirst: jest.fn().mockResolvedValue({ id: 'staff-1' }) },
      };
      await expect(makeService(prisma).record('JS-01042', { id: 'tl-1', role: 'team_lead' })).resolves.toMatchObject({ code: 'JS-01042' });
    });

    it('opens a referral partner record and 404s an unknown ID prefix', async () => {
      const prisma = { referral: { findUnique: jest.fn().mockResolvedValue({ id: 'r1', code: 'RF-00043', name: 'Raju', createdAt: NOW }) } };
      await expect(makeService(prisma).record('RF-00043', { id: 'f1', role: 'finance' })).resolves.toMatchObject({ code: 'RF-00043' });
      await expect(makeService(prisma).record('XX-1', { id: 'f1', role: 'call_agent' })).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  it('finds a referral partner by RF- code or by mobile number', async () => {
    const findFirst = jest.fn().mockResolvedValue({ id: 'r1', code: 'RF-00042', name: 'Raju Kumar', phone: '9945670011' });
    const service = makeService({ referral: { findFirst } });
    await expect(service.findReferralPartner('rf-00042')).resolves.toMatchObject({ code: 'RF-00042' });
    expect(findFirst).toHaveBeenLastCalledWith(expect.objectContaining({ where: { code: 'RF-00042' } }));
    await service.findReferralPartner('99456 70011');
    expect(findFirst).toHaveBeenLastCalledWith(
      expect.objectContaining({ where: { phone: { in: expect.arrayContaining(['9945670011', '+919945670011']) } } }),
    );
    await expect(service.findReferralPartner('Raju')).resolves.toBeNull();
  });

  it.each(['9945670011', '+919945670011', '+91 99456 70011', '919945670011', '09945670011'])(
    'finds a referral partner saved as +919945670011 when the number is typed as %j',
    async (typed) => {
      const findFirst = jest.fn().mockResolvedValue(null);
      await makeService({ referral: { findFirst } }).findReferralPartner(typed);
      const where = findFirst.mock.calls[0][0].where as { phone: { in: string[] } };
      expect(where.phone.in[0]).toBe('+919945670011');
      expect(where.phone.in).toEqual(expect.arrayContaining(['+919945670011', '9945670011']));
    },
  );

  it('does not treat a short or malformed number as a referral partner search', async () => {
    const findFirst = jest.fn();
    const service = makeService({ referral: { findFirst } });
    await expect(service.findReferralPartner('12345678901')).resolves.toBeNull();
    await expect(service.findReferralPartner('0011')).resolves.toBeNull();
    expect(findFirst).not.toHaveBeenCalled();
  });

  it('searches businesses by a full number in any spelling, or by its last digits', async () => {
    const findMany = jest.fn().mockResolvedValue([]);
    const service = makeService({ business: { findMany } });
    for (const typed of ['9900054321', '+91 99000 54321', '09900054321']) {
      await service.searchBusinesses(typed);
      const or = findMany.mock.calls.at(-1)[0].where.OR as Array<Record<string, unknown>>;
      expect(or).toContainEqual({ phone: { in: expect.arrayContaining(['+919900054321']) } });
      expect(or.some((clause) => JSON.stringify(clause).includes('endsWith'))).toBe(false);
    }
    await service.searchBusinesses('4321');
    expect(findMany.mock.calls.at(-1)[0].where.OR).toContainEqual({ phone: { endsWith: '4321' } });
    await service.searchBusinesses('Sri Sai');
    expect(JSON.stringify(findMany.mock.calls.at(-1)[0].where.OR)).not.toContain('phone');
  });

  it('searches businesses by name and says whether candidates can be shown', async () => {
    const findMany = jest.fn().mockResolvedValue([
      { id: 'b1', code: 'BZ-00318', name: 'Sri Sai Hotel', locality: 'HSR Layout', verificationStatus: 'verified', inPersonOnboardedAt: null, pausedAt: null, additionalContactName: 'Shankar', contactRole: 'owner', branches: [] },
      { id: 'b2', code: 'BZ-00319', name: 'Sri Sai Bakery', locality: 'BTM', verificationStatus: 'lead', inPersonOnboardedAt: null, pausedAt: null, additionalContactName: 'Ravi', contactRole: 'manager', branches: [] },
    ]);
    const service = makeService({ business: { findMany } });
    expect(await service.searchBusinesses('s')).toEqual([]);
    const rows = await service.searchBusinesses('Sri Sai');
    expect(rows.map((r) => [r.code, r.canShowCandidates])).toEqual([['BZ-00318', true], ['BZ-00319', false]]);
  });

  it('limits a Team Lead\'s business search to their own team', async () => {
    const findMany = jest.fn().mockResolvedValue([]);
    const staffFindMany = jest.fn().mockResolvedValue([{ id: 'fa-1' }]);
    await makeService({ business: { findMany }, staff: { findMany: staffFindMany } }).searchBusinesses('Sri Sai', { id: 'tl-1', role: 'team_lead' });
    expect(findMany.mock.calls[0][0].where.AND).toEqual([
      { OR: [{ accountAgentId: { in: ['tl-1', 'fa-1'] } }, { leadCreatedByStaffId: { in: ['tl-1', 'fa-1'] } }] },
    ]);
  });

  it('builds the business status panel from the agreement link, visit assignment and approval', async () => {
    const prisma = {
      business: {
        findFirst: jest.fn().mockResolvedValue({
          id: 'b1', code: 'BZ-00318', name: 'Annapoorna Mess', additionalContactName: 'Shankar Rao', ownerName: null,
          contactRole: 'owner', contactLanguage: 'kn', phone: '9900054321', phoneVerified: true, createdAt: NOW,
          verificationStatus: 'lead', pausedAt: null, verifiedAt: null, inPersonOnboardedAt: null,
          agreements: [], visits: [],
          visitAssignments: [{ status: 'pending', createdAt: NOW, suggestedStaff: { name: 'Kiran Kumar' }, assignedStaff: null }],
          vacancies: [{ id: 'v1', code: 'VC-00001', tradeSkill: 'Cook', headcount: 2, salaryMinPaise: 1600000, salaryMaxPaise: 2000000, salaryPeriod: 'monthly', startDate: new Date('2026-11-16'), status: 'draft' }],
        }),
      },
      publicLink: { findFirst: jest.fn().mockResolvedValue({ createdAt: NOW, expiresAt: new Date(NOW.getTime() + 3600_000), usedAt: null, revokedAt: null }) },
    };
    const result = await makeService(prisma).business('BZ-00318');
    expect(result.steps.agreement.state).toBe('in_progress');
    expect(result.steps.visit).toMatchObject({ state: 'in_progress', suggestedStaffName: 'Kiran Kumar' });
    expect(result.steps.teamLeadApproval.state).toBe('not_started');
    expect(result.steps.verified.state).toBe('not_started');
    expect(result.draftVacancies).toEqual([expect.objectContaining({ code: 'VC-00001', trade: 'Cook', headcount: 2 })]);
  });

  it('returns the referral partner header with the live registration link', async () => {
    const prisma = {
      referral: { findFirst: jest.fn().mockResolvedValue({ id: 'r1', code: 'RF-00043', name: 'Raju Kumar', phone: '9945670011', phoneVerified: true, createdAt: NOW, type: 'individual', language: 'kn' }) },
      publicLink: { findFirst: jest.fn().mockResolvedValue({ createdAt: NOW, expiresAt: new Date(NOW.getTime() + 3600_000), usedAt: null, revokedAt: null }) },
    };
    const result = await makeService(prisma).referral('RF-00043');
    expect(result).toMatchObject({ code: 'RF-00043', phoneVerifiedAt: NOW, registrationLink: { live: true } });
  });
});
