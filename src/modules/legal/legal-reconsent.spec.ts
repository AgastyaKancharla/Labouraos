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
/** The hash of the text a page would show (the server requires it). */
const shownHash = (key: 'job_seeker_terms' | 'referral_terms', lang: 'en') =>
  renderLegalDocument(key, lang, legalNumbersFrom(POLICY as never), legalCompanyFrom(POLICY as never)).hash;

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

  it('H1: registration (ticks under notice 1.2) then the guarantee terms at payment: not asked to re-consent', async () => {
    const rows = [
      { context: 'registration', version: '1.1', language: 'kn', acceptedAt: new Date('2026-11-15T10:00:00Z'), noticeVersion: '1.2' },
      // The guarantee terms at payment carry no ticks: no notice version.
      { context: 'payment_terms', version: '1.1', language: 'kn', acceptedAt: new Date('2026-11-15T10:05:00Z'), noticeVersion: null },
    ];
    const { service, prisma } = legalWith({ consents: REQUIRED });
    prisma.legalAcceptance.findFirst.mockImplementation(async ({ where }: { where: { context?: { not: string } } }) =>
      rows.filter((r) => r.context !== where.context?.not).sort((x, y) => y.acceptedAt.getTime() - x.acceptedAt.getTime())[0] ?? null);
    const status = await service.status('job_seeker', 'js-1');
    expect(status).toMatchObject({ acceptedVersion: '1.1', noticeVersion: '1.2', needsReconsent: false });
    expect(prisma.legalAcceptance.findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ context: { not: 'payment_terms' } }) }));
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
    const rendered = await service.render('job_seeker_terms', 'en');
    await service.recordAcceptance({ subjectType: 'job_seeker', subjectId: 'js-1', rendered, context: 'reconsent', method: 'sms_link', otpRequestId: 'otp-9', noticeVersion: '1.2', purposes: REQUIRED, acceptedAt: new Date('2026-11-15T10:00:00Z') });
    expect(prisma.legalDocumentText.upsert).toHaveBeenCalledWith(expect.objectContaining({ where: { hash: rendered.hash }, create: expect.objectContaining({ html: rendered.html, version: '1.1', language: 'en' }) }));
    expect(prisma.legalAcceptance.create).toHaveBeenCalledWith({ data: expect.objectContaining({ version: '1.1', language: 'en', textHash: rendered.hash, otpRequestId: 'otp-9', noticeVersion: '1.2', context: 'reconsent' }) });
  });
});

describe('Re-consent on the link (ConsentLinkService.recordReconsent)', () => {
  function linkService(status: { needsReconsent: boolean; acceptedVersion: string | null }) {
    const grants: unknown[] = [];
    const recorded: unknown[] = [];
    const tx = { consent: { updateMany: jest.fn().mockResolvedValue({ count: 1 }) } };
    const prisma = { $transaction: jest.fn(async (cb: (tx: unknown) => unknown) => cb(tx)) };
    const consent = { grant: jest.fn(async (dto: unknown) => grants.push(dto)) };
    const legal = {
      status: jest.fn().mockResolvedValue({ ...status, currentVersion: '1.1', noticeVersion: '1.1' }),
      render: jest.fn(async (key: 'job_seeker_terms' | 'referral_terms', lang: 'en') =>
        renderLegalDocument(key, lang, legalNumbersFrom(POLICY as never), legalCompanyFrom(POLICY as never))),
      recordAcceptance: jest.fn(async (input: unknown) => recorded.push(input)),
    };
    const audit = { log: jest.fn() };
    const service = new ConsentLinkService(
      prisma as never, {} as never, { now: () => new Date('2026-11-15T10:00:00Z') } as never, consent as never, {} as never, {} as never,
      {} as never, audit as never, {} as never, {} as never, {} as never, legal as never,
    );
    return { service, grants, recorded, audit, tx, legal };
  }

  it('needs every required tick, then grants them under notice 1.2 and records the acceptance', async () => {
    const { service, grants, recorded, audit } = linkService({ needsReconsent: true, acceptedVersion: null });
    await expect(service.recordReconsent('job_seeker', 'js-1', { purposes: ['job_matching'], language: 'en', method: 'sms_link', otpRequestId: 'otp-1', textHash: shownHash('job_seeker_terms', 'en') })).rejects.toThrow(BadRequestException);
    const res = await service.recordReconsent('job_seeker', 'js-1', { purposes: [...REQUIRED, 'promotions'], language: 'en', method: 'sms_link', otpRequestId: 'otp-1', textHash: shownHash('job_seeker_terms', 'en') });
    expect(res.version).toBe('1.1');
    expect(grants).toHaveLength(6);
    expect(grants[0]).toMatchObject({ subjectType: 'job_seeker', noticeVersion: '1.2', language: 'en', otpRequestId: 'otp-1' });
    expect(recorded[0]).toMatchObject({ context: 'reconsent', noticeVersion: '1.2', otpRequestId: 'otp-1', rendered: expect.objectContaining({ language: 'en', version: '1.1' }) });
    expect(audit.log).toHaveBeenCalledWith(expect.objectContaining({ action: 'legal.reconsent_accepted' }));
  });

  it('never grants the consents from nothing: someone who skipped the first consent step is refused; a second tap is a no-op', async () => {
    const fresh = linkService({ needsReconsent: false, acceptedVersion: null });
    await expect(fresh.service.recordReconsent('job_seeker', 'js-1', { purposes: REQUIRED, language: 'en', method: 'sms_link', otpRequestId: 'otp-1', textHash: shownHash('job_seeker_terms', 'en') })).rejects.toThrow('first step');
    expect(fresh.grants).toHaveLength(0);
    const done = linkService({ needsReconsent: false, acceptedVersion: '1.1' });
    expect(await done.service.recordReconsent('job_seeker', 'js-1', { purposes: REQUIRED, language: 'en', method: 'sms_link', otpRequestId: 'otp-1', textHash: shownHash('job_seeker_terms', 'en') })).toMatchObject({ success: true, alreadyAccepted: true });
    expect(done.grants).toHaveLength(0);
  });

  it('refuses when the text shown is not the text the server would record (hash mismatch)', async () => {
    const { service, grants } = linkService({ needsReconsent: true, acceptedVersion: '1.0' });
    await expect(service.recordReconsent('job_seeker', 'js-1', { purposes: REQUIRED, language: 'en', method: 'sms_link', otpRequestId: 'otp-1', textHash: 'f'.repeat(64) })).rejects.toThrow('changed while you were reading');
    expect(grants).toHaveLength(0);
    const shown = renderLegalDocument('job_seeker_terms', 'en', legalNumbersFrom(POLICY as never), legalCompanyFrom(POLICY as never));
    await service.recordReconsent('job_seeker', 'js-1', { purposes: REQUIRED, language: 'en', method: 'sms_link', otpRequestId: 'otp-1', textHash: shown.hash });
    expect(grants).toHaveLength(5);
  });

  it('promotions left unticked on the new version withdraws the earlier promotions consent; ticked keeps it', async () => {
    const without = linkService({ needsReconsent: true, acceptedVersion: '1.0' });
    await without.service.recordReconsent('job_seeker', 'js-1', { purposes: REQUIRED, language: 'en', method: 'in_app', otpRequestId: null, textHash: shownHash('job_seeker_terms', 'en') });
    expect(without.tx.consent.updateMany).toHaveBeenCalledWith({
      where: { subjectType: 'job_seeker', subjectId: 'js-1', purpose: 'promotions', granted: true, withdrawnAt: null },
      data: expect.objectContaining({ granted: false, withdrawnMethod: 'in_app' }),
    });
    const withPromos = linkService({ needsReconsent: true, acceptedVersion: '1.0' });
    await withPromos.service.recordReconsent('job_seeker', 'js-1', { purposes: [...REQUIRED, 'promotions'], language: 'en', method: 'in_app', otpRequestId: null, textHash: shownHash('job_seeker_terms', 'en') });
    expect(withPromos.tx.consent.updateMany).not.toHaveBeenCalled();
  });

  it('a partner accepts the terms, recording and the separate ID-check consent', async () => {
    const { service, grants } = linkService({ needsReconsent: true, acceptedVersion: null });
    await expect(service.recordReconsent('referral', 'rf-1', { purposes: ['agreement_terms', 'call_recording'], language: 'en', method: 'in_app', otpRequestId: null, textHash: shownHash('referral_terms', 'en') })).rejects.toThrow('Tick every required permission');
    await service.recordReconsent('referral', 'rf-1', { purposes: ['agreement_terms', 'call_recording', 'aadhaar_verification'], language: 'en', method: 'in_app', otpRequestId: null, textHash: shownHash('referral_terms', 'en') });
    expect(grants.map((g) => (g as { purpose: string }).purpose)).toEqual(['agreement_terms', 'call_recording', 'aadhaar_verification']);
  });
});

