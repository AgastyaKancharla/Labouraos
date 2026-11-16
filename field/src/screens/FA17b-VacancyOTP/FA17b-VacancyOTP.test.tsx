import { act, fireEvent, screen, waitFor } from '@testing-library/react-native';
import { useLocalSearchParams } from 'expo-router';
import { router, segments } from '@/test/expo-router-mock';
import { kiran, renderWithApp } from '@/test/render';
import { routeTable } from '@/test/selling-fixtures';
import { businessPage, pageVacancy, viewOnlyPage } from '@/test/redesign-fixtures';
import VacancyOtpScreen, { VACANCY_POLL_MS } from '.';

jest.mock('expo-router', () => require('@/test/expo-router-mock'));

beforeEach(() => {
  jest.clearAllMocks();
  segments.current = ['(app)', '(tabs)', 'businesses', 'vacancy', '[id]'];
});

afterEach(() => {
  jest.useRealTimers();
});

const raw = (id: string, status: string) => ({ id, code: 'VC', businessId: 'b-1', status, confirmedAt: null, confirmedByName: null });

describe('FA17b a vacancy and its next step', () => {
  it('waiting: uses the code already sent; the owner reads it out; or a link is sent for later; confirmed → Show candidates', async () => {
    (useLocalSearchParams as jest.Mock).mockReturnValue({ id: 'vac-2', otp: 'otp-3', last4: '4321' });
    let confirmed = false;
    const { route, calls } = routeTable({
      '/vacancies/vac-2': () => ({ status: 200, body: { ...raw('vac-2', confirmed ? 'open' : 'awaiting_confirmation'), confirmedAt: confirmed ? '2026-11-11T07:10:00Z' : null, confirmedByName: confirmed ? 'Manjunath' : null } }),
      '/field-work/businesses/b-1/page': () => {
        const page = businessPage();
        if (confirmed) page.vacancies[1] = { ...page.vacancies[1], status: 'open', nextStep: { kind: 'show_candidates', shown: 0 } };
        return { status: 200, body: page };
      },
      'POST /vacancies/vac-2/confirm': () => {
        confirmed = true;
        return { status: 201, body: {} };
      },
      'POST /vacancies/vac-2/confirmation-link': { expiresAt: '', sentToLast4: '4321' },
    });
    await renderWithApp(<VacancyOtpScreen />, { signedInAs: kiran, route });
    await waitFor(() => screen.getByTestId('vacancy-otp-sent'));
    expect(screen.getByText(/We sent an OTP to Manjunath \(owner, \*\*\*\*\*\*4321\)/)).toBeTruthy();
    expect(screen.getByTestId('show-matches')).toBeDisabled();
    await fireEvent.press(screen.getByTestId('send-link'));
    await waitFor(() => expect(screen.getByTestId('send-link')).toHaveTextContent('Link sent to ******4321'));
    await fireEvent.changeText(screen.getByTestId('vacancy-otp-code'), '714026');
    await waitFor(() => screen.getByTestId('vacancy-confirmed'));
    expect(calls).toContainEqual({ method: 'POST', path: '/vacancies/vac-2/confirm', body: { otpRequestId: 'otp-3', code: '714026', method: 'code_on_visit' } });
    expect(screen.getByTestId('show-matches')).not.toBeDisabled();
    await fireEvent.press(screen.getByTestId('show-matches'));
    expect(router.replace).toHaveBeenCalledWith('/businesses/candidates/b-1?vacancyId=vac-2');
  });

  it('draft from the business form: "Check and send to owner" moves it on, then the owner’s code is entered here (never "this one is draft")', async () => {
    (useLocalSearchParams as jest.Mock).mockReturnValue({ id: 'vac-1' });
    const { route, calls } = routeTable({
      '/vacancies/vac-1': raw('vac-1', 'draft'),
      '/field-work/businesses/b-1/page': businessPage(),
      'POST /vacancies/vac-1/submit-for-confirmation': { id: 'vac-1', code: 'VC-00031', status: 'awaiting_confirmation', confirmation: { otpRequestId: 'otp-7', sentToLast4: '4321', contactName: 'Manjunath' } },
    });
    await renderWithApp(<VacancyOtpScreen />, { signedInAs: kiran, route });
    await waitFor(() => screen.getByTestId('vacancy-draft'));
    expect(screen.getByTestId('vacancy-draft')).toHaveTextContent(/Read the details to Manjunath/);
    expect(screen.queryByTestId('vacancy-otp-send')).toBeNull();
    await fireEvent.press(screen.getByTestId('vacancy-send'));
    await waitFor(() => screen.getByTestId('vacancy-otp-sent'));
    expect(calls).toContainEqual({ method: 'POST', path: '/vacancies/vac-1/submit-for-confirmation', body: {} });
    expect(calls.some((c) => c.path.includes('/confirmation/send-code'))).toBe(false);
    expect(screen.getByText(/We sent an OTP to Manjunath/)).toBeTruthy();
  });

  it('a draft whose salary is below the legal minimum needs the "owner told" tick; a server refusal is explained', async () => {
    (useLocalSearchParams as jest.Mock).mockReturnValue({ id: 'vac-1' });
    const page = businessPage({ vacancies: [pageVacancy({ nextStep: { kind: 'send_to_owner', missing: [], needsMinimumWageTick: true, legalMinimumPaise: 1600000 } })] });
    const { route } = routeTable({
      '/vacancies/vac-1': raw('vac-1', 'draft'),
      '/field-work/businesses/b-1/page': page,
      'POST /vacancies/vac-1/submit-for-confirmation': () => ({ status: 400, body: { statusCode: 400, code: 'DRAFT_CHANGED', message: 'changed' } }),
    });
    await renderWithApp(<VacancyOtpScreen />, { signedInAs: kiran, route });
    await waitFor(() => screen.getByTestId('vacancy-send'));
    expect(screen.getByTestId('vacancy-send')).toBeDisabled();
    await fireEvent.press(screen.getByTestId('vacancy-told'));
    await fireEvent.press(screen.getByTestId('vacancy-send'));
    await waitFor(() => expect(screen.getByTestId('vacancy-send-error')).toHaveTextContent(/changed just now/));
  });

  it('another agent’s business: view only, no code, no link', async () => {
    (useLocalSearchParams as jest.Mock).mockReturnValue({ id: 'vac-1' });
    const { route } = routeTable({ '/vacancies/vac-1': raw('vac-1', 'awaiting_confirmation'), '/field-work/businesses/b-1/page': viewOnlyPage() });
    await renderWithApp(<VacancyOtpScreen />, { signedInAs: kiran, route });
    await waitFor(() => screen.getByTestId('vacancy-view-only'));
    expect(screen.queryByTestId('vacancy-otp-send')).toBeNull();
    expect(screen.queryByTestId('send-link')).toBeNull();
    expect(screen.getByTestId('show-matches')).toBeDisabled();
  });

  it('waiting: looks again every few seconds, shows the owner\'s confirmation from his link, refreshes the business page, then stops (A3)', async () => {
    jest.useFakeTimers();
    (useLocalSearchParams as jest.Mock).mockReturnValue({ id: 'vac-2', otp: 'otp-3', last4: '4321' });
    let confirmed = false;
    let reads = 0;
    const { route } = routeTable({
      '/vacancies/vac-2': () => {
        reads += 1;
        return { status: 200, body: { ...raw('vac-2', confirmed ? 'open' : 'awaiting_confirmation'), confirmedAt: confirmed ? '2026-11-11T07:10:00Z' : null, confirmedByName: confirmed ? 'Manjunath' : null } };
      },
      '/field-work/businesses/b-1/page': () => {
        const page = businessPage();
        if (confirmed) page.vacancies[1] = { ...page.vacancies[1], status: 'open', nextStep: { kind: 'show_candidates', shown: 0 } };
        return { status: 200, body: page };
      },
    });
    const { queryClient } = await renderWithApp(<VacancyOtpScreen />, { signedInAs: kiran, route });
    await waitFor(() => screen.getByTestId('vacancy-otp-sent'));
    expect(screen.getByTestId('vacancy-watching')).toBeTruthy();
    const invalidate = jest.spyOn(queryClient, 'invalidateQueries');
    const before = reads;
    await act(async () => {
      await jest.advanceTimersByTimeAsync(VACANCY_POLL_MS + 100);
    });
    expect(reads).toBeGreaterThan(before);
    expect(screen.queryByTestId('vacancy-confirmed')).toBeNull();
    // The owner confirms from the SMS link, on his own phone.
    confirmed = true;
    await act(async () => {
      await jest.advanceTimersByTimeAsync(VACANCY_POLL_MS + 100);
    });
    await waitFor(() => screen.getByTestId('vacancy-confirmed'));
    expect(screen.getByTestId('vacancy-confirmed')).toHaveTextContent(/Manjunath/);
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['field-work'] });
    expect(screen.getByTestId('show-matches')).not.toBeDisabled();
    const afterConfirm = reads;
    await act(async () => {
      await jest.advanceTimersByTimeAsync(VACANCY_POLL_MS * 3);
    });
    expect(reads).toBe(afterConfirm);
  });

  it('stops looking once the screen is closed (A3)', async () => {
    jest.useFakeTimers();
    (useLocalSearchParams as jest.Mock).mockReturnValue({ id: 'vac-2', otp: 'otp-3', last4: '4321' });
    let reads = 0;
    const { route } = routeTable({
      '/vacancies/vac-2': () => {
        reads += 1;
        return { status: 200, body: raw('vac-2', 'awaiting_confirmation') };
      },
      '/field-work/businesses/b-1/page': businessPage(),
    });
    const { unmount } = await renderWithApp(<VacancyOtpScreen />, { signedInAs: kiran, route });
    await waitFor(() => screen.getByTestId('vacancy-otp-sent'));
    await act(async () => {
      await jest.advanceTimersByTimeAsync(VACANCY_POLL_MS + 100);
    });
    expect(reads).toBeGreaterThan(1);
    await act(async () => {
      unmount();
    });
    const closedAt = reads;
    await act(async () => {
      await jest.advanceTimersByTimeAsync(VACANCY_POLL_MS * 3);
    });
    expect(reads).toBe(closedAt);
  });

  it('a draft or a confirmed vacancy is not polled', async () => {
    jest.useFakeTimers();
    (useLocalSearchParams as jest.Mock).mockReturnValue({ id: 'vac-1' });
    let reads = 0;
    const { route } = routeTable({
      '/vacancies/vac-1': () => {
        reads += 1;
        return { status: 200, body: raw('vac-1', 'draft') };
      },
      '/field-work/businesses/b-1/page': businessPage(),
    });
    await renderWithApp(<VacancyOtpScreen />, { signedInAs: kiran, route });
    await waitFor(() => screen.getByTestId('vacancy-draft'));
    const first = reads;
    await act(async () => {
      await jest.advanceTimersByTimeAsync(VACANCY_POLL_MS * 3);
    });
    expect(reads).toBe(first);
  });
});
