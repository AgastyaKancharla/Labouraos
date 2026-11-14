import { fireEvent, screen, waitFor } from '@testing-library/react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { kiran, renderWithApp } from '@/test/render';
import { routeTable, seekerStatus as status } from '@/test/selling-fixtures';
import SeekerSaved from '.';

jest.mock('expo-router', () => require('@/test/expo-router-mock'));

describe('FA10b Saved — send the link', () => {
  it('shows the saved JS- ID and the steps, and sends the one registration link', async () => {
    (useLocalSearchParams as jest.Mock).mockReturnValue({ id: 'js-uuid' });
    const { route, calls } = routeTable({
      '/screens/call-registration/job-seekers/js-uuid': status(),
      'POST /consent/links': { expiresAt: '2026-11-13T05:00:00Z' },
    });
    await renderWithApp(<SeekerSaved />, { signedInAs: kiran, route });
    await waitFor(() => screen.getByTestId('seeker-banner'));
    expect(screen.getByTestId('seeker-banner')).toHaveTextContent('✓ Job seeker details saved · JS-1042');
    expect(screen.getByTestId('step-consent')).toHaveTextContent(/1 · ConsentNot sent yet/);
    expect(screen.getByTestId('step-payment')).toHaveTextContent(/4 · ₹499 paymentNot sent yet/);
    expect(screen.queryByTestId('other-payer')).toBeNull();
    await fireEvent.press(screen.getByTestId('send-link'));
    await waitFor(() => expect(router.replace).toHaveBeenCalledWith('/job-seeker/js-uuid'));
    expect(calls).toContainEqual({ method: 'POST', path: '/consent/links', body: { jobSeekerId: 'js-uuid' } });
  });

  it("previews what she'll see: the four steps in order, in plain words", async () => {
    (useLocalSearchParams as jest.Mock).mockReturnValue({ id: 'js-uuid' });
    const { route } = routeTable({ '/screens/call-registration/job-seekers/js-uuid': { ...status(), gender: 'female' } });
    await renderWithApp(<SeekerSaved />, { signedInAs: kiran, route });
    await waitFor(() => screen.getByTestId('preview'));
    expect(screen.getByTestId('preview')).toHaveTextContent('Preview what she’ll see');
    await fireEvent.press(screen.getByTestId('preview'));
    const card = screen.getByTestId('preview-card');
    expect(card).toHaveTextContent(/1 Consent — each purpose ticked separately/);
    expect(card).toHaveTextContent(/2 Selfie — live camera only/);
    expect(card).toHaveTextContent(/3 ID check — Aadhaar: scan the QR code on the card, or open the e-Aadhaar PDF/);
    expect(card).not.toHaveTextContent(/digi\s?locker/i);
    expect(card).toHaveTextContent(/4 ₹499 payment — their exact terms/);
  });
});
