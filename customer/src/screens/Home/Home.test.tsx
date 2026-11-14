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
  it('registration not finished: shows each step and Continue opens the secure sheet', async () => {
    const { api } = await renderHome(jsHome({ stuckReason: 'UPI failed twice' }));
    const steps = await screen.findByTestId('js-home-steps');
    expect(within(steps).getByTestId('js-step-profile-done')).toBeTruthy();
    expect(within(steps).getByTestId('js-step-consent-not_started')).toBeTruthy();
    expect(within(steps).getByText('Terms and ₹499 payment')).toBeTruthy();
    expect(screen.getByTestId('js-home-stuck')).toHaveTextContent('UPI failed twice');
    await fireEvent.press(screen.getByTestId('js-home-continue'));
    await waitFor(() => expect(api.sheetLink).toHaveBeenCalledWith('p-js', 'registration', undefined));
    expect(openSecureSheet).toHaveBeenCalledWith('https://app.test/p/x');
    await waitFor(() => expect(api.home).toHaveBeenCalledTimes(2)); // refreshed after the sheet
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
    const { api } = await renderHome(runningJsHome({ guarantee: { status: 'deactivated', day: null, totalDays: 30, endsOn: null, hits: 3, maxHits: 3 } }));
    await fireEvent.press(await screen.findByTestId('js-home-pay-again'));
    await waitFor(() => expect(api.sheetLink).toHaveBeenCalledWith('p-js', 'payment', undefined));
  });
});

describe('Business Home', () => {
  it('tracker, agreement button, "candidates after the visit", vacancies with states', async () => {
    const { api } = await renderHome(bizHome(), [bizProfile]);
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
    await waitFor(() => expect(api.sheetLink).toHaveBeenCalledWith('p-biz', 'agreement', undefined));
  });

  it('visit booked with the agent first name; verified hides the waiting banner; never a phone number', async () => {
    await renderHome(
      bizHome({ tracker: { phoneVerified: true, agreement: 'signed', visit: 'done', visitAt: '2026-11-16T05:30:00Z', visitAgentFirstName: 'Kiran', approval: 'approved' }, counts: { interviewsUpcoming: 2, placements: 1 } }),
      [bizProfile],
    );
    expect(await screen.findByTestId('biz-step-verified-done')).toBeTruthy();
    expect(screen.queryByTestId('biz-home-after-visit')).toBeNull();
    expect(screen.queryByTestId('biz-home-sign')).toBeNull();
    expect(allText()).not.toMatch(/\d{10}/);
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
    expect(screen.getByTestId('ref-home-payout-po-1')).toHaveTextContent(/UPI ref UPI-TEST-1/);
    await fireEvent.press(screen.getByTestId('ref-home-doc-consent'));
    await waitFor(() => expect(api.sheetLink).toHaveBeenCalledWith('p-ref', 'document', 'doc-consent'));
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
