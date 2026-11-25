import { Linking } from 'react-native';
import { fireEvent, screen, waitFor, within } from '@testing-library/react-native';
import * as Clipboard from 'expo-clipboard';
import { router } from 'expo-router';
import type { ProfileHome } from '@/api/types';
import { openSecureSheet } from '@/sheet/openSheet';
import { account, bizHome, bizProfile, jsHome, jsProfile, refHome, refProfile, runningJsHome } from '@/test/fixtures';
import { fakeApi, renderWithApp } from '@/test/render';
import Home from './index';

jest.mock('expo-router', () => require('@/test/expo-router-mock'));
jest.mock('@/sheet/openSheet', () => ({ openSecureSheet: jest.fn(async () => 'returned') }));

beforeEach(() => jest.clearAllMocks());

async function renderHome(home: ProfileHome, profiles = [jsProfile], activeProfileId = profiles[0].id) {
  const api = fakeApi({ home: async () => home, sheetLink: async () => ({ url: 'https://app.test/p/x' }) });
  const utils = await renderWithApp(<Home />, { api, account: account({ profiles }), activeProfileId });
  return { ...utils, api };
}

/** Everything the screen shows, as one string (to prove what is NOT there). */
function allText(): string {
  const texts: string[] = [];
  const walk = (node: unknown) => {
    if (typeof node === 'string') texts.push(node);
    else if (Array.isArray(node)) node.forEach(walk);
    else if (node && typeof node === 'object' && 'children' in node) walk((node as { children: unknown }).children);
  };
  walk(screen.toJSON());
  return texts.join(' ');
}

