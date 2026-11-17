import { PUBLIC_ROUTE_KEY } from '../../common/rbac/public.decorator';
import { REFERRAL_TERMS_PAGE_PATH, renderReferralTermsPageHtml } from '../consent/consent-page.template';
import { ReferralTermsController } from './referral-terms.controller';

describe('Public referral partner terms', () => {
  it('GET /referral-terms is public, with a reason', () => {
    const reason = Reflect.getMetadata(PUBLIC_ROUTE_KEY, ReferralTermsController.prototype.terms) as string | undefined;
    expect(reason).toEqual(expect.stringContaining('referral partner terms'));
  });

  it('gives the amounts from the current Settings, and follows a change', async () => {
    const pricing = {
      current: jest.fn().mockResolvedValue({ referralPayoutPaise: 20000, activationFeePaise: 49900, payoutDetailsCoolingHours: 48 }),
    };
    const controller = new ReferralTermsController(pricing as never);
    expect(await controller.terms()).toEqual({
      version: '1.0',
      referralPayoutPaise: 20000,
      activationFeePaise: 49900,
      payoutDetailsCoolingHours: 48,
    });
    pricing.current.mockResolvedValue({ referralPayoutPaise: 25000, activationFeePaise: 49900, payoutDetailsCoolingHours: 72 });
    expect(await controller.terms()).toMatchObject({ referralPayoutPaise: 25000, payoutDetailsCoolingHours: 72 });
  });

  it('the partner’s fallback signing page is English and signs with one button: send the code, typing it signs (rev 193)', () => {
    const html = renderReferralTermsPageHtml('tok', 'Raju', '******0011', '<article></article>');
    expect(html).toContain(`href="${REFERRAL_TERMS_PAGE_PATH}"`);
    expect(html).toContain('<html lang="en">');
    expect(html).toContain('Send code to sign');
    expect(html).not.toContain('btn-submit');
    expect(html).toContain("codeInput.value.trim().length === 6) void submitCode()");
    expect(html).toContain("language: 'en'");
    expect(html).not.toMatch(/\p{Script=Kannada}|\p{Script=Devanagari}/u);
    expect(REFERRAL_TERMS_PAGE_PATH).toBe('/p/referral-terms');
  });
});
