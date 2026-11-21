import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { mockApi, renderScreen, signInAs } from '../../../test/utils';
import JobSeekersList from '../JobSeekers';
import JobSeekerDetail from '../C-JobSeeker';
import BusinessDetail from '../C-Business';
import BusinessesList from '../C-Businesses';
import { BusinessNumbers, CloseToRefund } from '../../team-lead/_kit/business';

/**
 * The Team Lead portal reuses the CEO's pipeline pages (rev 194): its own
 * endpoints, "My team" / "Not assigned" with Assign, real profile photos, and
 * the business numbers on T-Home. The Manager gets the same sections (rev 196).
 */
const seekerRow = {
  id: 'js9', code: 'JS-00099', name: 'Manju Gowda', phone: '******4321', trade: 'Driver', salaryMinPaise: 1500000, salaryMaxPaise: 1800000, salaryPeriod: 'monthly',
  status: 'lead', hits: 0, maxHits: 3, kyc: 'none', paidAt: null, guaranteeDaysLeft: null, registeredAt: '2026-11-15T05:00:00.000Z', registeredBy: null,
};
const summary = { activeInPool: 0, registeredNotPaid: 1, waitingOnKyc: 0, withinFiveDaysOfRefund: 0, atTwoOfThreeHits: 0, deactivatedThisMonth: 0 };
const assignees = {
  rows: [
    { id: 'staff-tl', code: 'TL-0003', name: 'Ravi Shankar', role: 'team_lead', me: true, canHoldBusiness: true },
    { id: 'ca1', code: 'CA-0042', name: 'Deepa Nair', role: 'call_agent', me: false, canHoldBusiness: false },
    { id: 'fa1', code: 'FA-0007', name: 'Kiran Kumar', role: 'field_agent', me: false, canHoldBusiness: true },
  ],
};

