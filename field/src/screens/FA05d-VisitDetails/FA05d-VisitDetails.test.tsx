import { fireEvent, screen, waitFor } from '@testing-library/react-native';
import { router, searchParams } from '@/test/expo-router-mock';
import { clearAllFormDrafts } from '@/lib/formDraft';
import { kiran, renderWithApp } from '@/test/render';
import { routeTable } from '@/test/selling-fixtures';
import { visitDetails } from '@/test/redesign-fixtures';
import VisitDetailsScreen from '.';

jest.mock('expo-router', () => require('@/test/expo-router-mock'));

beforeEach(() => {
  jest.clearAllMocks();
  clearAllFormDrafts();
  searchParams.current = { id: 'v-1' };
});

describe('FA05d Visit details', () => {
  it('shows the board photo, selfie, time at the shop, result, note and come-back date; Change result needs a reason and is kept in history', async () => {
    let changed = false;
    const { route, calls } = routeTable({
      '/field-visits/v-1': () => ({
        status: 200,
        body: changed
          ? visitDetails({
              outcome: 'interested_later',
              resultHistory: [{ at: '2026-11-16T05:00:00Z', byName: 'Kiran Kumar', byMe: true, from: { outcome: 'owner_not_there', outcomeReason: null, revisitOn: '2026-11-18' }, to: { outcome: 'interested_later', outcomeReason: null, revisitOn: '2026-11-18' }, reason: 'Owner called back, wants us on Tuesday' }],
            })
          : visitDetails(),
      }),
      'POST /field-visits/v-1/change-result': () => {
        changed = true;
        return { status: 201, body: visitDetails({ outcome: 'interested_later', resultHistory: [{ at: '2026-11-16T05:00:00Z', byName: 'Kiran Kumar', byMe: true, from: { outcome: 'owner_not_there', outcomeReason: null, revisitOn: '2026-11-18' }, to: { outcome: 'interested_later', outcomeReason: null, revisitOn: '2026-11-18' }, reason: 'Owner called back, wants us on Tuesday' }] }) };
      },
    });
    await renderWithApp(<VisitDetailsScreen />, { signedInAs: kiran, route });
    await waitFor(() => screen.getByTestId('fa05d-summary'));
    expect(screen.getByTestId('fa05d-result')).toHaveTextContent(/Result.*Owner not there/);
    expect(screen.getByTestId('fa05d-time')).toHaveTextContent(/18 min/);
    expect(screen.getByTestId('fa05d-revisit')).toHaveTextContent(/Wed 18 Nov/);
    expect(screen.getByTestId('fa05d-note')).toHaveTextContent(/Owner busy, come after 4/);
    expect(screen.getByTestId('fa05d-board')).toHaveTextContent(/Board photo/);
    expect(screen.getByTestId('fa05d-selfie')).toHaveTextContent(/Not taken/);
    await fireEvent.press(screen.getByTestId('fa05d-change'));
    await fireEvent.press(screen.getByTestId('fa05d-outcome-interested_later'));
    await fireEvent.press(screen.getAllByText('Tomorrow')[0]);
    await fireEvent.changeText(screen.getByTestId('fa05d-reason'), 'short');
    await fireEvent.press(screen.getByTestId('fa05d-change-save'));
    expect(screen.getByTestId('fa05d-change-problem')).toHaveTextContent(/at least 10 letters/);
    await fireEvent.changeText(screen.getByTestId('fa05d-reason'), 'Owner called back, wants us on Tuesday');
    await fireEvent.press(screen.getByTestId('fa05d-change-save'));
    await waitFor(() => screen.getByTestId('fa05d-history'));
    const body = calls.find((c) => c.path === '/field-visits/v-1/change-result')?.body as Record<string, string>;
    expect(body).toMatchObject({ outcome: 'interested_later', reason: 'Owner called back, wants us on Tuesday' });
    expect(body.revisitOn).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(screen.getByTestId('fa05d-history')).toHaveTextContent(/Owner not there · Wed 18 Nov → Come back · Wed 18 Nov.*you.*Owner called back/);
  });

  it('an onboarded visit cannot change its result', async () => {
    const { route } = routeTable({ '/field-visits/v-1': visitDetails({ outcome: 'onboarded', canChangeResult: false, revisitOn: null }) });
    await renderWithApp(<VisitDetailsScreen />, { signedInAs: kiran, route });
    await waitFor(() => screen.getByTestId('fa05d-locked'));
    expect(screen.queryByTestId('fa05d-change')).toBeNull();
  });

  it('an unfinished visit offers its next step: continue to the business form (resume an interrupted onboarding)', async () => {
    const { route } = routeTable({ '/field-visits/v-1': visitDetails({ outcome: null, canChangeResult: false, nextStep: 'continue_business_form', hasSelfie: true }) });
    await renderWithApp(<VisitDetailsScreen />, { signedInAs: kiran, route });
    await waitFor(() => screen.getByTestId('fa05d-next'));
    expect(screen.queryByTestId('fa05d-change')).toBeNull();
    await fireEvent.press(screen.getByTestId('fa05d-next-continue_business_form'));
    expect(router.push).toHaveBeenCalledWith({ pathname: '/visit/business', params: { visitId: 'v-1' } });
  });
});
