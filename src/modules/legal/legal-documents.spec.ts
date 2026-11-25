import { readFileSync, existsSync, readdirSync } from 'fs';
import { join } from 'path';
import { CONSENT_NOTICES } from '../consent/consent-notices';
import { DEFAULT_NOTICE_VERSION, JOB_SEEKER_CONSENT_PURPOSES, JOB_SEEKER_REQUIRED_CONSENT_PURPOSES, REQUIRED_CONSENT_PURPOSES_BY_SUBJECT } from '../consent/consent.constants';
import { BUSINESS_AGREEMENT_VERSION } from '../consent/business-agreement.template';
import { REFERRAL_TERMS_VERSION } from '../consent/referral-terms.template';
import { consentTicks, legalCompanyFrom } from './legal-document.service';
import {
  grievanceContact,
  LEGAL_DOCUMENT_KEYS,
  LEGAL_DOCUMENT_VERSIONS,
  LegalCompanyDetails,
  legalDocumentSource,
  LegalNumbers,
  renderLegalDocument,
} from './legal-documents';
import { LEGAL_LANGUAGES } from './legal-document.types';
import { renderMarkdown } from './legal-markdown';

/** The Settings values of the test setup (seed): the numbers the owner's texts quote. */
const NUMBERS: LegalNumbers = {
  activationFeePaise: 49_900,
  jobSeekerGuaranteeDays: 30,
  offerReplyHours: 48,
  maxHits: 3,
  joiningRewardPaise: 20_000,
  joiningRewardAfterDays: 30,
  registrationLinkValidHours: 48,
  paymentOnlyLinkMinutes: 15,
  placementFeePercent: 50,
  gstPercent: 18,
  placementPaymentDueHours: 24,
  interviewResultEscalateHours: 24,
  replacementWindowDays: 60,
  maxFreeReplacements: 2,
  maxReplacementRejections: 2,
  replacementSearchDays: 15,
  claimReportDays: 7,
  claimDecisionHours: 48,
  noBypassMonths: 12,
  noBypassPenaltyPercent: 50,
  referralPayoutPaise: 20_000,
  payoutDetailsCoolingHours: 48,
};
const EMPTY_COMPANY: LegalCompanyDetails = legalCompanyFrom({ companyLegalName: 'Laboura Private Limited', companyGstin: null, companyAddress: null });

const text = (html: string) => html.replace(/<[^>]+>/g, '').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&');

