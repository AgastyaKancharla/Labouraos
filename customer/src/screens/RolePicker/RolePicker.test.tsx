import { fireEvent, screen, waitFor } from '@testing-library/react-native';
import { router } from 'expo-router';
import { account, bizProfile, jsProfile, refProfile } from '@/test/fixtures';
import { fakeApi, renderWithApp } from '@/test/render';
import MyProfiles from '../MyProfiles';
import RolePicker from './index';

jest.mock('expo-router', () => require('@/test/expo-router-mock'));

beforeEach(() => jest.clearAllMocks());

describe('Role picker', () => {
  it('first sign-in: three large choices, each opens its registration', async () => {
    await renderWithApp(<RolePicker />, { account: account() });
    expect(await screen.findByText('What do you want to do?')).toBeTruthy();
    expect(screen.getByTestId('role-job_seeker')).toHaveTextContent(/I want a job/);
    expect(screen.getByTestId('role-business')).toHaveTextContent(/I need staff/);
    expect(screen.getByTestId('role-referral_partner')).toHaveTextContent(/I refer people and earn/);
    await fireEvent.press(screen.getByTestId('role-business'));
    await waitFor(() => expect(router.push).toHaveBeenCalledWith('/register/business'));
    await fireEvent.press(screen.getByTestId('role-job_seeker'));
    await waitFor(() => expect(router.push).toHaveBeenCalledWith('/register/job-seeker'));
  });

  it('starts the sign-up on the server (tracker stage A); an existing profile of that kind opens instead', async () => {
    const api = fakeApi({ startSignup: async () => ({ existingProfileId: 'p-js' }), me: async () => account({ profiles: [] }) });
    await renderWithApp(<RolePicker />, { api, account: account() });
    await fireEvent.press(await screen.findByTestId('role-job_seeker'));
    await waitFor(() => expect(api.startSignup).toHaveBeenCalledWith('job_seeker'));
    await waitFor(() => expect(router.replace).toHaveBeenCalledWith('/home'));
    expect(router.push).not.toHaveBeenCalled();
  });

  it('one mobile number is one job seeker and one partner; a second business is allowed', async () => {
    await renderWithApp(<RolePicker />, { account: account({ profiles: [jsProfile, refProfile, bizProfile] }) });
    expect(await screen.findByText('Add a profile')).toBeTruthy();
    expect(screen.getByTestId('role-job_seeker')).toBeDisabled();
    expect(screen.getByTestId('role-referral_partner')).toBeDisabled();
    expect(screen.getByTestId('role-job_seeker')).toHaveTextContent(/Already added/);
    expect(screen.getByTestId('role-business')).not.toBeDisabled();
  });
});

describe('My profiles', () => {
  it('lists every profile, switches Home to the one tapped, and offers "+ Add another"', async () => {
    const api = fakeApi();
    const { storage } = await renderWithApp(<MyProfiles />, { api, account: account({ profiles: [jsProfile, refProfile] }) });
    expect(await screen.findByText('Ravi · JS-1234')).toBeTruthy();
    expect(screen.getByText('Test Partner · RF-0042')).toBeTruthy();
    await fireEvent.press(screen.getByTestId('profile-p-ref'));
    expect(router.replace).toHaveBeenCalledWith('/home');
    expect(await storage.getItem('laboura_active_profile')).toBe('p-ref');
    expect(api.setLastProfile).toHaveBeenCalledWith('p-ref');
    await fireEvent.press(screen.getByTestId('profiles-add'));
    expect(router.push).toHaveBeenCalledWith('/role');
  });
});
