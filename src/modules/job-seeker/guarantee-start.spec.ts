import { PrismaService } from '../../common/prisma/prisma.service';
import { GUARANTEE_START_NOTICE } from '../consent/consent-notices';
import { DEFAULT_NOTICE_VERSION } from '../consent/consent.constants';
import { LegalDocumentService } from '../legal/legal-document.service';
import { LEGAL_DOCUMENT_VERSIONS } from '../legal/legal-documents';
import { WHATSAPP_TEMPLATES, WhatsAppTemplateDef } from '../message/whatsapp-templates';
import { seededPricingService } from '../../test-support/seeded-pricing';
import { guaranteeStartFor, idPassedAt, statusAfterPayment } from './guarantee-start';
import { FLOW_TEMPLATES } from './job-seeker-flow.service';
import { PAID_WAITING_ID, PAID_WAITING_ID_LABEL, JOB_SEEKER_STATUSES } from './job-seeker.status';

/** Master Guide rev 211: the 30 days start at the later of the payment and the ID pass. */
describe('guarantee start (rev 211)', () => {
  const t = (iso: string) => new Date(iso);

  function db(rows: { stop?: boolean; passed?: { verifiedAt: Date | null; createdAt: Date } | null }) {
    return {
      identityVerification: {
        findFirst: jest.fn(async (args: { where: { isAdult?: boolean } }) => {
          if (args.where.isAdult === false) return rows.stop ? { id: 'stop' } : null;
          return rows.passed ?? null;
        }),
      },
    } as never;
  }

  it('is the later of the two moments', () => {
    expect(guaranteeStartFor(t('2026-11-20T10:00:00Z'), t('2026-11-22T08:00:00Z'))).toEqual(t('2026-11-22T08:00:00Z'));
    expect(guaranteeStartFor(t('2026-11-22T10:00:00Z'), t('2026-11-01T08:00:00Z'))).toEqual(t('2026-11-22T10:00:00Z'));
    expect(guaranteeStartFor(t('2026-11-22T10:00:00Z'), t('2026-11-22T10:00:00Z'))).toEqual(t('2026-11-22T10:00:00Z'));
  });

  it('a payment without a passed ID leaves him "Paid, waiting for ID" with no start', async () => {
    await expect(statusAfterPayment(db({ passed: null }), 'js', t('2026-11-25T05:00:00Z'))).resolves.toEqual({ status: PAID_WAITING_ID, guaranteeStartsAt: null });
    expect(JOB_SEEKER_STATUSES).toContain('paid_waiting_id');
    expect(PAID_WAITING_ID_LABEL).toBe('Paid, waiting for ID');
  });

  it('a payment after the ID passed starts the 30 days at the payment', async () => {
    const paidAt = t('2026-11-25T05:00:00Z');
    await expect(statusAfterPayment(db({ passed: { verifiedAt: t('2026-11-20T05:00:00Z'), createdAt: t('2026-11-20T04:00:00Z') } }), 'js', paidAt)).resolves.toEqual({ status: 'active', guaranteeStartsAt: paidAt });
  });

  it('a standing under-18 stop means no passed ID, whatever else is on file', async () => {
    await expect(idPassedAt(db({ stop: true, passed: { verifiedAt: t('2026-11-20T05:00:00Z'), createdAt: t('2026-11-20T05:00:00Z') } }), 'js')).resolves.toBeNull();
    await expect(idPassedAt(db({ passed: { verifiedAt: null, createdAt: t('2026-11-19T05:00:00Z') } }), 'js')).resolves.toEqual(t('2026-11-19T05:00:00Z'));
  });
});

describe('rev 211 WhatsApp templates (Builder A section)', () => {
  const all = WHATSAPP_TEMPLATES as Record<string, WhatsAppTemplateDef>;
  const names = Object.values(FLOW_TEMPLATES);

  it.each(names)('%s exists, is not agent-pickable, and neither starts nor ends with a variable', (name) => {
    const def = all[name];
    expect(def).toBeDefined();
    expect(def.name).toBe(name);
    expect(def.agentPickable).toBeFalsy();
    expect(def.text.trim()).not.toMatch(/^\{\{/);
    expect(def.text.trim()).not.toMatch(/\}\}[.!?]?$/);
    const used = [...def.text.matchAll(/\{\{(\w+)\}\}/g)].map((m) => m[1]).sort();
    expect([...new Set(used)].sort()).toEqual([...def.variables].sort());
    // Numbers come from Settings, never a literal "30".
    expect(def.text).not.toMatch(/\b30\b|499/);
  });

  it('sit together at the end of the list', () => {
    const keys = Object.keys(all);
    expect(keys.slice(-names.length).sort()).toEqual([...names].sort());
  });
});

describe('consent notice 1.3 and job seeker terms 1.2 (rev 211)', () => {
  it('the notice line is word for word and comes with the job seeker terms only', async () => {
    expect(GUARANTEE_START_NOTICE).toBe('Your 30 days start only after your government ID is verified. Until then your registration is paused.');
    expect(DEFAULT_NOTICE_VERSION).toBe('1.3');
    expect(LEGAL_DOCUMENT_VERSIONS.job_seeker_terms).toBe('1.2');
    const legal = new LegalDocumentService({} as PrismaService, seededPricingService());
    const terms = await legal.publicDocument('job_seeker_terms', 'en');
    expect(terms).toMatchObject({ version: '1.2', noticeVersion: '1.3', consentNotice: GUARANTEE_START_NOTICE });
    const partner = await legal.publicDocument('referral_terms', 'en');
    expect(partner.consentNotice).toBeNull();
  });

  it('the terms say when the 30 days start, the refund before a verified ID, and no refund for a forged ID', async () => {
    const legal = new LegalDocumentService({} as PrismaService, seededPricingService());
    const terms = await legal.publicDocument('job_seeker_terms', 'en');
    const text = terms.bodyHtml.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
    expect(text).toMatch(/30 days start only after your government ID is verified/);
    expect(text).toMatch(/forged or altered/i);
    expect(text).toMatch(/Refund before your ID is verified/);
    expect(text).toMatch(/refund goes back to that person/);
    expect(text).not.toMatch(/\{\{/);
  });
});
