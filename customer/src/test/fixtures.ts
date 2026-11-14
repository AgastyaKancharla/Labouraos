import type { BusinessHome, CustomerAccount, FormOptions, JobSeekerHome, ProfileSummary, ReferralHome } from '@/api/types';

/** Made-up test data. No real people, numbers or businesses. */
export const formOptions: FormOptions = {
  areas: [
    { name: 'BTM Layout', pincode: '560076', latitude: 12.9166, longitude: 77.6101 },
    { name: 'JP Nagar', pincode: '560078', latitude: 12.9063, longitude: 77.5857 },
  ],
  trades: [
    { id: 't-cook', name: 'Cook', salaryMinPaise: 1_600_000, salaryMaxPaise: 2_600_000, legalMinimumPaise: 2_570_000 },
    { id: 't-helper', name: 'Kitchen helper', salaryMinPaise: 1_200_000, salaryMaxPaise: 1_700_000, legalMinimumPaise: 2_340_000 },
  ],
};

export const jsProfile: ProfileSummary = { id: 'p-js', kind: 'job_seeker', code: 'JS-1234', displayName: 'Ravi', stage: 'verifying' };
export const bizProfile: ProfileSummary = { id: 'p-biz', kind: 'business', code: 'BZ-0318', displayName: 'Test Tiffins', stage: 'verifying', businessRole: 'owner' };
export const refProfile: ProfileSummary = { id: 'p-ref', kind: 'referral_partner', code: 'RF-0042', displayName: 'Test Partner', stage: 'active' };

export const account = (over: Partial<CustomerAccount> = {}): CustomerAccount => ({
  id: 'acc-1',
  name: null,
  email: null,
  phoneVerified: true,
  phoneLast4: '4321',
  language: 'en',
  signInMethods: ['phone'],
  profiles: [],
  grievanceContact: null,
  ...over,
});

export const jsHome = (over: Partial<JobSeekerHome> = {}): JobSeekerHome => ({
  kind: 'job_seeker',
  code: 'JS-1234',
  firstName: 'Ravi',
  steps: { phone: 'done', profile: 'done', consent: 'not_started', selfie: 'not_started', idCheck: 'not_started', payment: 'not_started' },
  stuckReason: null,
  payment: { status: 'not_paid', amountPaise: 49_900 },
  guarantee: { status: 'not_started', day: null, totalDays: 30, endsOn: null, hits: 0, maxHits: 3 },
  interview: null,
  refund: null,
  ...over,
});

export const runningJsHome = (over: Partial<JobSeekerHome> = {}): JobSeekerHome =>
  jsHome({
    steps: { phone: 'done', profile: 'done', consent: 'done', selfie: 'done', idCheck: 'done', payment: 'done' },
    payment: { status: 'paid', amountPaise: 49_900 },
    guarantee: { status: 'running', day: 12, totalDays: 30, endsOn: '2026-12-02', hits: 1, maxHits: 3 },
    ...over,
  });

export const bizHome = (over: Partial<BusinessHome> = {}): BusinessHome => ({
  kind: 'business',
  code: 'BZ-0318',
  name: 'Test Tiffins',
  tracker: { phoneVerified: true, agreement: 'not_signed', visit: 'requested', visitAt: null, visitAgentFirstName: null, approval: 'waiting' },
  vacancies: [
    { id: 'v-1', code: null, trade: 'Cook', roleTitle: null, openings: 2, salaryMinPaise: 1_800_000, salaryMaxPaise: 2_200_000, salaryPeriod: 'monthly', status: 'draft', belowLegalMinimum: true },
    { id: 'v-2', code: 'VC-0007', trade: 'Kitchen helper', roleTitle: null, openings: 1, salaryMinPaise: 2_400_000, salaryMaxPaise: null, salaryPeriod: 'monthly', status: 'waiting_for_visit', belowLegalMinimum: false },
  ],
  counts: { interviewsUpcoming: 0, placements: 0 },
  ...over,
});

export const refHome = (over: Partial<ReferralHome> = {}): ReferralHome => ({
  kind: 'referral_partner',
  code: 'RF-0042',
  name: 'Test Partner',
  paused: false,
  pausedReason: null,
  steps: { terms: 'done', selfie: 'done', idCheck: 'done', upi: 'done' },
  stuckReason: null,
  shareLink: 'https://app.test/r/RF-0042',
  referrals: [
    { id: 'r-1', firstName: 'Suma', stage: 'joined', referredOn: '2026-11-01T05:00:00Z' },
    { id: 'r-2', firstName: 'Mohan', stage: 'registered', referredOn: '2026-11-10T05:00:00Z' },
  ],
  money: {
    rewardPaise: 20_000,
    duePaise: 20_000,
    approvedPaise: 0,
    paidPaise: 20_000,
    yearTotalPaise: 40_000,
    payouts: [
      { id: 'po-1', firstName: 'Suma', amountPaise: 20_000, status: 'paid', paidOn: '2026-11-12T06:00:00Z', upiRef: 'UPI-TEST-1' },
      { id: 'po-2', firstName: 'Anil', amountPaise: 20_000, status: 'due', paidOn: null, upiRef: null },
    ],
  },
  documents: [
    { id: 'doc-terms', kind: 'terms', signedAt: '2026-11-01T05:00:00Z' },
    { id: 'doc-consent', kind: 'consent', signedAt: '2026-11-01T05:00:00Z' },
  ],
  ...over,
});
