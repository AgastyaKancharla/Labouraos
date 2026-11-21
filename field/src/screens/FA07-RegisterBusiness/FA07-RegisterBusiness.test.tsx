import { fireEvent, screen, waitFor } from '@testing-library/react-native';
import { router, searchParams } from '@/test/expo-router-mock';
import { kiran, renderWithApp } from '@/test/render';
import { clearAllFormDrafts } from '@/lib/formDraft';
import { OfflineQueue } from '@/device/offline-queue/queue';
import { createMemoryQueueStore } from '@/device/offline-queue/types';
import { networkError } from '@/api/errors';
import { getDraft, saveDraft } from '../_visits/visitDraft';
import { businessBody, formErrors, type FormState } from './form';
import RegisterBusinessScreen from '.';
import { nearestArea } from '@/lib/nearestArea';

jest.mock('expo-router', () => require('@/test/expo-router-mock'));

const trades = [{ id: 't1', name: 'Cook', salaryMinPaise: 1800000, salaryMaxPaise: 3000000, minimumWageLevel: 'skilled', legalMinimumPaise: 2340000 }];

beforeEach(() => {
  jest.clearAllMocks();
  clearAllFormDrafts();
});

/** Fills every required field of the form (contact with OTP, business, address). */
async function fillRequired() {
    await fireEvent.changeText(screen.getByTestId('fa07-contact-name'), 'Shankar Rao');
    await fireEvent.press(screen.getByTestId('fa07-role'));
    await fireEvent.press(screen.getByTestId('fa07-role-owner'));
    await fireEvent.changeText(screen.getByTestId('fa07-mobile'), '9900054321');
    await fireEvent.press(screen.getByTestId('fa07-mobile-send'));
    await waitFor(() => screen.getByTestId('fa07-mobile-verify'));
    await fireEvent.changeText(screen.getByTestId('fa07-mobile-code'), '123456');
    await fireEvent.press(screen.getByTestId('fa07-mobile-verify'));
    await waitFor(() => screen.getByText(/Checked by OTP at/));
    expect(screen.queryByTestId('fa07-language')).toBeNull(); // English only (rev 193): no message language
    await fireEvent.press(screen.getByTestId('fa07-type'));
    await fireEvent.press(screen.getByTestId('fa07-type-restaurant_hotel'));
    await fireEvent.press(screen.getByTestId('fa07-employees'));
    await fireEvent.press(screen.getByTestId('fa07-employees-1-5'));
    await fireEvent.changeText(screen.getByLabelText('Shop / building number *'), 'No. 14');
    await fireEvent.changeText(screen.getByLabelText('Street *'), '16th Main Road');
    await fireEvent.changeText(screen.getByLabelText('Landmark *'), 'Opposite BTM water tank');
    await fireEvent.press(screen.getByTestId('fa07-area'));
    await waitFor(() => screen.getByTestId('fa07-area-BTM Layout 2nd Stage'));
    await fireEvent.press(screen.getByTestId('fa07-area-BTM Layout 2nd Stage'));
}

