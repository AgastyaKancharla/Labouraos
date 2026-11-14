import { fireEvent, screen, waitFor } from '@testing-library/react-native';
import { ApiError } from '@/api/errors';
import { todayKeyIst } from '@/components/form';
import { account, bizProfile } from '@/test/fixtures';
import { fakeApi, renderWithApp } from '@/test/render';
import { emptyBusiness, toBusinessForm, validateBusiness } from './form';
import RegisterBusiness from './index';

jest.mock('expo-router', () => require('@/test/expo-router-mock'));
jest.mock('@/sheet/openSheet', () => ({ openSecureSheet: jest.fn(async () => 'returned') }));

beforeEach(() => jest.clearAllMocks());

async function choose(testID: string, value: string) {
  await fireEvent.press(screen.getByTestId(testID));
  await fireEvent.press(screen.getByTestId(`${testID}-option-${value}`));
}

describe('business form rules', () => {
  it('needs the contact person, business, address and at least one staff row; documents are optional', () => {
    const errors = validateBusiness(emptyBusiness());
    expect(Object.keys(errors)).toEqual(expect.arrayContaining(['contactName', 'contactRole', 'boardName', 'businessType', 'employeeBand', 'street', 'area', 'pincode', 'staffTrade0', 'staffMin0', 'staffSalary0', 'staffStart0']));
    expect(errors.gstin).toBeUndefined();
  });

  it('checks a GSTIN or email only when given', () => {
    expect(validateBusiness({ ...emptyBusiness(), gstin: '12345' }).gstin).toBe('business.gstinInvalid');
    expect(validateBusiness({ ...emptyBusiness(), billingEmail: 'nope' }).billingEmail).toBe('business.emailInvalid');
  });

  it('sends no document numbers when "I have no documents" is ticked, and the board name as legal name if empty', () => {
    const form = toBusinessForm({ ...emptyBusiness(), boardName: 'Test Tiffins', gstin: '29ABCDE1234F1Z5', noDocuments: true });
    expect(form.documents).toEqual({});
    expect(form.legalName).toBe('Test Tiffins');
  });

  it('never offers "household" (open question, kept hidden)', async () => {
    await renderWithApp(<RegisterBusiness />, { account: account() });
    await fireEvent.press(await screen.findByTestId('biz-type'));
    expect(screen.queryByTestId('biz-type-option-household')).toBeNull();
    expect(screen.getByTestId('biz-type-option-bakery')).toBeTruthy();
  });
});

describe('Register a business', () => {
  it('shows what is missing and sends nothing', async () => {
    const api = fakeApi();
    await renderWithApp(<RegisterBusiness />, { api, account: account() });
    await fireEvent.press(await screen.findByTestId('biz-submit'));
    expect(screen.getByTestId('biz-errors')).toBeTruthy();
    expect(screen.getByTestId('biz-contact-role-error')).toBeTruthy();
    expect(api.registerBusiness).not.toHaveBeenCalled();
  });

  it('confirms with a fresh OTP, sends staff rows as draft vacancies, then offers the agreement', async () => {
    let first = true;
    const api = fakeApi({
      registerBusiness: async () => {
        if (first) {
          first = false;
          throw new ApiError({ status: 400, messages: ['bad'], body: { code: 'OTP_INVALID', attemptsLeft: 4 } });
        }
        return { profile: bizProfile, existing: false };
      },
      sheetLink: async () => ({ url: 'https://app.test/p/agreement/tok' }),
    });
    await renderWithApp(<RegisterBusiness />, { api, account: account() });
    await fireEvent.changeText(await screen.findByTestId('biz-contact-name'), 'Shankar');
    await choose('biz-contact-role', 'owner');
    await fireEvent.changeText(screen.getByTestId('biz-board-name'), 'Test Tiffins');
    await choose('biz-type', 'restaurant_hotel');
    await choose('biz-employees', '1-5');
    await fireEvent.changeText(screen.getByTestId('biz-street'), '1st Main');
    await choose('biz-area', 'JP Nagar');
    await choose('biz-staff-trade-0', 'Cook');
    await fireEvent.changeText(screen.getByTestId('biz-staff-count-0'), '2');
    await fireEvent.changeText(screen.getByTestId('biz-staff-min-0'), '18000');
    await fireEvent.changeText(screen.getByTestId('biz-staff-max-0'), '22000');
    await fireEvent.press(screen.getByTestId('biz-staff-start-0'));
    await fireEvent.press(screen.getByTestId(`biz-staff-start-0-day-${todayKeyIst()}`));
    await fireEvent.changeText(screen.getByTestId('biz-gstin'), '29abcde1234f1z5');
    await fireEvent.press(screen.getByTestId('biz-submit'));
    await fireEvent.press(await screen.findByTestId('biz-register-otp-send'));
    await fireEvent.changeText(await screen.findByTestId('biz-register-otp-code'), '111111');
    expect(await screen.findByTestId('biz-register-otp-error')).toHaveTextContent('That code is not right. 4 tries left.');
    await fireEvent.changeText(screen.getByTestId('biz-register-otp-code'), '123456');
    await waitFor(() => expect(api.registerBusiness).toHaveBeenCalledTimes(2));
    expect(api.registerBusiness.mock.calls[1][1]).toEqual({ requestId: 'step-1', code: '123456' });
    expect(api.registerBusiness.mock.calls[0][0]).toEqual(
      expect.objectContaining({
        contactName: 'Shankar',
        contactRole: 'owner',
        boardName: 'Test Tiffins',
        businessType: 'restaurant_hotel',
        employeeBand: '1-5',
        area: 'JP Nagar',
        pincode: '560078',
        documents: { gstin: '29ABCDE1234F1Z5' },
        staffNeeded: [expect.objectContaining({ trade: 'Cook', count: 2, salaryMinPaise: 1_800_000, salaryMaxPaise: 2_200_000, startDate: todayKeyIst() })],
        visitPreferredAt: null,
      }),
    );
    expect(await screen.findByTestId('biz-saved')).toHaveTextContent(/Sign the Laboura agreement by OTP/);
    await fireEvent.press(screen.getByTestId('biz-saved-continue'));
    await waitFor(() => expect(api.sheetLink).toHaveBeenCalledWith('p-biz', 'business_agreement', undefined));
  });
});
