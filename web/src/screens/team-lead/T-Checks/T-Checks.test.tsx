import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { mockApi, renderScreen } from '../../../test/utils';
import BusinessChecks from './index';

const failed = {
  id: 'b1', code: 'BZ-00001', name: 'Sri Sai Hotel', area: 'Jayanagar', type: 'restaurant', since: '2026-11-25T05:00:00Z',
  candidatesShownMeanwhile: false, owner: 'Ravi', canDecide: true, visit: null,
  verification: {
    household: false, runsFromHome: false, mapsPlaceName: 'Sri Sai Hotel',
    autoCheck: { status: 'failed', checkedAt: '2026-11-25T05:00:00Z', distanceMeters: 260, reasons: [], failed: ['Shop photo taken 260 m from the Maps pin (more than 200 m)'] },
    proofs: [
      { key: 'gst', label: 'GST number', given: true, valid: true, detail: null },
      { key: 'licence', label: 'FSSAI / trade licence / Udyam', given: false, valid: false, detail: null },
      { key: 'maps', label: 'Google Maps link', given: true, valid: true, detail: null },
    ],
  },
  smallBusiness: null,
};
const small = {
  ...failed, id: 'b2', code: 'BZ-00002', name: 'Lakshmi Tiffins',
  verification: { ...failed.verification, runsFromHome: true, autoCheck: { ...failed.verification.autoCheck, failed: ['0 of 3 proofs valid; at least 2 needed — small business checks instead'] } },
  smallBusiness: {
    ownerId: { method: 'other_id', type: 'pan', result: 'pending', last4: '234F', failureReason: null }, ownerIdName: 'Lakshmi',
    businessProof: { given: true, kind: 'bank_upi', fromProofs: false }, businessProofValue: 'lakshmi@upi',
    addressProof: { submitted: true, docType: 'electricity_bill', result: 'pending' }, addressMatched: null,
    videoCall: { done: false, at: null }, videoCallNote: null, photos: { selfie: true, workspace: true },
    idPhotoWaiting: true, addressPhotoWaiting: true,
    missing: ["the Team Lead's check of the owner's ID", "the Team Lead's check of the address proof", 'the video call with the Team Lead'],
  },
};
const vacancy = {
  id: 'v1', code: 'VC-00009', trade: 'Helper', headcount: 8, salaryMinPaise: 1500000, salaryMaxPaise: 1600000, salaryPeriod: 'monthly',
  usualSalary: { minPaise: 1200000, maxPaise: 1800000 }, reasons: [{ code: 'many_openings', detail: '8 openings (more than 5)' }],
  business: { id: 'b9', code: 'BZ-00009', name: 'Big Store', locality: null },
};
const photos = { selfie: { kept: false, url: null, expiresInSeconds: 0, kind: 'owner_selfie', takenAt: null, takenVia: null, locationStatus: null }, shop: { kept: false, url: null, expiresInSeconds: 0, kind: 'shop', takenAt: null, takenVia: null, locationStatus: null } };

describe('T-Checks (rev 211–212): every business and vacancy the automatic check sent to the Team Lead', () => {
  it('shows each failed reason, the proofs and distance, the small-business steps, and approves a held vacancy', async () => {
    const api = mockApi({
      'GET /team-lead/business-checks': { businesses: [failed, small], vacancies: [vacancy] },
      'GET /team-lead/businesses/b1/owner-photos': photos,
      'GET /team-lead/businesses/b2/owner-photos': photos,
      'POST /vacancies/v1/tl-check': { id: 'v1', status: 'open' },
      'POST /businesses/b2/small-business/video-call': {},
    });
    renderScreen(<BusinessChecks />, { portal: 'team-lead', path: '/team-lead/checks' });
    expect(await screen.findByText('Shop photo taken 260 m from the Maps pin (more than 200 m)')).toBeInTheDocument();
    expect(screen.getAllByText(/GST number: valid · FSSAI \/ trade licence \/ Udyam: not given · Google Maps link: valid/)).toHaveLength(2);
    expect(screen.getAllByText('260 m · Sri Sai Hotel').length).toBeGreaterThan(0);
    const checks = screen.getByTestId('small-business-checks');
    expect(within(checks).getByText(/PAN ending 234F · Lakshmi · Pending/)).toBeInTheDocument();
    expect(within(checks).getByRole('button', { name: 'ID looks right' })).toBeInTheDocument();
    expect(within(checks).getByRole('button', { name: 'Address checked' })).toBeInTheDocument();
    expect(screen.getByTestId('small-business-missing')).toHaveTextContent('the video call with the Team Lead');
    expect(screen.getByText("Workplace is the owner's home")).toBeInTheDocument();
    // Approve waits for the small-business steps.
    const approves = screen.getAllByRole('button', { name: 'Approve' });
    expect(approves[1]).toBeDisabled();
    await userEvent.click(within(checks).getByRole('button', { name: 'Video call done' }));
    await userEvent.type(screen.getByRole('textbox', { name: /What the video call showed/ }), 'Saw the home kitchen');
    await userEvent.click(screen.getAllByRole('button', { name: 'Video call done' }).at(-1)!);
    await waitFor(() => expect(api.calls('POST /businesses/b2/small-business/video-call')).toHaveLength(1));
    expect(api.calls('POST /businesses/b2/small-business/video-call')[0]!.body).toEqual({ note: 'Saw the home kitchen' });
    expect(screen.getByText('8 openings (more than 5)')).toBeInTheDocument();
    await userEvent.click(approves[2]!);
    await userEvent.click(screen.getByRole('button', { name: 'Approve the vacancy' }));
    await waitFor(() => expect(api.calls('POST /vacancies/v1/tl-check')[0]!.body).toEqual({ decision: 'approve' }));
  });
});