describe('Job seeker Home', () => {
  it('registration not finished: shows each step and Continue opens the steps in the app', async () => {
    const { api } = await renderHome(jsHome({ stuckReason: 'UPI failed twice' }));
    const steps = await screen.findByTestId('js-home-steps');
    expect(within(steps).getByTestId('js-step-profile-done')).toBeTruthy();
    expect(within(steps).getByTestId('js-step-consent-not_started')).toBeTruthy();
    expect(within(steps).getByText('Terms and ₹499 payment')).toBeTruthy();
    expect(screen.getByTestId('js-home-stuck')).toHaveTextContent('UPI failed twice');
    await fireEvent.press(screen.getByTestId('js-home-continue'));
    expect(router.push).toHaveBeenCalledWith('/verify/registration?profileId=p-js');
    expect(api.sheetLink).not.toHaveBeenCalled();
    expect(openSecureSheet).not.toHaveBeenCalled();
  });

  it('colourful Home: blue hero card with name and next step; each step its own colour, done ticks, next step highlighted', async () => {
    await renderHome(jsHome());
    const hero = await screen.findByTestId('js-home-hero');
    expect(hero).toHaveTextContent(/Job seeker · JS-1234/);
    expect(within(hero).getByTestId('js-home-hero-next')).toHaveTextContent(/Finish your registration/);
    const tile = (key: string, accent: string) => screen.getByTestId(`js-step-${key}-tile-${accent}`, { includeHiddenElements: true });
    expect(tile('phone', 'royal')).toBeTruthy();
    expect(tile('profile', 'navy')).toBeTruthy();
    expect(tile('consent', 'cyan')).toBeTruthy();
    expect(tile('selfie', 'gold')).toBeTruthy();
    expect(tile('idCheck', 'orange')).toBeTruthy();
    expect(tile('payment', 'good')).toBeTruthy();
    expect(screen.getByTestId('js-step-profile-tick')).toBeTruthy();
    expect(screen.queryByTestId('js-step-consent-tick')).toBeNull();
  });

  it('paid but not matched with the bank yet: "Paid — confirming"', async () => {
    await renderHome(
      jsHome({
        steps: { phone: 'done', profile: 'done', consent: 'done', selfie: 'done', idCheck: 'done', payment: 'in_progress' },
        payment: { status: 'confirming', amountPaise: 49_900 },
      }),
    );
    expect(await screen.findByTestId('js-home-confirming')).toHaveTextContent(/Paid — confirming/);
    expect(screen.queryByTestId('js-home-running')).toBeNull();
    expect(screen.queryByTestId('js-home-steps')).toBeNull();
  });

  it('guarantee running: day X of 30 and hits so far', async () => {
    await renderHome(runningJsHome());
    expect(await screen.findByTestId('js-home-running')).toHaveTextContent(/Day 12 of 30/);
    expect(screen.getByTestId('js-home-hits')).toHaveTextContent(/1 of 3 hits/);
  });

  it('no interview booked: no business name anywhere (no-bypass)', async () => {
    await renderHome(runningJsHome());
    await screen.findByTestId('js-home-running');
    expect(screen.queryByTestId('js-home-interview')).toBeNull();
    expect(allText()).not.toMatch(/Test Tiffins|Annapoorna/);
  });

  it('interview booked: business name, address, time and directions', async () => {
    const openURL = jest.spyOn(Linking, 'openURL').mockResolvedValue(undefined);
    await renderHome(
      runningJsHome({
        interview: {
          status: 'booked',
          startsAt: '2026-11-16T05:30:00Z',
          trade: 'Cook',
          businessName: 'Test Tiffins',
          address: '1st Main, JP Nagar',
          latitude: 12.9,
          longitude: 77.58,
          replyDueAt: '2026-11-15T05:30:00Z',
        },
      }),
    );
    const card = await screen.findByTestId('js-home-interview');
    expect(within(card).getByTestId('js-home-interview-business')).toHaveTextContent('Test Tiffins');
    expect(within(card).getByText('Mon 16 Nov, 11:00 AM')).toBeTruthy();
    await fireEvent.press(within(card).getByTestId('js-home-directions'));
    expect(openURL).toHaveBeenCalledWith('https://www.google.com/maps/dir/?api=1&destination=12.9%2C77.58');
  });

  it('refund paid: shows the UPI reference', async () => {
    await renderHome(runningJsHome({ guarantee: { status: 'ended', day: null, totalDays: 30, endsOn: null, hits: 0, maxHits: 3 }, refund: { status: 'paid', dueOn: '2026-12-14', amountPaise: 49_900, upiRef: 'UPI-TEST-9' } }));
    expect(await screen.findByTestId('js-home-refund-paid')).toHaveTextContent(/Refund of ₹499 paid. UPI reference UPI-TEST-9./);
  });

  it('after 3 hits: paused, with "Pay ₹499 to start again"', async () => {
    await renderHome(runningJsHome({ guarantee: { status: 'deactivated', day: null, totalDays: 30, endsOn: null, hits: 3, maxHits: 3 } }));
    await fireEvent.press(await screen.findByTestId('js-home-pay-again'));
    expect(router.push).toHaveBeenCalledWith('/verify/registration?profileId=p-js');
  });
});

