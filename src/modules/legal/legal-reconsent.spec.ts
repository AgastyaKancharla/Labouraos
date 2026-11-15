import { BadRequestException } from '@nestjs/common';
import { LegalDocumentService } from './legal-document.service';
import { ConsentLinkService } from '../consent/consent-link.service';
import { renderSignedAgreementDocument } from '../consent/business-agreement.template';
import { renderLegalDocument } from './legal-documents';
import { legalCompanyFrom, legalNumbersFrom } from './legal-document.service';

const POLICY = {
  activationFeePaise: 49_900, jobSeekerGuaranteeDays: 30, offerReplyHours: 48, maxHits: 3, joiningRewardPaise: 20_000, joiningRewardAfterDays: 30,
  registrationLinkValidHours: 48, paymentOnlyLinkMinutes: 15, placementFeePercent: 50, gstPercent: 18, placementPaymentDueHours: 24,
  interviewResultEscalateHours: 24, replacementWindowDays: 60, maxFreeReplacements: 2, maxReplacementRejections: 2, replacementSearchDays: 15,
  claimReportDays: 7, claimDecisionHours: 48, noBypassMonths: 12, noBypassPenaltyPercent: 50, referralPayoutPaise: 20_000, payoutDetailsCoolingHours: 48,
  companyLegalName: 'Laboura Private Limited', companyGstin: null, companyAddress: null, companyCin: null,
  grievanceOfficerName: null, grievanceOfficerPhone: null, grievanceOfficerEmail: null,
};

function legalWith(rows: {
  acceptance?: { version: string; language: string; acceptedAt: Date; noticeVersion: string | null } | null;
  agreement?: { version: string; signedAt: Date } | null;
  consents?: string[];
}) {
  const prisma = {
    legalAcceptance: { findFirst: jest.fn().mockResolvedValue(rows.acceptance ?? null), create: jest.fn(async ({ data }) => ({ id: 'acc-1', ...data })) },
    legalDocumentText: { upsert: jest.fn().mockResolvedValue({}) },
    businessAgreement: { findFirst: jest.fn().mockResolvedValue(rows.agreement ?? null) },
    consent: { findMany: jest.fn().mockResolvedValue((rows.consents ?? []).map((purpose) => ({ purpose }))) },
  };
  const pricing = { current: jest.fn().mockResolvedValue(POLICY) };
  return { service: new LegalDocumentService(prisma as never, pricing as never), prisma };
}

const REQUIRED = ['job_matching', 'profile_sharing', 'call_recording', 'aadhaar_verification', 'job_updates'];

describe('Re-consent (rev 176): who must accept the current version', () => {
  it('a job seeker who gave the five consents under 1.1 (no new acceptance yet) is asked once; consents stay valid meanwhile', async () => {
    const { service } = legalWith({ consents: REQUIRED });
    const status = await service.status('job_seeker', 'js-1');
    expect(status).toMatchObject({ documentKey: 'job_seeker_terms', currentVersion: '1.1', acceptedVersion: null, needsReconsent: true, currentNoticeVersion: '1.2' });
  });

  it('someone still at the consent step is not asked to re-consent (the normal first step shows the current text)', async () => {
    const { service } = legalWith({ consents: ['job_matching'] });
    expect((await service.status('job_seeker', 'js-1')).needsReconsent).toBe(false);
  });

  it('accepted the current terms and notice: nothing to do; an older notice version: asked again', async () => {
    const at = new Date('2026-11-15T10:00:00Z');
    expect((await legalWith({ acceptance: { version: '1.1', language: 'kn', acceptedAt: at, noticeVersion: '1.2' } }).service.status('job_seeker', 'js-1')).needsReconsent).toBe(false);
    expect((await legalWith({ acceptance: { version: '1.1', language: 'kn', acceptedAt: at, noticeVersion: '1.1' } }).service.status('job_seeker', 'js-1')).needsReconsent).toBe(true);
    expect((await legalWith({ acceptance: { version: '1.0', language: 'en', acceptedAt: at, noticeVersion: '1.2' } }).service.status('job_seeker', 'js-1')).needsReconsent).toBe(true);
  });

  it('a business that signed agreement 1.0 must sign 1.1; one that signed 1.1 is up to date; one that never signed is not asked', async () => {
    const signedAt = new Date('2026-11-01T10:00:00Z');
    expect(await legalWith({ agreement: { version: '1.0', signedAt } }).service.status('business', 'bz-1')).toMatchObject({ acceptedVersion: '1.0', needsReconsent: true });
    expect(await legalWith({ agreement: { version: '1.1', signedAt } }).service.status('business', 'bz-1')).toMatchObject({ acceptedVersion: '1.1', needsReconsent: false });
    expect((await legalWith({}).service.status('business', 'bz-1')).needsReconsent).toBe(false);
  });

  it('a partner who signed the old short terms (no ID-check consent) accepts the full v1.0 once', async () => {
    expect((await legalWith({ consents: ['agreement_terms', 'call_recording'] }).service.status('referral', 'rf-1')).needsReconsent).toBe(true);
    const at = new Date();
    expect((await legalWith({ acceptance: { version: '1.0', language: 'hi', acceptedAt: at, noticeVersion: null } }).service.status('referral', 'rf-1')).needsReconsent).toBe(false);
  });

  it('records an acceptance with version, language, OTP and the exact text (stored once per hash)', async () => {
    const { service, prisma } = legalWith({});
    const rendered = await service.render('job_seeker_terms', 'hi');
    await service.recordAcceptance({ subjectType: 'job_seeker', subjectId: 'js-1', rendered, context: 'reconsent', method: 'sms_link', otpRequestId: 'otp-9', noticeVersion: '1.2', purposes: REQUIRED, acceptedAt: new Date('2026-11-15T10:00:00Z') });
    expect(prisma.legalDocumentText.upsert).toHaveBeenCalledWith(expect.objectContaining({ where: { hash: rendered.hash }, create: expect.objectContaining({ html: rendered.html, version: '1.1', language: 'hi' }) }));
    expect(prisma.legalAcceptance.create).toHaveBeenCalledWith({ data: expect.objectContaining({ version: '1.1', language: 'hi', textHash: rendered.hash, otpRequestId: 'otp-9', noticeVersion: '1.2', context: 'reconsent' }) });
  });
});

