import { fireEvent, screen, waitFor } from '@testing-library/react-native';
import { router, searchParams, segments } from '@/test/expo-router-mock';
import { kiran, renderWithApp } from '@/test/render';
import { routeTable } from '@/test/selling-fixtures';
import { businessPage } from '@/test/redesign-fixtures';
import VisitDoneScreen from '.';

jest.mock('expo-router', () => require('@/test/expo-router-mock'));

const signed = () =>
  businessPage({ checklist: { ...businessPage().checklist, agreement: { state: 'signed', signedAt: '2026-11-16T06:18:00Z', signedByName: 'Manjunath' } } });

beforeEach(() => {
  jest.clearAllMocks();
  searchParams.current = { businessId: 'b-1', visitId: 'v-1' };
  segments.current = ['(app)', '(tabs)', '(visits)', 'visit', 'done'];
});

describe('FA06b candidates, step 7 of 7', () => {
  it('signed: shows candidates for each confirmed vacancy inside the Visits tab; never asks "How did the visit go?" again', async () => {
    const { route } = routeTable({ '/field-work/businesses/b-1/page': signed() });
    await renderWithApp(<VisitDoneScreen />, { signedInAs: kiran, route });
    await waitFor(() => screen.getByTestId('fa06b-banner'));
    expect(screen.getByTestId('step-counter')).toHaveTextContent('Step 7 of 7 · candidates');
    expect(screen.getByTestId('fa06b-banner')).toHaveTextContent(/Manjunath/);
    expect(screen.queryByTestId('fa06b-outcome')).toBeNull();
    expect(screen.queryByText(/Record visit outcome/)).toBeNull();
    await fireEvent.press(screen.getByTestId('fa06b-show-vac-3'));
    expect(router.push).toHaveBeenCalledWith('/visit/candidates/b-1?vacancyId=vac-3');
    await fireEvent.press(screen.getByTestId('fa06b-done'));
    expect(router.dismissTo).toHaveBeenCalledWith('/visits');
  });

  it('not signed yet: says why candidates are hidden, opens the agreement step, and offers Finish later', async () => {
    const page = businessPage({ status: { ...businessPage().status, canShowCandidates: false, candidatesHiddenReason: 'agreement_not_signed' } });
    const { route } = routeTable({ '/field-work/businesses/b-1/page': page });
    await renderWithApp(<VisitDoneScreen />, { signedInAs: kiran, route });
    await waitFor(() => screen.getByTestId('fa06b-hidden'));
    expect(screen.getByTestId('fa06b-hidden')).toHaveTextContent(/once the owner signs/);
    expect(screen.getByTestId('fa06b-show-vac-3')).toBeDisabled();
    await fireEvent.press(screen.getByTestId('fa06b-agreement'));
    expect(router.push).toHaveBeenCalledWith({ pathname: '/visit/agreement', params: { businessId: 'b-1', visitId: 'v-1' } });
    await fireEvent.press(screen.getByTestId('finish-later'));
    expect(router.dismissTo).toHaveBeenCalledWith('/visits');
  });

  it('"You are now its account agent" shows only after a verification visit that made him so', async () => {
    const { route } = routeTable({ '/field-work/businesses/b-1/page': signed() });
    await renderWithApp(<VisitDoneScreen />, { signedInAs: kiran, route });
    await waitFor(() => screen.getByTestId('fa06b-banner'));
    expect(screen.queryByText(/You are now its account agent/)).toBeNull();
    searchParams.current = { businessId: 'b-1', visitId: 'v-1', accountAgent: 'new' };
    await renderWithApp(<VisitDoneScreen />, { signedInAs: kiran, route });
    await waitFor(() => screen.getByTestId('fa06b-account-agent'));
    expect(screen.getByTestId('fa06b-account-agent')).toHaveTextContent(/You are now its account agent/);
  });
});