describe('The job seeker consent step (P01) checks the code and the text', () => {
  const now = new Date('2026-11-15T10:00:00Z');
  function consentStep(otpOwnPhone: boolean) {
    const row = { purpose: 'registration', subjectType: 'job_seeker', subjectId: 'js-1', phone: '+919876512345', expiresAt: new Date(now.getTime() + 3600_000), usedAt: null, revokedAt: null, createdAt: now, metadata: {} };
    const prisma = { jobSeeker: { findUnique: jest.fn().mockResolvedValue({ id: 'js-1', phone: '+919876512345', status: 'lead' }) } };
    const publicLinks = { findByToken: jest.fn().mockResolvedValue(row), hashToken: (t: string) => `hash-${t}`, markUsed: jest.fn() };
    const consent = { hasAllRequired: jest.fn().mockResolvedValue(false), grant: jest.fn() };
    const otp = { verifyOtp: jest.fn().mockResolvedValue(true), isVerifiedForPage: jest.fn().mockResolvedValue(otpOwnPhone) };
    const legal = { render: jest.fn(async (key: 'job_seeker_terms', lang: 'en') => renderLegalDocument(key, lang, legalNumbersFrom(POLICY as never), legalCompanyFrom(POLICY as never))) };
    const service = new ConsentLinkService(
      prisma as never, publicLinks as never, { now: () => now } as never, consent as never, {} as never, otp as never,
      {} as never, {} as never, {} as never, {} as never, {} as never, legal as never,
    );
    return { service, consent, otp };
  }

  it('a typed code must have been sent to his own phone', async () => {
    const { service, consent, otp } = consentStep(false);
    await expect(service.submitConsent({ token: 't', otpRequestId: 'otp-other', otpCode: '123456', purposes: ['job_matching'], language: 'en' })).rejects.toThrow('Invalid or expired OTP');
    // AC-3: a code sent from this link's own page to his own phone.
    expect(otp.isVerifiedForPage).toHaveBeenCalledWith('otp-other', '+919876512345', 't');
    expect(consent.grant).not.toHaveBeenCalled();
  });

  it('refuses when the terms text he saw is not the text the server would record', async () => {
    const { service, consent } = consentStep(true);
    await expect(service.submitConsent({ token: 't', otpRequestId: 'otp-1', otpCode: '123456', purposes: ['job_matching'], language: 'en', textHash: '0'.repeat(64) })).rejects.toThrow('changed while you were reading');
    expect(consent.grant).not.toHaveBeenCalled();
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
