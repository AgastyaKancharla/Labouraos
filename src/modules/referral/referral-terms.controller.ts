import { Controller, Get } from '@nestjs/common';
import { Public } from '../../common/rbac/public.decorator';
import { PricingService } from '../pricing/pricing.service';
import { REFERRAL_TERMS_VERSION } from '../consent/referral-terms.template';

/**
 * The public referral partner terms page (web: /app/p/referral-terms) reads
 * its amounts here, from the current Settings (PricingPolicy), so the page
 * never states a figure the software does not pay. No personal data.
 */
@Controller('referral-terms')
export class ReferralTermsController {
  constructor(private readonly pricing: PricingService) {}

  @Get()
  @Public('public referral partner terms: the published rules and amounts from Settings, no personal data')
  async terms() {
    const policy = await this.pricing.current();
    return {
      version: REFERRAL_TERMS_VERSION,
      referralPayoutPaise: policy.referralPayoutPaise,
      activationFeePaise: policy.activationFeePaise,
      payoutDetailsCoolingHours: policy.payoutDetailsCoolingHours,
    };
  }
}
