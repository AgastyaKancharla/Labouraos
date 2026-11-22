import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { mockApi, renderScreen, signInAs } from '../../../test/utils';
import { nearestArea } from '../_registration/nearestArea';
import RegisterBusiness from './index';
import { businessBody, EMPTY_BUSINESS, EMPTY_STAFF_ROW, type BusinessForm } from './payload';

const cook = { id: 't1', name: 'Cook', salaryMinPaise: 1800000, salaryMaxPaise: 3000000, minimumWageLevel: 'unskilled', legalMinimumPaise: 2340000 };
const form: BusinessForm = {
  ...EMPTY_BUSINESS,
  contactName: 'Shankar Rao',
  contactRole: 'owner',
  mobile: '9900054321',
  billingEmail: 'annapoornamess@gmail.com',
  heardFrom: 'toll_free_missed_call',
  boardName: 'Annapoorna Mess',
  legalName: 'Annapoorna Foods',
  businessType: 'restaurant_hotel',
  employees: '6-20',
  running: '3_10',
  hiring: 'every_few_months',
  opensAt: '07:00',
  closesAt: '22:00',
  shopNumber: 'No. 14, 1st floor',
  street: '16th Main Road',
  landmark: 'Opposite BTM water tank',
  place: { area: 'BTM Layout 2nd Stage', pincode: '560076', latitude: 12.9166, longitude: 77.6101 },
  gstin: '29ABCDE1234F1Z5',
  fssai: '11223344556677',
  staff: [{ ...EMPTY_STAFF_ROW, trade: 'Cook', headcount: '2', salaryMinPaise: 1600000, salaryMaxPaise: 2000000, shift: 'day', startDate: '2026-11-16' }],
};
const routes = (overrides: Record<string, unknown> = {}) => ({
  'GET /trades': [cook],
  'GET /screens/call-registration/options': { city: 'Bengaluru', areas: [{ name: 'BTM Layout 2nd Stage', pincode: '560076', latitude: 12.9166, longitude: 77.6101 }] },
  'POST /otp/send': { success: true, requestId: 'otp-b' },
  'POST /otp/verify': { verified: true },
  ...overrides,
});

async function verify(user: ReturnType<typeof userEvent.setup>) {
  await user.click(await screen.findByRole('button', { name: 'Send OTP' }));
  await user.click(await screen.findByLabelText('Digit 1 of 6'));
  await user.paste('123456');
  await screen.findByText('✓ Verified');
}

