import { cleanup, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { mockApi, renderScreen, signInAs } from '../../../test/utils';
import RegisterBusiness from '../CA13-BusinessLead';
import { businessScript, jobSeekerConsentScript, referralScript, type ScriptTerms } from './scripts';

/**
 * The read-aloud scripts quote ₹499, the placement-fee percentage, GST and
 * the other guarantee numbers from Settings (PricingPolicy), never fixed text.
 */
const GUIDE: ScriptTerms = {
  activationFeePaise: 49900,
  referralPayoutPaise: 20000,
  placementFeePercent: 50,
  gstPercent: 18,
  jobSeekerGuaranteeDays: 30,
  replacementWindowDays: 60,
  maxFreeReplacements: 2,
  noBypassMonths: 12,
  noBypassPenaltyPercent: 50,
};
const CHANGED: ScriptTerms = {
  activationFeePaise: 59900,
  referralPayoutPaise: 25000,
  placementFeePercent: 40,
  gstPercent: 12,
  jobSeekerGuaranteeDays: 45,
  replacementWindowDays: 90,
  maxFreeReplacements: 3,
  noBypassMonths: 18,
  noBypassPenaltyPercent: 25,
};

describe('call scripts read their figures from Settings', () => {
  it('job seeker consent script: the fee and the guarantee days, in all three languages', () => {
    expect(jobSeekerConsentScript(GUIDE).en).toContain('pay ₹499. If we don’t offer you a suitable job within 30 days, you get your ₹499 back.');
    const changed = jobSeekerConsentScript(CHANGED);
    for (const text of Object.values(changed)) {
      expect(text).toContain('₹599');
      expect(text).toContain('45');
      expect(text).not.toContain('₹499');
    }
  });

  it('business script: placement fee %, GST %, replacement window and no-bypass terms', () => {
    expect(businessScript(GUIDE).en).toContain('50% of their first month’s salary plus 18% GST');
    const changed = businessScript(CHANGED);
    expect(changed.en).toContain('40% of their first month’s salary plus 12% GST. If they leave within 90 days, we replace them free, up to 3 times.');
    expect(changed.en).toContain('within 18 months, the full fee plus 25% applies');
    for (const text of Object.values(changed)) {
      expect(text).toContain('40%');
      expect(text).toContain('12% GST');
      expect(text).not.toMatch(/50%|18%/);
    }
  });

  it('referral script: the reward amount', () => {
    expect(referralScript(GUIDE).en).toContain('you get ₹200 by UPI');
    for (const text of Object.values(referralScript(CHANGED))) {
      expect(text).toContain('₹250');
      expect(text).not.toContain('₹200');
    }
  });

  it('a Manager gets no rupee figures, so the amounts are named in words', () => {
    const blind = { ...GUIDE, activationFeePaise: undefined, referralPayoutPaise: undefined };
    for (const text of [...Object.values(jobSeekerConsentScript(blind)), ...Object.values(referralScript(blind))]) {
      expect(text).not.toContain('₹');
    }
    expect(jobSeekerConsentScript(blind).en).toContain('pay the registration fee');
  });

  it('the CA13 screen reads out what Settings says, and follows a change', async () => {
    const user = userEvent.setup();
    const render = async (terms: ScriptTerms) => {
      mockApi({
        'GET /trades': [],
        'GET /screens/call-registration/options': { city: 'Bengaluru', areas: [], scriptTerms: terms },
      });
      signInAs('call_agent');
      renderScreen(<RegisterBusiness />, { portal: 'call-agent', path: '/call-agent/register/business' });
      await user.click((await screen.findAllByRole('button', { name: 'English' }))[0]);
    };

    await render(GUIDE);
    expect(await screen.findByText(/50% of their first month’s salary plus 18% GST/)).toBeInTheDocument();
    cleanup();

    await render(CHANGED);
    expect(await screen.findByText(/40% of their first month’s salary plus 12% GST/)).toBeInTheDocument();
    expect(screen.queryByText(/50% of their first month’s salary/)).not.toBeInTheDocument();
  });
});