describe('Business Home', () => {
  it('tracker, agreement button, "candidates after the visit", vacancies with states', async () => {
    await renderHome(bizHome(), [bizProfile]);
    expect(await screen.findByTestId('biz-step-phone-done')).toBeTruthy();
    expect(screen.getByTestId('biz-step-agreement-not_started')).toBeTruthy();
    expect(screen.getByTestId('biz-step-visit-in_progress')).toBeTruthy();
    expect(screen.getByTestId('biz-home-visit-requested')).toHaveTextContent(/will call you to book a visit/);
    expect(screen.getByTestId('biz-home-after-visit')).toBeTruthy();
    expect(screen.getByTestId('biz-home-vacancy-v-1')).toHaveTextContent(/Cook × 2/);
    expect(screen.getByTestId('biz-home-vacancy-v-1')).toHaveTextContent(/below legal minimum/);
    expect(screen.getByTestId('biz-home-vacancy-v-2')).toHaveTextContent(/Waiting for visit/);
    await fireEvent.press(screen.getByTestId('biz-home-confirm-v-1'));
    expect(router.push).toHaveBeenCalledWith('/vacancy/new?vacancyId=v-1');
    expect(screen.queryByTestId('biz-home-confirm-v-2')).toBeNull();
    await fireEvent.press(screen.getByTestId('biz-home-sign'));
    expect(router.push).toHaveBeenCalledWith('/verify/business_agreement?profileId=p-biz');
  });

  it('visit booked with the agent first name; verified hides the waiting banner; never a phone number', async () => {
    await renderHome(
      bizHome({ tracker: { phoneVerified: true, agreement: 'signed', visit: 'done', visitAt: '2026-11-16T05:30:00Z', visitAgentFirstName: 'Kiran', approval: 'approved' }, counts: { interviewsUpcoming: 2, placements: 1, workersPlaced: 1 } }),
      [bizProfile],
    );
    expect(await screen.findByTestId('biz-step-verified-done')).toBeTruthy();
    expect(screen.queryByTestId('biz-home-after-visit')).toBeNull();
    expect(screen.queryByTestId('biz-home-sign')).toBeNull();
    expect(allText()).not.toMatch(/\d{10}/);
    expect(screen.getByTestId('biz-stat-interviews')).toHaveTextContent(/2.*Interviews coming up/);
    expect(screen.getByTestId('biz-stat-placements')).toHaveTextContent(/1.*People hired/);
    expect(screen.getByTestId('biz-hero-agreement-green')).toBeTruthy();
    expect(screen.getByTestId('biz-hero-approval-green')).toBeTruthy();
    // A worker placed, but the report is switched off on the server: no card.
    expect(screen.queryByTestId('biz-home-workers')).toBeNull();
  });

  it('"Report a worker left" shows when a worker is placed and the server switched it on (contract 8.2)', async () => {
    const api = fakeApi({
      home: async () => bizHome({ counts: { interviewsUpcoming: 0, placements: 1, workersPlaced: 1 } }),
      config: async () => ({ googleSignIn: true, googleWebClientId: null, googleIosClientId: null, appleSignIn: false, otpTestMode: false, workerLeftReports: true }),
    });
    await renderWithApp(<Home />, { api, account: account({ profiles: [bizProfile] }), activeProfileId: 'p-biz' });
    expect(await screen.findByTestId('biz-home-workers')).toHaveTextContent(/Did a worker leave\?/);
  });

  it('no worker placed yet: no "Report a worker left"', async () => {
    await renderHome(bizHome(), [bizProfile]);
    expect(await screen.findByTestId('biz-home-hero')).toBeTruthy();
    expect(screen.queryByTestId('biz-home-workers')).toBeNull();
  });

  it('hero chips colour agreement / visit / approval; stat tiles royal / cyan / green', async () => {
    await renderHome(bizHome(), [bizProfile]);
    expect(await screen.findByTestId('biz-home-hero')).toHaveTextContent(/Business/);
    expect(screen.getByTestId('biz-hero-agreement-amber')).toHaveTextContent('Sign the agreement');
    expect(screen.getByTestId('biz-hero-agreement-amber').props.accessibilityLabel).toBe('Agreement signed: Not started');
    expect(screen.getByTestId('biz-hero-visit-amber')).toHaveTextContent('Verification visit: In progress');
    expect(screen.getByTestId('biz-hero-approval-neutral')).toHaveTextContent('Laboura approval: Not started');
    expect(screen.getByTestId('biz-stat-vacancies')).toHaveTextContent(/2.*Vacancies/);
    expect(screen.getByTestId('biz-stat-vacancies-bar-royal')).toBeTruthy();
    expect(screen.getByTestId('biz-stat-interviews-bar-cyan')).toBeTruthy();
    expect(screen.getByTestId('biz-stat-placements-bar-good')).toBeTruthy();
  });

  it('26 Nov: interview cards — who and when, "Give the result" once due, the result once sent; never a surname or phone', async () => {
    const candidate = { firstName: 'Ravi', age: 24, trade: 'Cook', yearsExperience: 3, languages: ['Kannada', 'Hindi'], photoUrl: null };
    const base = { vacancyCode: 'V-1', trade: 'Cook', endsAt: '2026-11-26T07:30:00Z', result: null, resultReason: null, candidate };
    await renderHome(
      bizHome({
        interviews: [
          { ...base, id: 'iv-1', startsAt: '2026-11-26T06:30:00Z', resultOpensAt: '2026-11-26T07:30:00Z', state: 'result_due' },
          { ...base, id: 'iv-2', startsAt: '2026-11-27T05:30:00Z', resultOpensAt: '2026-11-27T06:30:00Z', state: 'upcoming', candidate: { ...candidate, firstName: 'Manjunath' } },
          { ...base, id: 'iv-3', startsAt: '2026-11-28T05:30:00Z', resultOpensAt: '2026-11-28T06:30:00Z', state: 'waiting_for_candidate', candidate: { ...candidate, firstName: 'Suresh' } },
          { ...base, id: 'iv-4', startsAt: '2026-11-25T05:30:00Z', resultOpensAt: '2026-11-25T06:30:00Z', state: 'result_sent', result: 'not_selected', resultReason: 'experience', candidate: { ...candidate, firstName: 'Anil' } },
        ],
      }),
      [bizProfile],
    );
    const cards = await screen.findByTestId('biz-interviews');
    expect(cards).toHaveTextContent(/Ravi shortlisted/);
    expect(cards).toHaveTextContent(/24 yrs · Cook · 3 yrs experience/);
    expect(cards).toHaveTextContent(/Speaks Kannada, Hindi/);
    expect(screen.getByTestId('biz-interview-iv-1-when')).toHaveTextContent('Cook interview · Thu 26 Nov, 12:00 PM');
    expect(screen.getByTestId('biz-interview-upcoming')).toHaveTextContent(/You can give the result from 12:00 PM/);
    expect(screen.getByTestId('biz-interview-waiting_for_candidate')).toHaveTextContent(/Waiting for Suresh to confirm/);
    expect(screen.getByTestId('biz-interview-result_sent')).toHaveTextContent(/Not selected \(Experience\)/);
    expect(allText()).not.toMatch(/\d{10}/);
    await fireEvent.press(screen.getByTestId('biz-interview-iv-1-result'));
    expect(router.push).toHaveBeenCalledWith('/interview-result?profileId=p-biz&interviewId=iv-1');
    expect(screen.queryByTestId('biz-interview-iv-2-result')).toBeNull();
  });

  it('rev 211: a shop with no visit is verified once the agreement is signed and approved', async () => {
    await renderHome(bizHome({ tracker: { phoneVerified: true, agreement: 'signed', visit: 'not_booked', visitAt: null, visitAgentFirstName: null, approval: 'approved' } }), [bizProfile]);
    expect(await screen.findByTestId('biz-step-verified-done')).toBeTruthy();
    expect(screen.queryByTestId('biz-step-visit-not_started')).toBeNull();
  });

  it('booked visit says who comes and when', async () => {
    await renderHome(bizHome({ tracker: { phoneVerified: true, agreement: 'signed', visit: 'booked', visitAt: '2026-11-16T05:30:00Z', visitAgentFirstName: 'Kiran', approval: 'waiting' } }), [bizProfile]);
    expect(await screen.findByTestId('biz-home-visit-booked')).toHaveTextContent('Kiran from Laboura visits on Mon 16 Nov, 11:00 AM.');
  });
});