describe('Legal documents (Master Guide rev 176; job seeker terms v1.2 and business agreement v1.2, rev 211)', () => {
  it('has the approved versions: job seeker terms 1.2 (rev 211), business agreement 1.2 (rev 211), referral partner terms 1.0, consent notice 1.3 (rev 211)', () => {
    expect(LEGAL_DOCUMENT_VERSIONS).toEqual({ job_seeker_terms: '1.2', business_agreement: '1.2', referral_terms: '1.0' });
    expect(BUSINESS_AGREEMENT_VERSION).toBe('1.2');
    expect(REFERRAL_TERMS_VERSION).toBe('1.0');
    expect(DEFAULT_NOTICE_VERSION).toBe('1.3');
  });

  it.each(LEGAL_DOCUMENT_KEYS.flatMap((key) => LEGAL_LANGUAGES.map((lang) => [key, lang] as const)))('%s in %s renders with every placeholder filled', (key, lang) => {
    const doc = renderLegalDocument(key, lang, NUMBERS, EMPTY_COMPANY);
    expect(doc.html).not.toMatch(/\{\{/);
    expect(doc.summary.length).toBeGreaterThanOrEqual(7);
    expect(doc.bodyHtml.length).toBeGreaterThan(5000);
    expect(doc.html).toContain(`data-template-version="${LEGAL_DOCUMENT_VERSIONS[key]}"`);
    expect(doc.hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it('English only (rev 193): every document exists in English and in no other language', () => {
    expect(LEGAL_LANGUAGES).toEqual(['en']);
    for (const key of LEGAL_DOCUMENT_KEYS) {
      const doc = renderLegalDocument(key, 'en', NUMBERS, EMPTY_COMPANY);
      expect(doc.html).toContain('lang="en"');
      expect(doc.html).not.toMatch(/\p{Script=Kannada}|\p{Script=Devanagari}/u);
    }
    const contentDir = join(__dirname, 'content');
    expect(readdirSync(contentDir).filter((f) => !f.endsWith('.en.ts'))).toEqual([]);
  });

  it('the English is the owner-approved text: every clause of the documents is there, numbers from Settings', () => {
    const src = '/home/claude/status/legal';
    const js = text(renderLegalDocument('job_seeker_terms', 'en', NUMBERS, EMPTY_COMPANY).html);
    // v1.2 (rev 211): the 30 days start when he is paid AND his ID is verified.
    expect(js).toContain('within 30 days of your registration being complete — your ₹499 in Laboura\'s bank and your ID verified');
    expect(js).toContain('Your 30 days start only after your government ID is verified. Until then your registration is paused.');
    expect(js).toContain('5.4 Your 30 days start when both of these are done: your ₹499 is confirmed in Laboura\'s bank, and your ID is verified');
    // The link's steps in the new order: the terms and payment before the ID check.
    expect(js.indexOf('Terms and payment: you see your exact guarantee terms')).toBeGreaterThan(-1);
    expect(js.indexOf('Terms and payment: you see your exact guarantee terms')).toBeLessThan(js.indexOf('ID check: Aadhaar Secure QR'));
    expect(js).toContain('9.5 Refund before your ID is verified.');
    expect(js).toContain('contact Laboura and ask for the full ₹499 back');
    expect(js).toContain('There is no refund if your ID was forged or altered');
    expect(js).toContain('A forged or altered ID also means no refund of the ₹499 before your ID check passed');
    expect(js).toContain('3 hits switch off (deactivate) your profile.');
    expect(js).toContain('You have 48 hours to reply.');
    expect(js).toContain('Laboura pays you ₹200');
    expect(js).toContain('A screenshot is not proof of payment.');
    expect(js).toContain('Permanent ban.');
    expect(js).toContain('Data Protection Board of India');
    const bz = text(renderLegalDocument('business_agreement', 'en', NUMBERS, EMPTY_COMPANY).html);
    expect(bz).toContain('fee ₹5,000 + GST ₹900 = ₹5,900');
    expect(bz).toContain('3 × ₹5,900 = ₹17,700');
    expect(bz).toContain('fee ₹7,500 + 50% ₹3,750 = ₹11,250 + GST');
    expect(bz).toContain('you pay ₹1,000 + GST');
    expect(bz).toContain('medically_unfit_or_relocated');
    expect(bz).toContain('This does not count toward your 2 free replacements.');
    const rf = text(renderLegalDocument('referral_terms', 'en', NUMBERS, EMPTY_COMPANY).html);
    expect(rf).toContain('You earn ₹200 when a job seeker you referred joins a job through Laboura.');
    expect(rf).toContain('48-hour wait');
    // When the owner's source files are on this machine, every numbered clause is in the software.
    for (const [file, key] of [['jobseeker-terms-v1.1.md', 'job_seeker_terms'], ['business-agreement-v1.1.md', 'business_agreement'], ['referral-partner-terms-v1.0.md', 'referral_terms']] as const) {
      if (!existsSync(`${src}/${file}`)) continue;
      const clauses = [...readFileSync(`${src}/${file}`, 'utf8').matchAll(/^(\d+\.\d+) /gm)].map((m) => m[1]);
      const body = legalDocumentSource(key, 'en').body;
      for (const clause of clauses) expect(body).toMatch(new RegExp(`^${clause.replace('.', '\\.')} `, 'm'));
    }
  });

  it('a change in Settings changes the text (no number written in the code)', () => {
    const doc = text(renderLegalDocument('job_seeker_terms', 'en', { ...NUMBERS, activationFeePaise: 59_900, jobSeekerGuaranteeDays: 45 }, EMPTY_COMPANY).html);
    expect(doc).toContain('within 45 days of your registration being complete — your ₹599');
    expect(doc).not.toContain('₹499');
    const bz = text(renderLegalDocument('business_agreement', 'en', { ...NUMBERS, placementFeePercent: 40 }, EMPTY_COMPANY).html);
    expect(bz).toContain('fee ₹4,000 + GST ₹720 = ₹4,720');
  });

  it('company placeholders read "to be added after registration" until the CEO fills them, then show the Grievance Officer', () => {
    const empty = text(renderLegalDocument('job_seeker_terms', 'en', NUMBERS, EMPTY_COMPANY).html);
    expect(empty).toContain('to be added after registration');
    expect(grievanceContact(EMPTY_COMPANY)).toBe('to be added after registration');
    const filled: LegalCompanyDetails = {
      ...EMPTY_COMPANY,
      cin: 'U78100KA2026PTC000001',
      registeredOffice: 'Bengaluru',
      gstin: '29ABCDE1234F1Z5',
      grievanceOfficerName: 'Grievance Officer',
      grievanceOfficerPhone: '+91 80 0000 0000',
      grievanceOfficerEmail: 'grievance@example.com',
    };
    const doc = text(renderLegalDocument('referral_terms', 'en', NUMBERS, filled).html);
    expect(doc).toContain('U78100KA2026PTC000001');
    expect(doc).toContain('Grievance Officer, +91 80 0000 0000, grievance@example.com');
    expect(doc).not.toContain('to be added after registration');
  });

  it('a registered office typed on several lines (or with a "|") stays one safe cell of the header table', () => {
    const doc = renderLegalDocument('job_seeker_terms', 'en', NUMBERS, { ...EMPTY_COMPANY, registeredOffice: '12, 3rd Cross\nJP Nagar | Bengaluru\r\n560078 <b>' });
    expect(doc.html).toContain('12, 3rd Cross, JP Nagar / Bengaluru, 560078 &lt;b&gt;');
    expect(doc.html).not.toContain('<b>');
  });

  it('the hash is of the exact text shown: same input same hash, any change a new hash', () => {
    const a = renderLegalDocument('business_agreement', 'en', NUMBERS, EMPTY_COMPANY);
    expect(renderLegalDocument('business_agreement', 'en', NUMBERS, EMPTY_COMPANY).hash).toBe(a.hash);
    expect(renderLegalDocument('business_agreement', 'en', NUMBERS, { ...EMPTY_COMPANY, cin: 'U78100KA2026PTC000001' }).hash).not.toBe(a.hash);
    expect(renderLegalDocument('business_agreement', 'en', { ...NUMBERS, noBypassMonths: 6 }, EMPTY_COMPANY).hash).not.toBe(a.hash);
  });

  it('the markdown renderer escapes HTML and renders tables, lists and bold', () => {
    const html = renderMarkdown('| a | b |\n| --- | --- |\n| **x** | <script> |\n\n- one\n- two\n\n1. first\n\nPara `code` *em*');
    expect(html).toContain('<table><thead><tr><th>a</th><th>b</th></tr></thead><tbody><tr><td><strong>x</strong></td><td>&lt;script&gt;</td></tr></tbody></table>');
    expect(html).toContain('<ul><li>one</li><li>two</li></ul>');
    expect(html).toContain('<ol><li>first</li></ol>');
    expect(html).toContain('<p>Para <code>code</code> <em>em</em></p>');
  });
});

describe('Consent ticks (Job Seeker Terms Part B, notice 1.2)', () => {
  it('six itemised ticks mapped to the consent purposes: five required, promotions optional', () => {
    const ticks = consentTicks('job_seeker_terms', 'en');
    expect(ticks.map((t) => t.purpose)).toEqual([...JOB_SEEKER_CONSENT_PURPOSES]);
    expect(ticks.filter((t) => t.required).map((t) => t.purpose)).toEqual([...JOB_SEEKER_REQUIRED_CONSENT_PURPOSES]);
    expect(ticks.find((t) => t.purpose === 'promotions')?.required).toBe(false);
  });

  it('the notice texts are word for word the document\'s Part B, in English only', () => {
    const en = text(renderLegalDocument('job_seeker_terms', 'en', NUMBERS, EMPTY_COMPANY).bodyHtml);
    for (const purpose of JOB_SEEKER_CONSENT_PURPOSES) {
      expect(en).toContain(CONSENT_NOTICES[purpose].en.description);
      expect(Object.keys(CONSENT_NOTICES[purpose])).toEqual(['en']);
      expect(CONSENT_NOTICES[purpose].en.withdrawal.length).toBeGreaterThan(10);
    }
    expect(CONSENT_NOTICES.promotions.en.description).toBe('I consent to receiving promotional offers and news from Laboura.');
  });

  it('partners give a separate ID-check consent (S2); businesses tick terms, authority and recording', () => {
    expect(REQUIRED_CONSENT_PURPOSES_BY_SUBJECT.referral).toEqual(['agreement_terms', 'call_recording', 'aadhaar_verification']);
    expect(consentTicks('referral_terms', 'en').map((t) => t.purpose)).toEqual(['agreement_terms', 'call_recording', 'aadhaar_verification']);
    expect(consentTicks('business_agreement', 'en').map((t) => t.purpose)).toEqual(['agreement_terms', 'agreement_authority', 'call_recording']);
  });
});