describe('Re-consent on the link (ConsentLinkService.recordReconsent)', () => {
  function linkService(status: { needsReconsent: boolean; acceptedVersion: string | null }) {
    const grants: unknown[] = [];
    const recorded: unknown[] = [];
    const prisma = { $transaction: jest.fn(async (cb: (tx: unknown) => unknown) => cb({})) };
    const consent = { grant: jest.fn(async (dto: unknown) => grants.push(dto)) };
    const legal = {
      status: jest.fn().mockResolvedValue({ ...status, noticeVersion: '1.1' }),
      render: jest.fn(async (key: 'job_seeker_terms' | 'referral_terms', lang: 'kn' | 'hi' | 'en') =>
        renderLegalDocument(key, lang, legalNumbersFrom(POLICY as never), legalCompanyFrom(POLICY as never))),
      recordAcceptance: jest.fn(async (input: unknown) => recorded.push(input)),
    };
    const audit = { log: jest.fn() };
    const service = new ConsentLinkService(
      prisma as never, {} as never, { now: () => new Date('2026-11-15T10:00:00Z') } as never, consent as never, {} as never, {} as never,
      {} as never, audit as never, {} as never, {} as never, {} as never, legal as never,
    );
    return { service, grants, recorded, audit };
  }

  it('needs every required tick, then grants them under notice 1.2 and records the acceptance', async () => {
    const { service, grants, recorded, audit } = linkService({ needsReconsent: true, acceptedVersion: null });
    await expect(service.recordReconsent('job_seeker', 'js-1', { purposes: ['job_matching'], language: 'kn', method: 'sms_link', otpRequestId: 'otp-1' })).rejects.toThrow(BadRequestException);
    const res = await service.recordReconsent('job_seeker', 'js-1', { purposes: [...REQUIRED, 'promotions'], language: 'kn', method: 'sms_link', otpRequestId: 'otp-1' });
    expect(res.version).toBe('1.1');
    expect(grants).toHaveLength(6);
    expect(grants[0]).toMatchObject({ subjectType: 'job_seeker', noticeVersion: '1.2', language: 'kn', otpRequestId: 'otp-1' });
    expect(recorded[0]).toMatchObject({ context: 'reconsent', noticeVersion: '1.2', otpRequestId: 'otp-1', rendered: expect.objectContaining({ language: 'kn', version: '1.1' }) });
    expect(audit.log).toHaveBeenCalledWith(expect.objectContaining({ action: 'legal.reconsent_accepted' }));
  });

  it('a partner accepts the terms, recording and the separate ID-check consent', async () => {
    const { service, grants } = linkService({ needsReconsent: true, acceptedVersion: null });
    await expect(service.recordReconsent('referral', 'rf-1', { purposes: ['agreement_terms', 'call_recording'], language: 'en', method: 'in_app', otpRequestId: null })).rejects.toThrow('Tick every required permission');
    await service.recordReconsent('referral', 'rf-1', { purposes: ['agreement_terms', 'call_recording', 'aadhaar_verification'], language: 'en', method: 'in_app', otpRequestId: null });
    expect(grants.map((g) => (g as { purpose: string }).purpose)).toEqual(['agreement_terms', 'call_recording', 'aadhaar_verification']);
  });
});

describe('The business agreement signed copy (S1)', () => {
  it('contains the FULL v1.1 text the owner saw, unchanged, and the filled acceptance record', () => {
    const terms = renderLegalDocument('business_agreement', 'en', legalNumbersFrom(POLICY as never), legalCompanyFrom(POLICY as never));
    const signed = renderSignedAgreementDocument(terms.html, {
      businessName: 'Annapoorna Mess', businessCode: 'BZ-00001', signedName: 'Shankar Rao', signedRole: 'owner', maskedPhone: '******4321',
      otpRequestId: 'otp-1', signedAtIst: '15 Nov 2026, 15:30 IST', version: '1.1', language: 'en',
      ticks: ['agreement_terms', 'agreement_authority', 'call_recording'], onboardedBy: 'FA-0007', billingEmail: null,
    });
    expect(signed).toContain(terms.html);
    for (const clause of ['9. No bypass', '10. The 60-day replacement guarantee', '11. Claim reasons', '15. Your business&#39;s data', '17. Changes, notices and law', 'Signing by OTP']) {
      expect(signed).toContain(clause);
    }
    expect(signed).toContain('Acceptance record (filled in by the system)');
    expect(signed).toContain('otp-1');
    expect(signed).toContain('******4321');
    expect(signed).not.toContain('9876');
  });
});