describe('Referral partner Home', () => {
  it('share link, QR, WhatsApp text and copy', async () => {
    const openURL = jest.spyOn(Linking, 'openURL').mockResolvedValue(undefined);
    await renderHome(refHome(), [refProfile]);
    expect(await screen.findByTestId('ref-home-link')).toHaveTextContent('https://app.test/r/RF-0042');
    expect(screen.getByTestId('qr-code').props.accessibilityLabel).toBe('https://app.test/r/RF-0042');
    await fireEvent.press(screen.getByTestId('ref-home-whatsapp'));
    expect(openURL).toHaveBeenCalledWith(`https://wa.me/?text=${encodeURIComponent('Looking for a job in Bengaluru? Register with Laboura: https://app.test/r/RF-0042')}`);
    await fireEvent.press(screen.getByTestId('ref-home-copy'));
    expect(Clipboard.setStringAsync).toHaveBeenCalledWith('https://app.test/r/RF-0042');
    expect(await screen.findByText('Link copied')).toBeTruthy();
  });

  it('people referred by first name and stage only; money due / approved / paid; signed papers', async () => {
    const { api } = await renderHome(refHome(), [refProfile]);
    expect(await screen.findByTestId('ref-home-person-r-1')).toHaveTextContent(/Suma.*Joined/);
    expect(screen.getByTestId('ref-home-person-r-2')).toHaveTextContent(/Mohan.*Registered/);
    expect(allText()).not.toMatch(/\d{10}/);
    expect(screen.getByTestId('ref-home-due')).toHaveTextContent(/₹200/);
    expect(screen.getByTestId('ref-home-paid')).toHaveTextContent(/₹200/);
    expect(screen.getByTestId('ref-home-referred-count')).toHaveTextContent(/2.*People you referred/);
    expect(screen.getByTestId('ref-home-referred-count-bar-cyan')).toBeTruthy();
    expect(screen.getByTestId('ref-home-due-bar-gold')).toBeTruthy();
    expect(screen.getByTestId('ref-home-paid-bar-good')).toBeTruthy();
    expect(screen.getByTestId('ref-home-share-accent-gold')).toBeTruthy();
    expect(screen.getByTestId('ref-home-payout-po-1')).toHaveTextContent(/UPI ref UPI-TEST-1/);
    await fireEvent.press(screen.getByTestId('ref-home-doc-consent'));
    await waitFor(() => expect(api.sheetLink).toHaveBeenCalledWith('p-ref', 'document', 'doc-consent'));
  });

  it('"Send a lead" shows only when the server switched it on (contract 7.3b)', async () => {
    await renderHome(refHome(), [refProfile]);
    expect(await screen.findByTestId('ref-home-link')).toBeTruthy();
    expect(screen.queryByTestId('ref-home-lead')).toBeNull();
    const api = fakeApi({
      home: async () => refHome(),
      config: async () => ({ googleSignIn: true, googleWebClientId: null, googleIosClientId: null, appleSignIn: false, otpTestMode: false, referralLeads: true }),
    });
    screen.unmount();
    await renderWithApp(<Home />, { api, account: account({ profiles: [refProfile] }), activeProfileId: 'p-ref' });
    expect(await screen.findByTestId('ref-home-lead')).toHaveTextContent(/Know someone\?/);
  });

  it('paused: says so, and hides the share link', async () => {
    await renderHome(refHome({ paused: true, pausedReason: null }), [refProfile]);
    expect(await screen.findByTestId('ref-home-paused')).toHaveTextContent(/Money you already earned is still paid/);
    expect(screen.queryByTestId('ref-home-share')).toBeNull();
  });

  it('unfinished: steps and Continue', async () => {
    await renderHome(refHome({ steps: { terms: 'done', selfie: 'not_started', idCheck: 'not_started', upi: 'not_started' }, shareLink: null }), [refProfile]);
    expect(await screen.findByTestId('ref-step-upi-not_started')).toBeTruthy();
    expect(screen.getByTestId('ref-home-continue')).toBeTruthy();
  });
});

describe('Home and profiles', () => {
  it('shows the remembered profile and links to My profiles', async () => {
    await renderHome(refHome(), [jsProfile, refProfile], 'p-ref');
    expect(await screen.findByTestId('ref-home')).toBeTruthy();
    expect(screen.getByTestId('home-switch-profile')).toHaveTextContent('My profiles (2) ▸');
    await fireEvent.press(screen.getByTestId('home-switch-profile'));
    expect(router.push).toHaveBeenCalledWith('/profiles');
  });
});
