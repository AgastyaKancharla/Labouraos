import { fireEvent, screen, waitFor } from '@testing-library/react-native';
import { router, searchParams } from '@/test/expo-router-mock';
import { kiran, renderWithApp } from '@/test/render';
import { saveDraft } from '../_visits/visitDraft';
import { businessBody, formErrors, type FormState } from './form';
import RegisterBusinessScreen from '.';

jest.mock('expo-router', () => require('@/test/expo-router-mock'));

const trades = [{ id: 't1', name: 'Cook', salaryMinPaise: 1800000, salaryMaxPaise: 3000000, minimumWageLevel: 'skilled', legalMinimumPaise: 2340000 }];

describe('FA07 Register a business', () => {
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
    await waitFor(() => expect(router.replace).toHaveBeenCalledWith({ pathname: '/visit/done', params: { businessId: 'b-new', visitId: 'v-7' } }));
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
