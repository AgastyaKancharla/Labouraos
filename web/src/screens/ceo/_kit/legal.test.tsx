import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { mockApi, renderScreen, signInAs } from '../../../test/utils';
import { LegalAcceptanceCard } from './legal';

describe('LegalAcceptanceCard (legal documents, rev 176)', () => {
  it('shows each acceptance with "View signed copy", which opens the exact text with the staff token', async () => {
    signInAs('ceo');
    const api = mockApi({
      'GET /legal/acceptances/job_seeker/js-1': {
        status: { documentKey: 'job_seeker_terms', currentVersion: '1.1', acceptedVersion: '1.1', needsReconsent: false, noticeVersion: '1.2', currentNoticeVersion: '1.2' },
        acceptances: [
          { id: 'acc-1', documentKey: 'job_seeker_terms', version: '1.1', language: 'kn', context: 'registration', method: 'sms_link', otpRequestId: 'otp-1', noticeVersion: '1.2', purposes: [], acceptedAt: '2026-11-15T05:00:00Z' },
        ],
      },
      'GET /legal/acceptance-text/acc-1': '<html>signed</html>',
    });
    const open = vi.spyOn(window, 'open').mockImplementation(() => null);
    const createUrl = vi.fn(() => 'blob:signed');
    vi.stubGlobal('URL', Object.assign(URL, { createObjectURL: createUrl, revokeObjectURL: vi.fn() }));
    renderScreen(<LegalAcceptanceCard subjectType="job_seeker" subjectId="js-1" />);
    await userEvent.click(await screen.findByTestId('signed-copy-acc-1'));
    await waitFor(() => expect(open).toHaveBeenCalledWith('blob:signed', '_blank', 'noopener'));
    const [, init] = api.fetch.mock.calls.find(([input]) => String(input).includes('/legal/acceptance-text/acc-1'))!;
    expect((init as RequestInit).headers).toMatchObject({ Authorization: expect.stringMatching(/^Bearer /) });
    open.mockRestore();
  });
});