describe('Register a new business (CA13)', () => {
  it('sends the contact person’s role and every required field, then sends the agreement link', async () => {
    const user = userEvent.setup();
    const api = mockApi(
      routes({
        'POST /businesses': { id: 'biz-1', code: 'BZ-00318' },
        'POST /businesses/biz-1/agreement-links': { success: true },
      }),
    );
    signInAs('call_agent');
    sessionStorage.setItem('laboura.draft.business.staff-ca', JSON.stringify(form));
    renderScreen(<RegisterBusiness />, { portal: 'call-agent', path: '/call-agent/register/business' });
    await verify(user);
    expect(screen.getByText('Below the legal minimum wage.')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Save business' }));
    expect(api.calls('POST /businesses')).toHaveLength(0);
    await user.click(screen.getByLabelText('Owner told about the legal minimum wage'));
    await user.click(screen.getByRole('button', { name: 'Save business' }));
    await waitFor(() => expect(api.calls('POST /businesses')).toHaveLength(1));
    expect(api.calls('POST /businesses')[0].body).toMatchObject({
      name: 'Annapoorna Mess',
      legalName: 'Annapoorna Foods',
      contactPersonName: 'Shankar Rao',
      contactPersonRole: 'owner',
      phone: '9900054321',
      otpRequestId: 'otp-b',
      contactWhatsAppPhone: '9900054321',
      billingEmail: 'annapoornamess@gmail.com',
      heardFrom: 'toll_free_missed_call',
      businessType: 'restaurant_hotel',
      employeeCountBand: '6-20',
      yearsInOperationBand: '3_10',
      hiringFrequency: 'every_few_months',
      openingTime: '07:00',
      closingTime: '22:00',
      shopNumber: 'No. 14, 1st floor',
      street: '16th Main Road',
      landmark: 'Opposite BTM water tank',
      locality: 'BTM Layout 2nd Stage',
      pincode: '560076',
      latitude: 12.9166,
      longitude: 77.6101,
      gstNumber: '29ABCDE1234F1Z5',
      fssaiNumber: '11223344556677',
      staffNeededRows: [{ trade: 'Cook', headcount: 2, salaryMinPaise: 1600000, salaryMaxPaise: 2000000, salaryPeriod: 'monthly', shift: 'day', startDate: '2026-11-16' }],
    });
    await waitFor(() => expect(api.calls('POST /businesses/biz-1/agreement-links')[0]?.body).toEqual({}));
    expect(await screen.findByTestId('navigated-away')).toBeInTheDocument();
  });

  it('shows "Already registered — open it" for a duplicate GST number', async () => {
    const user = userEvent.setup();
    mockApi(
      routes({
        'POST /businesses': {
          status: 409,
          body: { statusCode: 409, message: 'Already registered — open it.', details: { existingBusinessCode: 'BZ-00211', matchedOn: ['gst'] } },
        },
        'GET /screens/call-registration/records/BZ-00211': { type: 'business', id: 'b-211', code: 'BZ-00211', name: 'Annapoorna Foods', registeredAt: '2026-10-02T05:00:00Z', registeredBy: 'Kiran Kumar' },
      }),
    );
    signInAs('call_agent');
    sessionStorage.setItem('laboura.draft.business.staff-ca', JSON.stringify({ ...form, staff: [] }));
    renderScreen(<RegisterBusiness />, { portal: 'call-agent', path: '/call-agent/register/business' });
    await verify(user);
    await user.click(screen.getByRole('button', { name: 'Save business' }));
    expect(await screen.findByText('This GST or licence number is already registered')).toBeInTheDocument();
    expect(await screen.findByRole('link', { name: 'Open Annapoorna’s record' })).toHaveAttribute('href', '/call-agent/register/business/saved?id=b-211');
  });

  describe('area from the map pin within 1 km (decided 14 Nov)', () => {
    const areas = [
      { name: 'BTM Layout 2nd Stage', pincode: '560076', latitude: 12.9166, longitude: 77.6101 },
      { name: 'Jayanagar', pincode: '560041', latitude: 12.925, longitude: 77.5838 },
    ];

    it('picks the nearest area centre within the limit, and none beyond it', () => {
      // ~700 m and ~1.5 km north of BTM's centre.
      expect(nearestArea(areas, { latitude: 12.9229, longitude: 77.6101 })?.name).toBe('BTM Layout 2nd Stage');
      expect(nearestArea(areas, { latitude: 12.9301, longitude: 77.6101 })).toBeNull();
      expect(nearestArea(areas, { latitude: 12.9301, longitude: 77.6101 }, 2000)?.name).toBe('BTM Layout 2nd Stage');
    });

    async function setPin(user: ReturnType<typeof userEvent.setup>, coords: string) {
      await user.click(screen.getByRole('button', { name: /Set pin|Pin set · change/ }));
      const input = await screen.findByLabelText(/Address, Google Maps link or coordinates/);
      await user.clear(input);
      await user.type(input, coords);
      await user.click(screen.getByRole('button', { name: 'Find on the map' }));
      // 21 Nov: the pin is shown on the map to confirm before it is used.
      expect(await screen.findByText('Is this the right place?')).toBeInTheDocument();
      await user.click(screen.getByRole('button', { name: 'Yes, use this pin' }));
    }

    it('finds the pin from a typed address and shows it on the map to confirm (21 Nov)', async () => {
      const user = userEvent.setup();
      const api = mockApi(
        routes({
          'GET /screens/call-registration/options': { city: 'Bengaluru', areas, areaAutoFillMaxMeters: 1000 },
          'POST /maps-link/locate': {
            latitude: 12.9229,
            longitude: 77.6101,
            source: 'address',
            placeName: null,
            matched: '16th Main Road, BTM Layout 2nd Stage, Bengaluru, 560076, India',
            address: { pincode: '560076', area: 'BTM Layout', city: 'Bengaluru', displayName: '16th Main Road, BTM Layout 2nd Stage, Bengaluru, 560076, India' },
            shortLink: false,
          },
        }),
      );
      signInAs('call_agent');
      sessionStorage.setItem('laboura.draft.business.staff-ca', JSON.stringify({ ...form, place: { area: '', pincode: '', latitude: null, longitude: null } }));
      renderScreen(<RegisterBusiness />, { portal: 'call-agent', path: '/call-agent/register/business' });
      const area = (await screen.findByLabelText(/Area \(from the list\)/)) as HTMLSelectElement;
      await waitFor(() => expect(area.options.length).toBeGreaterThan(2));
      await user.click(screen.getByRole('button', { name: /Set pin/ }));
      await user.type(await screen.findByLabelText(/Address, Google Maps link or coordinates/), '16th Main Road, BTM 2nd Stage');
      await user.click(screen.getByRole('button', { name: 'Find on the map' }));
      expect(await screen.findByText('Is this the right place?')).toBeInTheDocument();
      expect(screen.getByText('16th Main Road, BTM Layout 2nd Stage, Bengaluru, 560076, India')).toBeInTheDocument();
      expect(screen.getByTestId('pin-map')).toBeInTheDocument();
      expect(api.calls('POST /maps-link/locate')[0].body).toEqual({ text: '16th Main Road, BTM 2nd Stage' });
      await user.click(screen.getByRole('button', { name: 'Yes, use this pin' }));
      await waitFor(() => expect(area.value).toBe('BTM Layout 2nd Stage'));
      expect(screen.getByText('At 12.9229, 77.6101')).toBeInTheDocument();
    });

    it('shows the server’s reason when an address or link cannot be read, and "No, search again" keeps the old pin', async () => {
      const user = userEvent.setup();
      mockApi(
        routes({
          'POST /maps-link/locate': { status: 422, body: { statusCode: 422, message: 'Couldn’t find that address. Add the area and city.', details: { code: 'MAPS_ADDRESS_NOT_FOUND' } } },
        }),
      );
      signInAs('call_agent');
      sessionStorage.setItem('laboura.draft.business.staff-ca', JSON.stringify({ ...form }));
      renderScreen(<RegisterBusiness />, { portal: 'call-agent', path: '/call-agent/register/business' });
      await user.click(await screen.findByRole('button', { name: /Pin set · change/ }));
      const input = await screen.findByLabelText(/Address, Google Maps link or coordinates/);
      await user.clear(input);
      await user.type(input, 'Nowhere street');
      await user.click(screen.getByRole('button', { name: 'Find on the map' }));
      expect(await screen.findByText('Couldn’t find that address. Add the area and city.')).toBeInTheDocument();
      expect(screen.queryByText('Is this the right place?')).toBeNull();
    });

    it('fills the area in from a pin within 1 km, and asks the agent to pick when none is that close', async () => {
      const user = userEvent.setup();
      mockApi(routes({ 'GET /screens/call-registration/options': { city: 'Bengaluru', areas, areaAutoFillMaxMeters: 1000 } }));
      signInAs('call_agent');
      sessionStorage.setItem('laboura.draft.business.staff-ca', JSON.stringify({ ...form, place: { area: '', pincode: '', latitude: null, longitude: null } }));
      renderScreen(<RegisterBusiness />, { portal: 'call-agent', path: '/call-agent/register/business' });
      const area = (await screen.findByLabelText(/Area \(from the list\)/)) as HTMLSelectElement;
      await waitFor(() => expect(area.options.length).toBeGreaterThan(2));

      await setPin(user, '12.9229, 77.6101');
      await waitFor(() => expect(area.value).toBe('BTM Layout 2nd Stage'));
      expect(screen.getByText(/Filled in from the map pin/)).toBeInTheDocument();

      await setPin(user, '12.9301, 77.6101');
      await waitFor(() => expect(area.value).toBe(''));
      expect(screen.getByText('Pick the area — no area is within 1 km of this shop')).toBeInTheDocument();

      // The agent picks; the shop's own pin stays where it was.
      await user.selectOptions(area, 'Jayanagar');
      expect(area.value).toBe('Jayanagar');
      expect(screen.getByText('At 12.9301, 77.6101')).toBeInTheDocument();
      expect(screen.queryByText('Pick the area — no area is within 1 km of this shop')).not.toBeInTheDocument();
    });

    it('shows the server refusal as "pick the area" in the agent’s language', async () => {
      const user = userEvent.setup();
      mockApi(
        routes({
          'POST /businesses': {
            status: 400,
            body: { statusCode: 400, message: 'Pick the area — no area is within 1 km of this shop', details: { code: 'area_required', maxMeters: 1000 } },
          },
        }),
      );
      signInAs('call_agent');
      sessionStorage.setItem('laboura.draft.business.staff-ca', JSON.stringify({ ...form, staff: [] }));
      renderScreen(<RegisterBusiness />, { portal: 'call-agent', path: '/call-agent/register/business' });
      await verify(user);
      await user.click(screen.getByRole('button', { name: 'Save business' }));
      expect(await screen.findByText('Pick the area — no area is within 1 km of this shop')).toBeInTheDocument();
    });
  });

  it('a household gives a family name and no documents', () => {
    const body = businessBody({ ...form, businessType: 'household', familyName: 'Rao family', staff: [] }, 'otp', []);
    expect(body).toMatchObject({ familyName: 'Rao family' });
    expect(body).not.toHaveProperty('gstNumber');
    expect(body).not.toHaveProperty('legalName');
    const noDocs = businessBody({ ...form, noDocuments: true }, 'otp', []);
    expect(noDocs).toMatchObject({ noDocuments: true });
    expect(noDocs).not.toHaveProperty('gstNumber');
  });

  it('22 Nov (rev 207–208): grouped business types with a search, Other needs the type in words, and "Same as the shop name"', async () => {
    const user = userEvent.setup();
    const api = mockApi(routes({ 'POST /businesses': { id: 'biz-9', code: 'BZ-00319' }, 'POST /businesses/biz-9/agreement-links': { success: true } }));
    signInAs('call_agent');
    sessionStorage.setItem('laboura.draft.business.staff-ca', JSON.stringify({ ...form, staff: [], businessType: '' }));
    renderScreen(<RegisterBusiness />, { portal: 'call-agent', path: '/call-agent/register/business' });
    await verify(user);
    const select = screen.getByLabelText(/Type of business/) as HTMLSelectElement;
    const groups = Array.from(select.querySelectorAll('optgroup')).map((g) => g.label);
    expect(groups[0]).toBe('Food & hospitality');
    expect(groups).toContain('Agriculture');
    await user.type(screen.getByLabelText('Search business types'), 'tea');
    expect(select.querySelectorAll('option[value="tea_coffee_stall"]')).toHaveLength(1);
    expect(select.querySelector('option[value="dairy"]')).toBeNull();
    await user.clear(screen.getByLabelText('Search business types'));
    await user.selectOptions(select, 'other');
    await user.click(screen.getByRole('button', { name: 'Save business' }));
    expect(api.calls('POST /businesses')).toHaveLength(0);
    expect(screen.getByText('Type what kind of business it is.')).toBeInTheDocument();
    await user.type(screen.getByLabelText(/What kind of business/), 'Flower shop');
    await user.click(screen.getByLabelText('Same as the shop name'));
    expect((screen.getByLabelText(/Legal name/) as HTMLInputElement).value).toBe('Annapoorna Mess');
    expect((screen.getByLabelText(/Legal name/) as HTMLInputElement).readOnly).toBe(true);
    await user.click(screen.getByRole('button', { name: 'Save business' }));
    await waitFor(() => expect(api.calls('POST /businesses')).toHaveLength(1));
    expect(api.calls('POST /businesses')[0].body).toMatchObject({ businessType: 'other', businessTypeOther: 'Flower shop', legalName: 'Annapoorna Mess' });
  });

  it('22 Nov (rev 208): the call agent finds the address (typed or a Maps link), checks it on the map, and it fills the street, area, PIN code and pin', async () => {
    const user = userEvent.setup();
    const api = mockApi(
      routes({
        'POST /maps-link/locate': {
          latitude: 12.9165, longitude: 77.6102, source: 'address', placeName: null, matched: '16th Main Road, BTM Layout 2nd Stage, Bengaluru 560076', shortLink: false,
          address: { shopNumber: null, street: '16th Main Road, BTM Layout 2nd Stage', area: 'BTM Layout 2nd Stage', city: 'Bengaluru', state: 'Karnataka', pincode: '560076', displayName: '16th Main Road, BTM Layout 2nd Stage, Bengaluru 560076', locality: 'BTM Layout 2nd Stage' },
        },
      }),
    );
    signInAs('call_agent');
    sessionStorage.setItem('laboura.draft.business.staff-ca', JSON.stringify({ ...form, street: '', place: { area: '', pincode: '', latitude: null, longitude: null } }));
    renderScreen(<RegisterBusiness />, { portal: 'call-agent', path: '/call-agent/register/business' });
    await user.type(await screen.findByLabelText(/Find the address/), '1273 45th Cross, BTM');
    await user.click(screen.getByRole('button', { name: /Find on the map/ }));
    await screen.findByTestId('address-preview');
    expect(api.calls('POST /maps-link/locate')[0].body).toEqual({ text: '1273 45th Cross, BTM' });
    expect(screen.getByTestId('address-words')).toHaveTextContent('16th Main Road, BTM Layout 2nd Stage, Bengaluru 560076');
    await user.click(screen.getByRole('button', { name: 'Yes, fill the address' }));
    expect((screen.getByLabelText(/^Street/) as HTMLInputElement).value).toBe('16th Main Road, BTM Layout 2nd Stage');
    expect(screen.getByTestId('address-filled')).toHaveTextContent(/Add the shop number, floor or street/);
    // The agent's own shop number stays.
    expect((screen.getByLabelText(/Shop \/ building number/) as HTMLInputElement).value).toBe('No. 14, 1st floor');
  });
});