describe('FA07 Register a business', () => {
  it('17 Nov (+21 Nov confirm on the map): "Paste Google Maps link" sets the pin and fills — or, pasted again, replaces — shop number, street, area, PIN code and city (all editable)', async () => {
    searchParams.current = {};
    const sent: unknown[] = [];
    const answers = [
      { latitude: 12.9116, longitude: 77.6101, placeName: 'Sri Sai Bakery', shortLink: true, address: { shopNumber: '12', street: '24th Main Road, JP Nagar 6th Phase', area: 'JP Nagar', city: 'Bengaluru', state: 'Karnataka', pincode: '560078', displayName: 'x' } },
      { latitude: 12.3052, longitude: 76.6552, placeName: null, shortLink: false, address: { shopNumber: null, street: 'Sayyaji Rao Road', area: 'Devaraja Mohalla', city: 'Mysuru', state: 'Karnataka', pincode: '570001', displayName: 'y' } },
    ];
    await renderWithApp(<RegisterBusinessScreen />, {
      signedInAs: kiran,
      route: (url, init) => {
        if (url.endsWith('/screens/call-registration/options')) return { status: 200, body: { city: 'Bengaluru', areas: [{ name: 'JP Nagar', pincode: '560078', latitude: 12.9116, longitude: 77.6101 }] } };
        if (url.endsWith('/trades')) return { status: 200, body: trades };
        if (url.endsWith('/maps-link/locate')) {
          const body = JSON.parse(String(init.body)) as { text: string };
          sent.push(body);
          if (body.text.includes('bing')) return { status: 400, body: { statusCode: 400, message: 'Paste a Google Maps link', details: { code: 'MAPS_LINK_INVALID' } } };
          return { status: 200, body: { source: 'link', matched: 'x', ...(answers[sent.length - 2] ?? answers[0]) } };
        }
        return undefined;
      },
    });
    await waitFor(() => screen.getByTestId('fa07-maps-text'));
    // Without a link the city stays the old default.
    expect(screen.getByTestId('fa07-city').props.value).toBe('Bengaluru');
    await fireEvent.changeText(screen.getByTestId('fa07-maps-text'), 'https://www.bing.com/maps?cp=12.9~77.6');
    await fireEvent.press(screen.getByTestId('fa07-maps-find'));
    await waitFor(() => screen.getByText(/not a Google Maps link/));

    await fireEvent.changeText(screen.getByLabelText('Shop / building number *'), 'No. 7');
    await fireEvent.changeText(screen.getByTestId('fa07-maps-text'), 'Sri Sai Bakery https://maps.app.goo.gl/AbCdEf');
    await fireEvent.press(screen.getByTestId('fa07-maps-find'));
    // 21 Nov: confirmed on the map first; nothing is filled until "Yes, use this pin".
    await waitFor(() => screen.getByTestId('fa07-maps-confirm'));
    expect(screen.getByText('Is this the right place?')).toBeTruthy();
    expect(screen.getByLabelText('Shop / building number *').props.value).toBe('No. 7');
    await fireEvent.press(screen.getByTestId('fa07-maps-use'));
    await waitFor(() => expect(screen.getByTestId('fa07-maps-note')).toHaveTextContent(/Pin and shop number, street, area, PIN code, city filled from the link/));
    expect(sent.at(-1)).toEqual({ text: 'Sri Sai Bakery https://maps.app.goo.gl/AbCdEf' });
    expect(screen.getByLabelText('Shop / building number *').props.value).toBe('12');
    expect(screen.getByLabelText('Street *').props.value).toBe('24th Main Road, JP Nagar 6th Phase');
    expect(screen.getByTestId('fa07-pincode').props.value).toBe('560078');
    expect(screen.getByText(/Pin: 12.91160, 77.61010/)).toBeTruthy();
    await waitFor(() => expect(screen.getByTestId('fa07-area')).toHaveTextContent(/JP Nagar/));

    // Pasted again (another shop, in Mysuru): everything the lookup knows is replaced; the city follows.
    await fireEvent.changeText(screen.getByTestId('fa07-maps-text'), 'https://www.google.com/maps/@12.3052,76.6552,17z');
    await fireEvent.press(screen.getByTestId('fa07-maps-find'));
    await waitFor(() => screen.getByTestId('fa07-maps-use'));
    await fireEvent.press(screen.getByTestId('fa07-maps-use'));
    await waitFor(() => expect(screen.getByTestId('fa07-city').props.value).toBe('Mysuru'));
    expect(screen.getByLabelText('Street *').props.value).toBe('Sayyaji Rao Road');
    expect(screen.getByTestId('fa07-pincode').props.value).toBe('570001');
    // No shop number in the lookup: what was there stays.
    expect(screen.getByLabelText('Shop / building number *').props.value).toBe('12');
    expect(screen.getByTestId('fa07-maps-note')).toHaveTextContent(/Pin and street, PIN code, city filled/);
    // Editable afterwards.
    await fireEvent.changeText(screen.getByTestId('fa07-city'), 'Mysore');
    expect(screen.getByTestId('fa07-city').props.value).toBe('Mysore');
  });

  it('starts from the visit (board name, map pin), checks the mobile by OTP, warns below the minimum wage, and registers from the visit', async () => {
    saveDraft({
      id: 'v-7', startedAt: '2026-11-09T06:00:00Z', latitude: 12.9116, longitude: 77.6101, accuracy: 8, shopName: 'Annapoorna Mess', businessId: null,
      businessName: null, spokeTo: 'owner', contactPhone: '', endedAt: '2026-11-09T06:14:00Z', proofDistance: 6, proofAt: null,
    });
    searchParams.current = { visitId: 'v-7' };
    const posted: Record<string, unknown>[] = [];
    await renderWithApp(<RegisterBusinessScreen />, {
      signedInAs: kiran,
      route: (url, init) => {
        if (url.endsWith('/screens/call-registration/options')) return { status: 200, body: { city: 'Bengaluru', areas: [{ name: 'BTM Layout 2nd Stage', pincode: '560076', latitude: 12.91, longitude: 77.61 }] } };
        if (url.endsWith('/trades')) return { status: 200, body: trades };
        if (url.endsWith('/otp/send')) return { status: 201, body: { success: true, requestId: 'otp-9', resendAvailableAt: new Date(Date.now() + 30000).toISOString() } };
        if (url.endsWith('/otp/verify')) return { status: 201, body: { verified: true } };
        if (url.endsWith('/businesses') && init.method === 'POST') {
          posted.push(JSON.parse(String(init.body)));
          return { status: 201, body: { id: 'b-new', code: 'BZ-00400', name: 'Annapoorna Mess' } };
        }
        if (url.endsWith('/agreement-links')) return { status: 201, body: {} };
        return undefined;
      },
    });
    expect(screen.getByTestId('fa07-board-name').props.value).toBe('Annapoorna Mess');
    expect(screen.getByText(/Map pin set at the shop/)).toBeTruthy();
    await fireEvent.press(screen.getByTestId('fa07-save'));
    expect(screen.getByTestId('fa07-problem')).toHaveTextContent(/required fields/);
    expect(posted).toHaveLength(0);

    await fillRequired();
    // Staff needed is optional: no row until the agent adds one.
    expect(screen.queryByTestId('fa07-staff-0')).toBeNull();
    expect(screen.getByTestId('fa07-staff-optional')).toHaveTextContent(/Optional/);
    await fireEvent.press(screen.getByTestId('fa07-add-role'));
    await fireEvent.press(screen.getByTestId('fa07-staff-0-trade'));
    await waitFor(() => screen.getByTestId('fa07-staff-0-trade-Cook'));
    await fireEvent.press(screen.getByTestId('fa07-staff-0-trade-Cook'));
    await fireEvent.changeText(screen.getByTestId('fa07-staff-0-min'), '16000');
    await fireEvent.press(screen.getByTestId('fa07-staff-0-shift'));
    await fireEvent.press(screen.getByTestId('fa07-staff-0-shift-day'));
    await fireEvent.press(screen.getAllByText('Tomorrow')[0]);
    expect(screen.getByText(/Below the legal minimum wage/)).toBeTruthy();
    // 21 Nov: the owner-told tick is asked once, when the vacancy is sent to the owner; here it warns only.
    expect(screen.getByTestId('fa07-staff-0-below')).toHaveTextContent(/you confirm it when you send this vacancy/);
    expect(screen.queryByLabelText('Owner told about the legal minimum wage')).toBeNull();
    // The usual pay for Cook (₹18,000) is below the legal minimum (₹23,400): the hint says so.
    expect(screen.getByText(/never offer less/)).toBeTruthy();
    await fireEvent.press(screen.getByTestId('fa07-save'));
    await waitFor(() => expect(posted).toHaveLength(1));
    expect(posted[0]).toMatchObject({
      name: 'Annapoorna Mess', contactPersonName: 'Shankar Rao', contactPersonRole: 'owner', phone: '9900054321', otpRequestId: 'otp-9',
      heardFrom: 'field_visit', businessType: 'restaurant_hotel', locality: 'BTM Layout 2nd Stage', pincode: '560076',
      latitude: 12.9116, longitude: 77.6101, fieldVisitId: 'v-7',
      staffNeededRows: [{ trade: 'Cook', headcount: 1, salaryMinPaise: 1600000, salaryMaxPaise: 1600000, shift: 'day' }],
    });
    // Next: the agreement step, in the Visits tab; the phone's copy of the visit now knows its business.
    await waitFor(() => expect(router.replace).toHaveBeenCalledWith({ pathname: '/visit/agreement', params: { businessId: 'b-new', visitId: 'v-7' } }));
    expect(getDraft('v-7')).toMatchObject({ businessId: 'b-new', businessName: 'Annapoorna Mess' });
    expect(screen.getByTestId('step-counter')).toHaveTextContent('Step 4 of 7 · business form');
  });

  it('21 Nov: a shop nearby with a similar name asks "Is this the same shop?" — Record as a revisit, or a different shop (goes to the Team Lead)', async () => {
    saveDraft({
      id: 'v-8', startedAt: '2026-11-09T06:00:00Z', latitude: 12.9116, longitude: 77.6101, accuracy: 8, shopName: 'Sri Sai Tiffins', businessId: null,
      businessName: null, spokeTo: 'owner', contactPhone: '', endedAt: '2026-11-09T06:14:00Z', proofDistance: 6, proofAt: null,
    });
    searchParams.current = { visitId: 'v-8' };
    const posted: Record<string, unknown>[] = [];
    await renderWithApp(<RegisterBusinessScreen />, {
      signedInAs: kiran,
      route: (url, init) => {
        if (url.endsWith('/screens/call-registration/options')) return { status: 200, body: { city: 'Bengaluru', areas: [{ name: 'BTM Layout 2nd Stage', pincode: '560076', latitude: 12.91, longitude: 77.61 }] } };
        if (url.endsWith('/trades')) return { status: 200, body: trades };
        if (url.endsWith('/otp/send')) return { status: 201, body: { success: true, requestId: 'otp-9', resendAvailableAt: new Date(Date.now() + 30000).toISOString() } };
        if (url.endsWith('/otp/verify')) return { status: 201, body: { verified: true } };
        if (url.includes('/field-work/similar-shops')) {
          expect(url).toContain('name=Sri%20Sai%20Tiffins');
          return { status: 200, body: { matches: [{ id: 'b-7', code: 'BZ-00007', name: 'Sri Sai Tiffin Centre', locality: 'BTM', distanceMeters: 40, mine: false }] } };
        }
        if (url.endsWith('/businesses') && init.method === 'POST') {
          posted.push(JSON.parse(String(init.body)));
          return { status: 201, body: { id: 'b-new', code: 'BZ-00401', name: 'Sri Sai Tiffins' } };
        }
        if (url.endsWith('/agreement-links')) return { status: 201, body: {} };
        return undefined;
      },
    });
    await fillRequired();
    await fireEvent.press(screen.getByTestId('fa07-save'));
    await waitFor(() => screen.getByTestId('fa07-similar'));
    expect(screen.getByTestId('fa07-similar')).toHaveTextContent(/Is this the same shop\?.*Sri Sai Tiffin Centre \(BZ-00007\) is 40 m from here/);
    expect(posted).toHaveLength(0);
    await fireEvent.press(screen.getByTestId('fa07-similar-revisit'));
    expect(router.replace).toHaveBeenLastCalledWith({ pathname: '/visit/start', params: { businessId: 'b-7', name: 'Sri Sai Tiffin Centre' } });
    await fireEvent.press(screen.getByTestId('fa07-similar-different'));
    await fireEvent.press(screen.getByTestId('fa07-save'));
    await waitFor(() => expect(posted).toHaveLength(1));
  });

  it('what was typed survives going back and opening the form again', async () => {
    saveDraft({
      id: 'v-9', startedAt: '2026-11-09T06:00:00Z', latitude: 12.9116, longitude: 77.6101, accuracy: 8, shopName: 'Sri Sai Stores', businessId: null,
      businessName: null, spokeTo: 'owner', contactPhone: '', endedAt: '2026-11-09T06:14:00Z', proofDistance: 6, proofAt: null,
    });
    searchParams.current = { visitId: 'v-9' };
    const route = (url: string) => (url.endsWith('/trades') ? { status: 200, body: trades } : undefined);
    const first = await renderWithApp(<RegisterBusinessScreen />, { signedInAs: kiran, route });
    await fireEvent.changeText(screen.getByTestId('fa07-contact-name'), 'Manjunath');
    await first.unmount();
    await renderWithApp(<RegisterBusinessScreen />, { signedInAs: kiran, route });
    expect(screen.getByTestId('fa07-contact-name').props.value).toBe('Manjunath');
  });

  it('will not save while the visit’s photos are still waiting to send', async () => {
    saveDraft({
      id: 'v-10', startedAt: '2026-11-09T06:00:00Z', latitude: 12.9116, longitude: 77.6101, accuracy: 8, shopName: 'Sri Sai Stores', businessId: null,
      businessName: null, spokeTo: 'owner', contactPhone: '', endedAt: '2026-11-09T06:14:00Z', proofDistance: 6, proofAt: null,
    });
    searchParams.current = { visitId: 'v-10' };
    const queue = new OfflineQueue({ store: createMemoryQueueStore(), send: async () => Promise.reject(networkError()) });
    await queue.submit('fa-1', 'Visit selfie', { method: 'POST', path: '/field-visits/v-10/proof', json: {} });
    const posted: unknown[] = [];
    await renderWithApp(<RegisterBusinessScreen />, {
      signedInAs: kiran,
      queue,
      route: (url, init) => {
        if (url.endsWith('/screens/call-registration/options')) return { status: 200, body: { city: 'Bengaluru', areas: [{ name: 'BTM Layout 2nd Stage', pincode: '560076', latitude: 12.91, longitude: 77.61 }] } };
        if (url.endsWith('/trades')) return { status: 200, body: trades };
        if (url.endsWith('/otp/send')) return { status: 201, body: { success: true, requestId: 'otp-9' } };
        if (url.endsWith('/otp/verify')) return { status: 201, body: { verified: true } };
        if (url.endsWith('/businesses') && init.method === 'POST') posted.push(init.body);
        return undefined;
      },
    });
    await fillRequired();
    await fireEvent.press(screen.getByTestId('fa07-save'));
    await waitFor(() => expect(screen.getByTestId('fa07-problem')).toHaveTextContent(/still waiting to send/));
    expect(posted).toHaveLength(0);
  });

  it('a visit whose business is already registered goes on to the agreement instead of a blank form (resume an interrupted onboarding)', async () => {
    searchParams.current = { visitId: 'v-11' };
    await renderWithApp(<RegisterBusinessScreen />, {
      signedInAs: kiran,
      route: (url) =>
        url.endsWith('/field-visits/v-11')
          ? { status: 200, body: { id: 'v-11', business: { id: 'b-4', code: 'BZ-4', name: 'Green Leaf Café' }, shopName: 'Green Leaf Café', startedAt: '2026-11-09T06:00:00Z', latitude: 1, longitude: 1, accuracyMeters: 5 } }
          : undefined,
    });
    await waitFor(() => screen.getByTestId('fa07-already'));
    expect(screen.queryByTestId('fa07-save')).toBeNull();
    await fireEvent.press(screen.getByTestId('fa07-to-agreement'));
    expect(router.replace).toHaveBeenCalledWith({ pathname: '/visit/agreement', params: { businessId: 'b-4', visitId: 'v-11' } });
  });

  describe('area from the shop\'s GPS within 1 km (decided 14 Nov)', () => {
    const areas = [
      { name: 'BTM Layout 2nd Stage', pincode: '560076', latitude: 12.9166, longitude: 77.6101 },
      { name: 'Jayanagar', pincode: '560041', latitude: 12.925, longitude: 77.5838 },
    ];
    const visitAt = (latitude: number) => {
      saveDraft({
        id: 'v-8', startedAt: '2026-11-09T06:00:00Z', latitude, longitude: 77.6101, accuracy: 8, shopName: 'Sri Sai Stores', businessId: null,
        businessName: null, spokeTo: 'owner', contactPhone: '', endedAt: '2026-11-09T06:14:00Z', proofDistance: 6, proofAt: null,
      });
      searchParams.current = { visitId: 'v-8' };
    };
    const route = (url: string) => {
      if (url.endsWith('/screens/call-registration/options')) return { status: 200, body: { city: 'Bengaluru', areas, areaAutoFillMaxMeters: 1000 } };
      if (url.endsWith('/trades')) return { status: 200, body: trades };
      return undefined;
    };

    it('finds the nearest area centre within the limit, and none beyond it', () => {
      expect(nearestArea(areas, { latitude: 12.9229, longitude: 77.6101 })?.name).toBe('BTM Layout 2nd Stage');
      expect(nearestArea(areas, { latitude: 12.9301, longitude: 77.6101 })).toBeNull();
      expect(nearestArea(areas, { latitude: 12.9301, longitude: 77.6101 }, 2000)?.name).toBe('BTM Layout 2nd Stage');
    });

    it('fills the area in from a shop within 1 km of an area centre', async () => {
      visitAt(12.9229); // ~700 m north of BTM's centre
      await renderWithApp(<RegisterBusinessScreen />, { signedInAs: kiran, route });
      await waitFor(() => screen.getByTestId('fa07-area-from-pin'));
      expect(screen.getByTestId('fa07-area')).toHaveTextContent(/BTM Layout 2nd Stage/);
      expect(screen.queryByTestId('fa07-area-none-near')).toBeNull();
    });

    it('asks the agent to pick the area when none is within 1 km, and requires it', async () => {
      visitAt(12.9301); // ~1.5 km north of BTM's centre
      await renderWithApp(<RegisterBusinessScreen />, { signedInAs: kiran, route });
      await waitFor(() => screen.getByTestId('fa07-area-none-near'));
      expect(screen.getByTestId('fa07-area-none-near')).toHaveTextContent('Pick the area — no area is within 1 km of this shop');
      expect(screen.queryByTestId('fa07-area-from-pin')).toBeNull();
      expect(screen.getByTestId('fa07-area')).not.toHaveTextContent(/BTM Layout 2nd Stage/);
      await fireEvent.press(screen.getByTestId('fa07-area'));
      await waitFor(() => screen.getByTestId('fa07-area-Jayanagar'));
      await fireEvent.press(screen.getByTestId('fa07-area-Jayanagar'));
      expect(screen.getByTestId('fa07-area')).toHaveTextContent(/Jayanagar/);
      expect(screen.queryByTestId('fa07-area-none-near')).toBeNull();
    });
  });

  it('households have a family name and no documents', () => {
    const form: FormState = {
      contactName: 'Lakshmi', contactRole: 'owner', mobile: { number: '9900054321', requestId: 'r', code: '', verifiedAt: 'x', sentAt: null },
      whatsappSame: true, whatsapp: '', billingEmail: '', heardFrom: 'field_visit', boardName: 'Rao home', legalName: '',
      familyName: 'Rao family', businessType: 'household', employees: '1-5', running: '', hiring: '', opensAt: '', closesAt: '',
      shopNumber: '1', street: 's', landmark: 'l', area: 'JP Nagar', pincode: '560078', pin: { latitude: 1, longitude: 1 }, branches: [],
      gstin: '29ABCDE1234F1Z5', fssai: '', licenceKind: 'udyamNumber', licenceNumber: '', pan: '', noDocuments: false, staff: [],
    };
    const body = businessBody(form, null);
    expect(body).toMatchObject({ familyName: 'Rao family', noDocuments: false });
    expect(body).not.toHaveProperty('gstNumber');
    expect(body).not.toHaveProperty('fieldVisitId');
    expect(formErrors(form, () => undefined)).toEqual([]);
    expect(formErrors({ ...form, familyName: '' }, () => undefined)).toContain('familyName');
    // 17 Nov: the city from the Maps link (or typed) is sent, so the server works out the minimum wage zone from it;
    // an older draft without a city keeps the old default.
    expect(body.city).toBe('Bengaluru');
    expect(businessBody({ ...form, city: ' Mysuru ', pincode: '570001' }, null)).toMatchObject({ city: 'Mysuru', pincode: '570001' });
    expect(businessBody({ ...form, city: '' }, null).city).toBe('Bengaluru');
  });
});
