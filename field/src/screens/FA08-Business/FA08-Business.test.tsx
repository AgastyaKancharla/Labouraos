import { fireEvent, screen, waitFor } from '@testing-library/react-native';
import { router, searchParams, segments } from '@/test/expo-router-mock';
import { kiran, renderWithApp } from '@/test/render';
import { routeTable } from '@/test/selling-fixtures';
import { businessPage, viewOnlyPage } from '@/test/redesign-fixtures';
import BusinessScreen from '.';

jest.mock('expo-router', () => require('@/test/expo-router-mock'));

beforeEach(() => {
  jest.clearAllMocks();
  searchParams.current = { id: 'b-1' };
  segments.current = ['(app)', '(tabs)', 'businesses', '[id]'];
});

describe('FA08 the one business page', () => {
  it('my business: checklist with Resend agreement link, each vacancy with its one next step, candidates, visit history, Record a visit and Call owner', async () => {
    const { route, calls } = routeTable({
      '/field-work/businesses/b-1/page': businessPage(),
      'POST /field-work/businesses/b-1/agreement-link': { success: true, linkSentAt: '2026-11-16T05:31:00Z', linkExpiresAt: '2026-11-17T05:31:00Z', sentToLast4: '4321' },
      'POST /vacancies/vac-1/submit-for-confirmation': { id: 'vac-1', code: 'VC-00031', status: 'awaiting_confirmation', confirmation: { otpRequestId: 'otp-9', sentToLast4: '4321', contactName: 'Manjunath' } },
    });
    await renderWithApp(<BusinessScreen />, { signedInAs: kiran, route });
    await waitFor(() => screen.getByTestId('fa08-hero'));
    expect(screen.getByTestId('fa08-hero')).toHaveTextContent(/Sri Sai Bakery.*JP Nagar · BZ-00012/);
    expect(screen.getByTestId('fa08-agent')).toHaveTextContent(/Your business.*A vacancy to check and send to the owner/);
    expect(screen.queryByTestId('fa08-view-only')).toBeNull();
    // Checklist: registered, phone confirmed, agreement waiting with Resend, Team Lead check.
    expect(screen.getByTestId('fa08-check-agreement')).toHaveTextContent(/Agreement.*Link sent to \*\*\*\*\*\*4321.*Waiting/);
    expect(screen.getByTestId('fa08-check-tl')).toHaveTextContent(/Team Lead check.*Not yet/);
    await fireEvent.press(screen.getByTestId('fa08-resend'));
    await waitFor(() => expect(screen.getByTestId('fa08-resend')).toHaveTextContent('Sent again to ******4321'));
    expect(calls).toContainEqual({ method: 'POST', path: '/field-work/businesses/b-1/agreement-link', body: { language: 'kn' } });
    // Vacancies: draft → Check and send to owner (then the owner's code), waiting → code or link, confirmed → candidates.
    expect(screen.getByTestId('vacancy-vac-1')).toHaveTextContent(/Cook × 2 · ₹15,000–18,000.*Draft.*Check and send to owner/);
    expect(screen.getByTestId('vacancy-vac-2')).toHaveTextContent(/Helper.*Waiting for owner.*Enter owner’s code.*Resend link/);
    expect(screen.getByTestId('vacancy-vac-3')).toHaveTextContent(/Baker.*Confirmed.*Show candidates · 3 shown/);
    await fireEvent.press(screen.getByTestId('vacancy-vac-1-send'));
    await waitFor(() => expect(router.push).toHaveBeenCalledWith('/businesses/vacancy/vac-1?otp=otp-9&last4=4321'));
    expect(calls).toContainEqual({ method: 'POST', path: '/vacancies/vac-1/submit-for-confirmation', body: {} });
    await fireEvent.press(screen.getByTestId('vacancy-vac-2-code'));
    expect(router.push).toHaveBeenCalledWith('/businesses/vacancy/vac-2');
    await fireEvent.press(screen.getByTestId('vacancy-vac-3-show'));
    expect(router.push).toHaveBeenCalledWith('/businesses/candidates/b-1?vacancyId=vac-3');
    await fireEvent.press(screen.getByTestId('fa08-vacancy'));
    expect(router.push).toHaveBeenCalledWith('/businesses/vacancy/new?businessId=b-1');
    // Candidates and interviews; visit history opens my own visits only.
    expect(screen.getByTestId('fa08-candidates')).toHaveTextContent(/6 · 4 by you.*3 · 1 today · 1 coming.*1 · 1 in guarantee/);
    await fireEvent.press(screen.getByTestId('fa08-visit-v-1'));
    expect(router.push).toHaveBeenCalledWith('/businesses/visit/v-1');
    (router.push as jest.Mock).mockClear();
    await fireEvent.press(screen.getByTestId('fa08-visit-v-0'));
    expect(router.push).not.toHaveBeenCalled();
    await fireEvent.press(screen.getByTestId('fa08-visit'));
    expect(router.push).toHaveBeenCalledWith({ pathname: '/visit/start', params: { businessId: 'b-1', name: 'Sri Sai Bakery' } });
    await fireEvent.press(screen.getByTestId('fa08-call'));
    expect(router.push).toHaveBeenCalledWith('/businesses/call-owner?businessId=b-1');
  });

  it('a draft below the legal minimum needs the "owner told" tick before it can go', async () => {
    const page = businessPage({ vacancies: [businessPage().vacancies[0]] });
    page.vacancies[0].nextStep = { kind: 'send_to_owner', missing: [], needsMinimumWageTick: true, legalMinimumPaise: 1600000 };
    const { route, calls } = routeTable({
      '/field-work/businesses/b-1/page': page,
      'POST /vacancies/vac-1/submit-for-confirmation': { id: 'vac-1', code: 'VC-00031', status: 'awaiting_confirmation', confirmation: { error: 'sms failed' } },
    });
    await renderWithApp(<BusinessScreen />, { signedInAs: kiran, route });
    await waitFor(() => screen.getByTestId('vacancy-vac-1-send'));
    expect(screen.getByTestId('vacancy-vac-1-send')).toBeDisabled();
    await fireEvent.press(screen.getByTestId('vacancy-vac-1-told'));
    await fireEvent.press(screen.getByTestId('vacancy-vac-1-send'));
    await waitFor(() => expect(router.push).toHaveBeenCalledWith('/businesses/vacancy/vac-1'));
    expect(calls).toContainEqual({ method: 'POST', path: '/vacancies/vac-1/submit-for-confirmation', body: { ownerToldMinimumWage: true } });
  });

  it('another agent’s business is view-only: no contact, no actions, no vacancy steps', async () => {
    const { route } = routeTable({ '/field-work/businesses/b-1/page': viewOnlyPage() });
    await renderWithApp(<BusinessScreen />, { signedInAs: kiran, route });
    await waitFor(() => screen.getByTestId('fa08-view-only'));
    expect(screen.getByTestId('fa08-agent')).toHaveTextContent('Account agent: Ravi K');
    expect(screen.getByTestId('fa08-view-only')).toHaveTextContent(/View only.*belongs to another agent/);
    for (const id of ['fa08-visit', 'fa08-call', 'fa08-resend', 'fa08-vacancy', 'fa08-show', 'vacancy-vac-1-send', 'vacancy-vac-1-show']) {
      expect(screen.queryByTestId(id)).toBeNull();
    }
    expect(screen.getByTestId('vacancy-vac-1')).toHaveTextContent(/Cook × 2.*Confirmed/);
  });

  it('signed but no clean visit with a selfie: says why candidates are hidden', async () => {
    const page = businessPage({ status: { ...businessPage().status, canShowCandidates: false, candidatesHiddenReason: 'visit_outside_area' }, actions: { ...businessPage().actions, showCandidates: false } });
    const { route } = routeTable({ '/field-work/businesses/b-1/page': page });
    await renderWithApp(<BusinessScreen />, { signedInAs: kiran, route });
    await waitFor(() => screen.getByTestId('fa08-hidden'));
    expect(screen.getByTestId('fa08-hidden')).toHaveTextContent(/no visit with a selfie was inside the shop’s area/);
  });

  it('rev 189: a later visit to the onboarded business shows "Already onboarded" in the visit history', async () => {
    const page = businessPage();
    page.visits = [{ ...page.visits[0], id: 'v-5', outcome: 'already_onboarded' }, ...page.visits];
    const { route } = routeTable({ '/field-work/businesses/b-1/page': page });
    await renderWithApp(<BusinessScreen />, { signedInAs: kiran, route });
    await waitFor(() => screen.getByTestId('fa08-visit-v-5'));
    expect(screen.getByTestId('fa08-visit-v-5')).toHaveTextContent(/Already onboarded/);
    expect(screen.getByTestId('fa08-visit-v-1')).toHaveTextContent(/Onboarded/);
  });
});
