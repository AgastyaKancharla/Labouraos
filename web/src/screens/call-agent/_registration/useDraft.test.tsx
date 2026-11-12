import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AppProviders, createQueryClient } from '../../../App';
import { signInAs } from '../../../test/utils';
import { clearDraft, draftKey, readDraft, useDraft, withoutOtp } from './useDraft';

interface Form {
  name: string;
  otp: string;
  otpRequestId: string | null;
  referredBy: { code: string; name: string } | null;
}
const EMPTY: Form = { name: '', otp: '', otpRequestId: null, referredBy: null };

function DraftForm({ onClear }: { onClear?: (clear: () => void) => void }) {
  const [form, setForm, draft] = useDraft<Form>('test-form', EMPTY);
  onClear?.(draft.clear);
  return (
    <div>
      <label>
        Name
        <input value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} />
      </label>
      <button type="button" onClick={() => setForm((f) => ({ ...f, otp: '482913', otpRequestId: 'req-1', referredBy: { code: 'RF-0012', name: 'Asha' } }))}>
        fill otp
      </button>
      {draft.restored && <p>restored</p>}
    </div>
  );
}

function mount(onClear?: (clear: () => void) => void) {
  return render(
    <AppProviders queryClient={createQueryClient()}>
      <DraftForm onClear={onClear} />
    </AppProviders>,
  );
}

describe('registration drafts', () => {
  afterEach(() => vi.useRealTimers());

  it('survive closing the tab (localStorage), never keep an OTP, and are cleared on submit', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const staff = signInAs('call_agent');
    const key = draftKey('test-form', staff.id);
    const first = mount();
    await userEvent.type(screen.getByLabelText('Name'), 'Ramesh');
    await userEvent.click(screen.getByRole('button', { name: 'fill otp' }));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(500);
    });
    const saved = JSON.parse(localStorage.getItem(key)!);
    expect(saved).toEqual({ name: 'Ramesh', referredBy: { code: 'RF-0012', name: 'Asha' } });
    expect(localStorage.getItem(key)).not.toContain('482913');
    expect(sessionStorage.getItem(key)).toBeNull();
    first.unmount();

    // The tab is closed: sessionStorage is gone, the draft is not.
    sessionStorage.clear();
    let clear: () => void = () => undefined;
    mount((c) => (clear = c));
    expect(screen.getByLabelText('Name')).toHaveValue('Ramesh');
    expect(screen.getByText('restored')).toBeInTheDocument();
    act(() => clear());
    expect(localStorage.getItem(key)).toBeNull();
  });

  it('strips OTP fields at any depth but keeps record codes', () => {
    expect(withoutOtp({ code: '1234', otpCode: '1', mobileOtp: 'x', mobile_otp: 'y', OTP: 'z', verificationCode: 'v', notPresent: true, partner: { code: 'RF-0012' }, rows: [{ otpRequestId: 'r', name: 'a' }] })).toEqual({
      notPresent: true,
      partner: { code: 'RF-0012' },
      rows: [{ name: 'a' }],
    });
  });

  it('picks up a draft the earlier version kept in the tab, and clears both', () => {
    const key = draftKey('job-seeker', 'staff-ca');
    sessionStorage.setItem(key, JSON.stringify({ name: 'Old', otpRequestId: 'r1' }));
    expect(readDraft(key)).toEqual({ name: 'Old' });
    clearDraft(key);
    expect(sessionStorage.getItem(key)).toBeNull();
    expect(localStorage.getItem(key)).toBeNull();
  });

  it('keeps the form working when storage is blocked', () => {
    const get = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    const set = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    try {
      expect(readDraft('laboura.draft.x.y')).toBeNull();
      signInAs('call_agent');
      mount();
      expect(screen.getByLabelText('Name')).toHaveValue('');
    } finally {
      get.mockRestore();
      set.mockRestore();
    }
  });
});