describe('Team Lead portal: pipeline lists with My team / Not assigned and Assign', () => {
  it('reads /team-lead/job-seekers, opens on My team, switches to Not assigned and assigns a row', async () => {
    signInAs('team_lead');
    const api = mockApi({
      'GET /team-lead/job-seekers': ({ url }: { url: URL }) => ({
        rows: url.searchParams.get('section') === 'unassigned' ? [seekerRow] : [],
        total: url.searchParams.get('section') === 'unassigned' ? 1 : 0, page: 1, pageSize: 25, trades: [], summary,
      }),
      'GET /team-lead/assignees': assignees,
      'POST /team-lead/assign': { ok: true, kind: 'job_seeker', id: 'js9', code: 'JS-00099', from: null, to: { id: 'ca1', name: 'Deepa Nair' } },
      'POST /app-signups/labels': {},
    });
    renderScreen(<JobSeekersList />, { portal: 'team-lead', path: '/team-lead/job-seekers' });
    const tabs = await screen.findByRole('tablist', { name: 'Which job seekers' });
    expect(within(tabs).getByRole('tab', { name: 'My team' })).toHaveAttribute('aria-selected', 'true');
    await waitFor(() => expect(api.calls('GET /team-lead/job-seekers')[0].query.get('section')).toBe('team'));
    expect(api.calls('GET /ceo/job-seekers')).toHaveLength(0);
    expect(screen.queryByRole('link', { name: '+ Register job seeker' })).toBeNull();

    await userEvent.click(within(tabs).getByRole('tab', { name: 'Not assigned' }));
    expect(await screen.findByText('Manju Gowda')).toBeInTheDocument();
    expect(api.calls('GET /team-lead/job-seekers').at(-1)!.query.get('section')).toBe('unassigned');

    await userEvent.click(screen.getByRole('button', { name: 'Assign Manju Gowda' }));
    const dialog = await screen.findByRole('dialog', { name: 'Assign Manju Gowda' });
    await userEvent.click(await within(dialog).findByRole('radio', { name: /Deepa Nair/ }));
    await userEvent.click(within(dialog).getByRole('button', { name: 'Assign' }));
    expect(await screen.findByText('Assigned to Deepa Nair')).toBeInTheDocument();
    expect(api.calls('POST /team-lead/assign')[0].body).toEqual({ kind: 'job_seeker', id: 'js9', toStaffId: 'ca1' });
    // The list is read again, so the row moves to My team.
    await waitFor(() => expect(api.calls('GET /team-lead/job-seekers').length).toBeGreaterThan(2));
    // The row was not opened by the click.
    expect(screen.queryByTestId('navigated-away')).toBeNull();
  });

  it('a business is offered only to people who can hold one (never a call agent)', async () => {
    signInAs('team_lead');
    mockApi({
      'GET /team-lead/businesses': {
        rows: [{ id: 'b9', code: 'BZ-00099', name: 'Shanti Sagar', type: 'restaurant', area: 'JP Nagar', status: 'verified', noDocuments: false, accountAgent: null, openVacancies: 0, openPositions: 0, placements: 0, lastVisitAt: null, flags: [] }],
        total: 1, page: 1, pageSize: 25, byType: [], byArea: [], facets: { agents: [], areas: [], types: [] },
        summary: { active: 1, signedThisMonth: 0, noDocuments: 0, hiredMoreThanOnce: 0, flags: 0, revisitsDueThisWeek: 0, repeatPercent: 0, withPlacements: 0 },
      },
      'GET /team-lead/assignees': assignees,
      'POST /app-signups/labels': {},
    });
    renderScreen(<BusinessesList />, { portal: 'team-lead', path: '/team-lead/businesses?section=unassigned' });
    await userEvent.click(await screen.findByRole('button', { name: 'Assign Shanti Sagar' }));
    const dialog = await screen.findByRole('dialog', { name: 'Assign Shanti Sagar' });
    expect(await within(dialog).findByRole('radio', { name: /Kiran Kumar/ })).toBeInTheDocument();
    expect(within(dialog).queryByRole('radio', { name: /Deepa Nair/ })).toBeNull();
  });

  it('the Manager gets the same sections on his lists', async () => {
    signInAs('manager');
    const api = mockApi({
      'GET /manager/job-seekers': { rows: [seekerRow], total: 1, page: 1, pageSize: 25, trades: [], summary },
      'POST /app-signups/labels': {},
    });
    renderScreen(<JobSeekersList />, { portal: 'manager', path: '/manager/job-seekers?section=unassigned' });
    expect(await screen.findByRole('tab', { name: 'Not assigned' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('tab', { name: 'My teams' })).toBeInTheDocument();
    await waitFor(() => expect(api.calls('GET /manager/job-seekers')[0].query.get('section')).toBe('unassigned'));
    expect(await screen.findByRole('button', { name: 'Assign Manju Gowda' })).toBeInTheDocument();
  });

  it('the CEO list has no sections and no Assign', async () => {
    signInAs('ceo');
    const api = mockApi({ 'GET /ceo/job-seekers': { rows: [seekerRow], total: 1, page: 1, pageSize: 25, trades: [], summary }, 'POST /app-signups/labels': {} });
    renderScreen(<JobSeekersList />, { portal: 'ceo', path: '/ceo/job-seekers' });
    expect(await screen.findByText('Manju Gowda')).toBeInTheDocument();
    expect(screen.queryByRole('tab', { name: 'Not assigned' })).toBeNull();
    expect(screen.queryByRole('button', { name: /Assign/ })).toBeNull();
    expect(api.calls('GET /ceo/job-seekers')[0].query.get('section')).toBeNull();
  });
});

const legal = { status: { documentKey: 'job_seeker_terms', currentVersion: '1.1', acceptedVersion: null, needsReconsent: false, noticeVersion: null, currentNoticeVersion: null }, acceptances: [] };
const seekerDetail = {
  id: 'js9', code: 'JS-00099', name: 'Manju Gowda', phone: '******4321', status: 'lead', createdAt: '2026-11-01T05:00:00.000Z',
  guarantee: { days: 30, paidAt: null, daysLeft: null }, hits: { count: 0, max: 3 }, offersMade: 0, interviews: 0,
  profile: { trades: [{ trade: 'Driver', years: 2, primary: true }], locality: 'JP Nagar', pincode: '560078', travelDistanceKm: 5, salaryMinPaise: 1500000, salaryMaxPaise: 1800000, salaryPeriod: 'monthly', shiftPreference: 'day', jobType: 'full_time', languages: ['Kannada'], qualification: null, referredBy: null, registeredBy: null, heardFrom: null, dateOfBirth: null, bestTime: null },
  registration: { phoneVerified: true, consentsGranted: 3, consentsAsked: 3, consentAt: null, selfieAt: '2026-11-01T05:05:00.000Z', hasSelfie: true, idCheck: null, paymentAt: null },
  consents: [], hitList: [], activity: [], placements: [], history: [],
  assignment: { section: 'unassigned', assignedTo: null, canAssign: true },
};

describe('Profiles: Assign and real photos', () => {
  it('a Team Lead sees "Not assigned yet" with Assign, and the live selfie (tap to enlarge)', async () => {
    signInAs('team_lead');
    const api = mockApi({
      'GET /team-lead/job-seekers/js9': seekerDetail,
      'GET /team-lead/job-seekers/js9/selfie': { kept: true, url: 'https://photos.example/selfie.jpg?token=x', expiresInSeconds: 300 },
      'GET /legal/acceptances/job_seeker/js9': legal,
      'GET /identity/job-seekers/js9/aadhaar-check': { status: 'none' },
      'POST /app-signups/labels': {},
    });
    renderScreen(<JobSeekerDetail />, { portal: 'team-lead', path: '/team-lead/job-seekers/js9', route: '/team-lead/job-seekers/:id' });
    expect(await screen.findByText('Manju Gowda · JS-00099')).toBeInTheDocument();
    expect(screen.getByTestId('assignment')).toHaveTextContent('Not assigned yet');
    expect(screen.getByRole('button', { name: 'Assign Manju Gowda' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Reverse a hit' })).toBeNull();
    const hero = screen.getByTestId('profile-hero');
    expect(hero).toHaveTextContent('JS-00099');
    const img = await within(hero).findByRole('img', { name: 'Live selfie of Manju Gowda' });
    expect(img).toHaveAttribute('src', 'https://photos.example/selfie.jpg?token=x');
    await userEvent.click(screen.getByRole('button', { name: 'Enlarge: Live selfie of Manju Gowda' }));
    expect(await screen.findByRole('dialog', { name: 'Live selfie of Manju Gowda' })).toBeInTheDocument();
    expect(api.calls('GET /ceo/job-seekers/js9/selfie')).toHaveLength(0);
  });

  it('22 Nov: on the job seeker page the Team Lead opens the ID photos large and "Looks right" decides the PAN', async () => {
    signInAs('team_lead');
    const api = mockApi({
      'GET /team-lead/job-seekers/js9': seekerDetail,
      'GET /team-lead/job-seekers/js9/selfie': { kept: true, url: 'https://photos.example/selfie.jpg?token=x', expiresInSeconds: 300 },
      'GET /legal/acceptances/job_seeker/js9': legal,
      'GET /identity/job-seekers/js9/aadhaar-check': {
        check: {
          method: 'pan', status: 'pending', verifiedByUidai: false, maskedReference: null, checkedAt: '2026-11-22T01:49:00Z', idNumberLast4: '701P',
          nameMatches: null, isAdult: null, phoneLinked: null, nameOnId: null, dateOfBirth: null, gender: null, area: null, pincode: null,
          photo: { kind: 'id_card_photo', kept: true, deletedReason: null, deletedAt: null, expiresAt: '2026-12-22T01:49:00Z' },
        },
        decision: { canDecide: true, mode: 'own_team', reason: null },
        idPhotoUrl: 'https://photos.example/card.jpg', qrPhotoUrl: 'https://photos.example/card.jpg', selfieUrl: 'https://photos.example/selfie.jpg',
      },
      'POST /identity/job-seekers/js9/other-id/decision': { verdict: 'ok', otherIdDecided: 'verified' },
      'POST /app-signups/labels': {},
    });
    renderScreen(<JobSeekerDetail />, { portal: 'team-lead', path: '/team-lead/job-seekers/js9', route: '/team-lead/job-seekers/:id' });
    await userEvent.click(await screen.findByRole('button', { name: 'Show the ID check' }));
    await userEvent.click(await screen.findByRole('button', { name: 'Open large: Live photo of the ID card' }));
    const large = screen.getByTestId('photo-lightbox');
    expect(within(large).getByRole('img', { name: 'Live photo of the ID card' })).toHaveAttribute('src', 'https://photos.example/card.jpg');
    await userEvent.keyboard('{Escape}');
    await userEvent.click(screen.getByRole('button', { name: 'Open large: Live selfie' }));
    await userEvent.keyboard('{Escape}');
    await userEvent.click(screen.getByRole('button', { name: 'Looks right' }));
    const dialog = await screen.findByRole('dialog');
    await userEvent.click(within(dialog).getByRole('button', { name: /looks right/i }));
    await waitFor(() => expect(api.calls('POST /identity/job-seekers/js9/other-id/decision')[0].body).toEqual({ verdict: 'ok' }));
  });

  it('a selfie that is gone says "Photo no longer kept" (CEO)', async () => {
    signInAs('ceo');
    mockApi({
      'GET /ceo/job-seekers/js9': { ...seekerDetail, assignment: undefined, activation: null, refunds: [] },
      'GET /ceo/job-seekers/js9/selfie': { kept: false, url: null, expiresInSeconds: 0 },
      'GET /legal/acceptances/job_seeker/js9': legal,
      'GET /identity/job-seekers/js9/aadhaar-check': { status: 'none' },
      'POST /app-signups/labels': {},
    });
    renderScreen(<JobSeekerDetail />, { portal: 'ceo', path: '/ceo/job-seekers/js9', route: '/ceo/job-seekers/:id' });
    // A clean initials placeholder when the photo is no longer kept (rev 198).
    const gone = await screen.findByRole('img', { name: 'Live selfie of Manju Gowda: Photo no longer kept' });
    expect(gone).toHaveTextContent('MG');
    expect(screen.queryByTestId('assignment')).toBeNull();
  });

  it('C-Business shows each visit\'s name-board photo and selfie with alt text', async () => {
    signInAs('manager');
    mockApi({
      'GET /manager/businesses/b9': {
        id: 'b9', code: 'BZ-00099', name: 'Shanti Sagar', legalName: null, phone: '******1111', gstNumber: null, gstVerified: null, type: 'restaurant', employeeCount: null, employeeCountBand: null,
        address: null, hasPin: true, contact: { name: 'Owner', role: 'owner', phone: '******1111', verified: true }, branches: [], accountAgent: { id: 'fa1', name: 'Kiran Kumar', since: null },
        heardFrom: null, leadChannel: null, status: 'verified', pauseReason: null, noDocuments: false, createdAt: '2026-11-01T05:00:00.000Z',
        tiles: { openVacancies: 0, openPositions: 0, candidatesShown: 0, noBypassMonths: 12, interviews: 0, placements: 0, replacementsUsed: 0 },
        agreement: null, callRecordingConsent: null, vacancies: [], introductions: [], history: [], suspension: null,
        visits: [{ id: 'v1', at: '2026-11-12T05:00:00.000Z', by: 'Kiran Kumar', purpose: 'verification', geofenceFlag: false, hasSelfie: true, hasBoardPhoto: true, photoLive: true }],
        assignment: { section: 'team', assignedTo: { id: 'fa1', name: 'Kiran Kumar' }, canAssign: true },
      },
      'GET /manager/businesses/b9/visits/v1/photos': {
        boardPhoto: { kept: true, url: 'data:image/jpeg;base64,Ym9hcmQ=', expiresInSeconds: 300 },
        selfie: { kept: false, url: null, expiresInSeconds: 0 },
        expiresInSeconds: 300,
      },
      'GET /staff': [],
      'GET /legal/acceptances/business/b9': { ...legal, status: { ...legal.status, documentKey: 'business_agreement' } },
      'POST /app-signups/labels': {},
    });
    renderScreen(<BusinessDetail />, { portal: 'manager', path: '/manager/businesses/b9', route: '/manager/businesses/:id' });
    // At the top: the shop's board photo, then the name and the BZ- ID under it (rev 198).
    const hero = await screen.findByTestId('profile-hero');
    expect(await within(hero).findByRole('img', { name: 'Shop name board of Shanti Sagar' })).toHaveAttribute('src', 'data:image/jpeg;base64,Ym9hcmQ=');
    expect(hero).toHaveTextContent('Shanti Sagar');
    expect(hero).toHaveTextContent('BZ-00099');
    expect(await screen.findByRole('img', { name: /Shop name board of Shanti Sagar, visit on/ })).toHaveAttribute('src', 'data:image/jpeg;base64,Ym9hcmQ=');
    expect(screen.getByRole('img', { name: /Selfie of Kiran Kumar at Shanti Sagar.*Photo no longer kept/ })).toBeInTheDocument();
    expect(screen.getByTestId('assignment')).toHaveTextContent('Account agent: Kiran Kumar');
  });
});

describe('Team Lead home: business numbers and close to a refund', () => {
  it('shows the three rows as counts, each opening the Team Lead list (filtered where it can be)', async () => {
    signInAs('team_lead');
    const api = mockApi({
      'GET /team-lead/pipeline': {
        jobSeekers: { registered: 41, stuckBeforePaying: 7, paid: 22, notPaid: 19, interviewed: 12, offered: 9, accepted: 6, joined: 4 },
        businesses: { fieldVisits: 58, signedUp: 5, vacanciesAdded: 8, openings: 14, filled: 3, droppedOut: 1 },
        referralPartners: { registered: 6, introduced: 11, introducedPaid: 5, partnersPaid: 2, partnersNotPaid: 3 },
      },
    });
    renderScreen(<BusinessNumbers />, { portal: 'team-lead', path: '/team-lead', now: new Date('2026-11-09T06:00:00.000Z') });
    const box = await screen.findByTestId('tl-business');
    // Each list opens for the same period (this month by default: 1–9 Nov on the test clock).
    const period = 'from=2026-11-01&to=2026-11-09';
    expect(await within(box).findByRole('link', { name: 'Registered: 41' })).toHaveAttribute('href', `/team-lead/job-seekers?${period}`);
    expect(within(box).getByRole('link', { name: 'Not paid: 19' })).toHaveAttribute('href', `/team-lead/job-seekers?status=not_paid&${period}`);
    expect(within(box).getByRole('link', { name: 'Paid: 22' })).toHaveAttribute('href', `/team-lead/job-seekers?dateField=paid&${period}`);
    expect(within(box).getByRole('link', { name: 'Vacancies added: 8' })).toHaveAttribute('href', `/team-lead/vacancies?${period}`);
    expect(within(box).getByRole('link', { name: 'Reward not paid yet: 3' })).toHaveAttribute('href', `/team-lead/referrals?${period}`);
    expect(box.textContent).not.toMatch(/₹/);
    expect(api.calls('GET /team-lead/pipeline')[0].query.get('fromDate')).toBeTruthy();
    // The period picker reads the numbers again.
    await userEvent.click(screen.getByRole('button', { name: 'Today' }));
    await waitFor(() => expect(api.calls('GET /team-lead/pipeline').length).toBe(2));
  });

  it('lists the team close to a refund with names, no rupees, and reminds the agent', async () => {
    signInAs('team_lead');
    const api = mockApi({
      'GET /team-lead/close-to-refund': {
        windowDays: 15, total: 1, jobSeekers: 1, businesses: 0,
        buckets: [{ bucket: '0-5', count: 1 }, { bucket: '6-10', count: 0 }, { bucket: '11-15', count: 0 }],
        rows: [{ kind: 'job_seeker', id: 'js9', code: 'JS-00099', name: 'Manju Gowda', trade: 'Driver', daysLeft: 3, bucket: '0-5', businessName: null, agent: { id: 'ca1', name: 'Deepa Nair' } }],
      },
      'POST /team-lead/remind': { ok: true },
    });
    renderScreen(<CloseToRefund selfId="staff-tl" />, { portal: 'team-lead', path: '/team-lead' });
    expect(await screen.findByRole('link', { name: 'JS-00099 · Manju Gowda' })).toHaveAttribute('href', '/team-lead/job-seekers/js9');
    expect(screen.getByText('3 days')).toBeInTheDocument();
    expect(document.body.textContent).not.toMatch(/₹/);
    await userEvent.click(screen.getByRole('button', { name: 'Remind the agent' }));
    await waitFor(() => expect(api.calls('POST /team-lead/remind')[0]?.body).toEqual({ staffId: 'ca1', jobSeekerId: 'js9' }));
  });
});

describe('Lists opened from T-Home', () => {
  it('a job seeker list opens for the period in the address, on the payment day for "Paid"', async () => {
    signInAs('team_lead');
    const api = mockApi({ 'GET /team-lead/job-seekers': { rows: [], total: 0, page: 1, pageSize: 25, trades: [], summary }, 'POST /app-signups/labels': {} });
    renderScreen(<JobSeekersList />, { portal: 'team-lead', path: '/team-lead/job-seekers?dateField=paid&from=2026-11-01&to=2026-11-09' });
    await waitFor(() => expect(api.calls('GET /team-lead/job-seekers').length).toBeGreaterThan(0));
    const q = api.calls('GET /team-lead/job-seekers').at(-1)!.query;
    expect(q.get('dateField')).toBe('paid');
    expect(q.get('fromDate')).toBe('2026-10-31T18:30:00.000Z');
    expect(q.get('toDate')).toBeTruthy();
  });

  it('puts Assign in the first column on Not assigned, in reach on a phone', async () => {
    signInAs('team_lead');
    mockApi({ 'GET /team-lead/job-seekers': { rows: [seekerRow], total: 1, page: 1, pageSize: 25, trades: [], summary }, 'POST /app-signups/labels': {} });
    renderScreen(<JobSeekersList />, { portal: 'team-lead', path: '/team-lead/job-seekers?section=unassigned' });
    const button = await screen.findByRole('button', { name: 'Assign Manju Gowda' });
    const row = button.closest('tr')!;
    expect(row.querySelector('td')!.contains(button)).toBe(true);
  });
});
