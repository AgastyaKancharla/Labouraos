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
    await fireEvent.press(screen.getByTestId('fa07-language'));
    await fireEvent.press(screen.getByTestId('fa07-language-kn'));
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
  it('17 Nov: "Paste Google Maps link" fills the pin and the empty address fields, which stay editable', async () => {
    searchParams.current = {};
    const sent: unknown[] = [];
    await renderWithApp(<RegisterBusinessScreen />, {
      signedInAs: kiran,
      route: (url, init) => {
        if (url.endsWith('/screens/call-registration/options')) return { status: 200, body: { city: 'Bengaluru', areas: [{ name: 'JP Nagar', pincode: '560078', latitude: 12.9116, longitude: 77.6101 }] } };
        if (url.endsWith('/trades')) return { status: 200, body: trades };
        if (url.endsWith('/maps-link/resolve')) {
          const body = JSON.parse(String(init.body)) as { url: string };
          sent.push(body);
          if (body.url.includes('bing')) return { status: 400, body: { statusCode: 400, message: 'Paste a Google Maps link', details: { code: 'MAPS_LINK_INVALID' } } };
          return {
            status: 200,
            body: { latitude: 12.9116, longitude: 77.6101, placeName: 'Sri Sai Bakery', shortLink: true, address: { shopNumber: '12', street: '24th Main Road, JP Nagar 6th Phase', area: 'JP Nagar', city: 'Bengaluru', state: 'Karnataka', pincode: '560078', displayName: 'x' } },
          };
        }
        return undefined;
      },
    });
    await waitFor(() => screen.getByTestId('fa07-maps-link'));
    await fireEvent.changeText(screen.getByTestId('fa07-maps-link'), 'https://www.bing.com/maps?cp=12.9~77.6');
    await fireEvent.press(screen.getByTestId('fa07-maps-fill'));
    await waitFor(() => expect(screen.getByTestId('fa07-maps-note')).toHaveTextContent(/not a Google Maps link/));

    await fireEvent.changeText(screen.getByLabelText('Shop / building number *'), 'No. 7');
    await fireEvent.changeText(screen.getByTestId('fa07-maps-link'), 'Sri Sai Bakery https://maps.app.goo.gl/AbCdEf');
    await fireEvent.press(screen.getByTestId('fa07-maps-fill'));
    await waitFor(() => expect(screen.getByTestId('fa07-maps-note')).toHaveTextContent(/filled from the link/));
    expect(sent.at(-1)).toEqual({ url: 'Sri Sai Bakery https://maps.app.goo.gl/AbCdEf' });
    // What the agent typed stays; empty fields are filled; the pin comes from the link; the area follows the pin.
    expect(screen.getByLabelText('Shop / building number *').props.value).toBe('No. 7');
    expect(screen.getByLabelText('Street *').props.value).toBe('24th Main Road, JP Nagar 6th Phase');
    expect(screen.getByText(/Pin: 12.91160, 77.61010/)).toBeTruthy();
    await waitFor(() => expect(screen.getByTestId('fa07-area')).toHaveTextContent(/JP Nagar/));
    // Editable afterwards.
    await fireEvent.changeText(screen.getByLabelText('Street *'), '24th Main');
    expect(screen.getByLabelText('Street *').props.value).toBe('24th Main');
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
    await fireEvent.press(screen.getByTestId('fa07-save'));
    expect(posted).toHaveLength(0); // the owner-told tick is required
    await fireEvent.press(screen.getByLabelText('Owner told about the legal minimum wage'));
    await fireEvent.press(screen.getByTestId('fa07-save'));
    await waitFor(() => expect(posted).toHaveLength(1));
    expect(posted[0]).toMatchObject({
      name: 'Annapoorna Mess', contactPersonName: 'Shankar Rao', contactPersonRole: 'owner', phone: '9900054321', otpRequestId: 'otp-9',
      contactLanguage: 'kn', heardFrom: 'field_visit', businessType: 'restaurant_hotel', locality: 'BTM Layout 2nd Stage', pincode: '560076',
      latitude: 12.9116, longitude: 77.6101, fieldVisitId: 'v-7',
      staffNeededRows: [{ trade: 'Cook', headcount: 1, salaryMinPaise: 1600000, salaryMaxPaise: 1600000, shift: 'day' }],
    });
    // Next: the agreement step, in the Visits tab; the phone's copy of the visit now knows its business.
    await waitFor(() => expect(router.replace).toHaveBeenCalledWith({ pathname: '/visit/agreement', params: { businessId: 'b-new', visitId: 'v-7' } }));
    expect(getDraft('v-7')).toMatchObject({ businessId: 'b-new', businessName: 'Annapoorna Mess' });
    expect(screen.getByTestId('step-counter')).toHaveTextContent('Step 4 of 7 · business form');
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
      whatsappSame: true, whatsapp: '', language: 'kn', billingEmail: '', heardFrom: 'field_visit', boardName: 'Rao home', legalName: '',
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
  });
});
