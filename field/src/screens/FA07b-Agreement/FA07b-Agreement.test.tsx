import { fireEvent, screen, waitFor } from '@testing-library/react-native';
import { router, searchParams, segments } from '@/test/expo-router-mock';
import { kiran, renderWithApp } from '@/test/render';
import { routeTable } from '@/test/selling-fixtures';
import { agreementStatus, legalDoc } from '@/test/redesign-fixtures';
import AgreementScreen from '.';

jest.mock('expo-router', () => require('@/test/expo-router-mock'));

beforeEach(() => {
  jest.clearAllMocks();
  searchParams.current = { businessId: 'b-1', visitId: 'v-1' };
  segments.current = ['(app)', '(tabs)', '(visits)', 'visit', 'agreement'];
});

const legal = {
  '/legal/documents/business_agreement': (_: RequestInit, url: string) => ({ status: 200, body: legalDoc('business_agreement', new URL(url).searchParams.get('lang') ?? 'en') }),
};

describe('FA07b agreement, step 5 of 7', () => {
  it('the owner signs on his own phone: shows where the link is, Resend link, the summary to read aloud, Next and Finish later', async () => {
    const { route, calls } = routeTable({
      '/field-work/businesses/b-1/agreement': agreementStatus(),
      'POST /field-work/businesses/b-1/agreement-link': { success: true, linkSentAt: '2026-11-16T05:40:00Z', linkExpiresAt: '2026-11-17T05:40:00Z', sentToLast4: '4321' },
      ...legal,
    });
    await renderWithApp(<AgreementScreen />, { signedInAs: kiran, route });
    await waitFor(() => screen.getByTestId('fa07b-waiting'));
    expect(screen.getByTestId('step-counter')).toHaveTextContent('Step 5 of 7 · agreement');
    expect(screen.getByTestId('fa07b-waiting')).toHaveTextContent(/signs on his own phone.*You never sign for him.*Link sent to \*\*\*\*\*\*4321 at 11:01 AM.*Waiting/);
    // The summary is the agreement's "In short" from the server, in English (rev 193); no language choice.
    await waitFor(() => expect(screen.getByTestId('fa07b-in-short')).toHaveTextContent(/You pay only when you select someone: 50%/));
    expect(screen.queryByTestId('fa07b-lang')).toBeNull();
    await fireEvent.press(screen.getByTestId('fa07b-resend'));
    await waitFor(() => expect(screen.getByTestId('fa07b-resend')).toHaveTextContent('Sent again to ******4321'));
    expect(calls).toContainEqual({ method: 'POST', path: '/field-work/businesses/b-1/agreement-link', body: {} });
    await fireEvent.press(screen.getByTestId('fa07b-next'));
    expect(router.push).toHaveBeenCalledWith({ pathname: '/visit/vacancies', params: { businessId: 'b-1', visitId: 'v-1' } });
    await fireEvent.press(screen.getByTestId('finish-later'));
    expect(router.dismissTo).toHaveBeenCalledWith('/visits');
  });

  it('turns green when he signs', async () => {
    const { route } = routeTable({
      '/field-work/businesses/b-1/agreement': agreementStatus({ state: 'signed', signedAt: '2026-11-16T05:50:00Z', signedByName: 'Manjunath', canResend: false, canShowCandidates: true, candidatesHiddenReason: null }),
      ...legal,
    });
    await renderWithApp(<AgreementScreen />, { signedInAs: kiran, route });
    await waitFor(() => screen.getByTestId('fa07b-signed'));
    expect(screen.getByTestId('fa07b-signed')).toHaveTextContent(/Signed by Manjunath/);
    expect(screen.queryByTestId('fa07b-resend')).toBeNull();
    expect(screen.getByTestId('fa07b-next')).toHaveTextContent('Next: vacancies');
  });

  it('the first SMS failed: says so; too many links: explains when to try again', async () => {
    searchParams.current = { businessId: 'b-1', linkFailed: '1' };
    const { route } = routeTable({
      '/field-work/businesses/b-1/agreement': agreementStatus({ state: 'not_sent', linkSentAt: null }),
      'POST /field-work/businesses/b-1/agreement-link': () => ({ status: 429, body: { statusCode: 429, code: 'AGREEMENT_RESEND_TOO_SOON', retryAt: '2026-11-16T05:45:00Z', message: 'too soon' } }),
      ...legal,
    });
    await renderWithApp(<AgreementScreen />, { signedInAs: kiran, route });
    await waitFor(() => screen.getByTestId('fa07b-first-failed'));
    expect(screen.getByTestId('fa07b-link')).toHaveTextContent(/No link has gone yet.*Not sent/);
    await fireEvent.press(screen.getByTestId('fa07b-resend'));
    await waitFor(() => expect(screen.getByTestId('fa07b-resend-error')).toHaveTextContent('Too many links just now. Try again at 11:15 AM.'));
  });

  it('25 Nov (B1): before the owner signs, the agent takes his live selfie and the second photo (choices for a small business)', async () => {
    const { route } = routeTable({
      '/field-work/businesses/b-1/agreement': agreementStatus({ ownerPhotos: { needed: true, selfie: false, shop: false, shopKinds: ['shop_board', 'workspace'], smallBusiness: true } }),
      ...legal,
    });
    await renderWithApp(<AgreementScreen />, { signedInAs: kiran, route });
    await waitFor(() => screen.getByTestId('fa07b-owner-photos'));
    expect(screen.getByTestId('fa07b-owner-photos')).toHaveTextContent(/Owner's selfie.*Shop's name board.*The place he works from/);
    expect(screen.getByTestId('fa07b-small-business')).toHaveTextContent(/Fewer than 2 proofs/);
    expect(screen.getByTestId('fa07b-take-selfie')).toBeTruthy();
    expect(screen.getByTestId('fa07b-take-workspace')).toBeTruthy();
  });

  it('25 Nov (B1): a household takes no owner photos (it keeps the visit)', async () => {
    const { route } = routeTable({
      '/field-work/businesses/b-1/agreement': agreementStatus({ ownerPhotos: { needed: false, selfie: false, shop: false, shopKinds: ['shop_board'], smallBusiness: false } }),
      ...legal,
    });
    await renderWithApp(<AgreementScreen />, { signedInAs: kiran, route });
    await waitFor(() => screen.getByTestId('fa07b-waiting'));
    expect(screen.queryByTestId('fa07b-owner-photos')).toBeNull();
  });
});
