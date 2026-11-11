import { act, fireEvent, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { renderScreen } from '../../test/utils';
import { DateField } from './DateField';
import { MobileField } from './MobileField';
import { MoneyField, formatMoneyTyping } from './MoneyField';
import { OtpInput } from './OtpInput';
import { OtpVerification } from './OtpVerification';
import { PincodeField } from './PincodeField';

function Controlled<T>({ initial, render }: { initial: T; render: (v: T, set: (v: T) => void) => React.ReactNode }) {
  const [v, set] = useState<T>(initial);
  return <>{render(v, set)}</>;
}

describe('MobileField', () => {
  it('keeps +91 fixed and exactly 10 digits', async () => {
    const onChange = vi.fn();
    renderScreen(<Controlled initial="" render={(v, set) => <MobileField value={v} onChange={(d) => { set(d); onChange(d); }} />} />);
    const input = screen.getByLabelText('Mobile number');
    expect(screen.getByText('+91')).toBeInTheDocument();
    await userEvent.type(input, '98a765432109');
    expect(input).toHaveValue('9876543210');
    expect(onChange).toHaveBeenLastCalledWith('9876543210');
  });

  it('explains an invalid number after leaving the box', async () => {
    renderScreen(<Controlled initial="" render={(v, set) => <MobileField value={v} onChange={set} />} />);
    await userEvent.type(screen.getByLabelText('Mobile number'), '12345');
    await userEvent.tab();
    expect(screen.getByRole('alert')).toHaveTextContent('Enter the 10-digit mobile number.');
    expect(screen.getByLabelText('Mobile number')).toHaveAttribute('aria-invalid', 'true');
  });
});

describe('MoneyField', () => {
  it('adds Indian commas while typing and reports paise', async () => {
    const onChange = vi.fn();
    renderScreen(<Controlled<number | null> initial={null} render={(v, set) => <MoneyField label="Salary" value={v} onChange={(p) => { set(p); onChange(p); }} />} />);
    const input = screen.getByLabelText('Salary');
    await userEvent.type(input, '412600.5');
    expect(input).toHaveValue('4,12,600.5');
    expect(onChange).toHaveBeenLastCalledWith(41260050);
    expect(screen.getByText('₹')).toBeInTheDocument();
  });

  it('formats typing safely', () => {
    expect(formatMoneyTyping('00015000')).toBe('15,000');
    expect(formatMoneyTyping('12.3456')).toBe('12.34');
    expect(formatMoneyTyping('abc')).toBe('');
    expect(formatMoneyTyping('.5')).toBe('0.5');
  });

  it('offers the per month / per day choice', async () => {
    const onPeriod = vi.fn();
    renderScreen(<MoneyField label="Salary" value={1500000} onChange={() => {}} period="month" onPeriodChange={onPeriod} />);
    expect(screen.getByLabelText('Salary')).toHaveValue('15,000');
    await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Paid' }), 'day');
    expect(onPeriod).toHaveBeenCalledWith('day');
  });
});

describe('DateField', () => {
  it('blocks dates of birth under 18', () => {
    renderScreen(<DateField label="Date of birth" mode="dob" value="2010-01-01" onChange={() => {}} />, { now: new Date('2026-11-11T06:00:00Z') });
    const input = screen.getByLabelText('Date of birth');
    expect(input).toHaveAttribute('type', 'date');
    expect(input).toHaveAttribute('max', '2008-11-11');
    expect(screen.getByRole('alert')).toHaveTextContent('Must be 18 or older.');
  });
});

describe('PincodeField', () => {
  it('accepts 6 digits and asks to fill the city', async () => {
    const onComplete = vi.fn();
    renderScreen(<Controlled initial="" render={(v, set) => <PincodeField value={v} onChange={set} onComplete={onComplete} />} />);
    await userEvent.type(screen.getByLabelText('Pincode'), '56a00789');
    expect(screen.getByLabelText('Pincode')).toHaveValue('560078');
    expect(onComplete).toHaveBeenCalledWith('560078');
  });
});

describe('OtpInput', () => {
  it('fills every box from a pasted code and moves with the keyboard', async () => {
    const onComplete = vi.fn();
    renderScreen(<Controlled initial="" render={(v, set) => <OtpInput value={v} onChange={set} label="Login code" onComplete={onComplete} />} />);
    const boxes = screen.getAllByRole('textbox');
    expect(boxes).toHaveLength(6);
    await userEvent.click(boxes[0]);
    await userEvent.paste('481906');
    expect(boxes.map((b) => (b as HTMLInputElement).value).join('')).toBe('481906');
    expect(onComplete).toHaveBeenCalledWith('481906');
    expect(screen.getByRole('group', { name: 'Login code' })).toBeInTheDocument();
  });

  it('types forward and backspaces back', async () => {
    renderScreen(<Controlled initial="" render={(v, set) => <OtpInput value={v} onChange={set} label="Code" />} />);
    const boxes = screen.getAllByRole('textbox');
    await userEvent.click(boxes[0]);
    await userEvent.keyboard('12');
    expect(boxes[2]).toHaveFocus();
    await userEvent.keyboard('{Backspace}');
    expect(boxes[1]).toHaveFocus();
    expect((boxes[0] as HTMLInputElement).value + (boxes[1] as HTMLInputElement).value).toBe('1');
  });
});

describe('OtpVerification', () => {
  afterEach(() => vi.useRealTimers());

  it('sends, waits 30 s before resend, allows at most 3 resends and verifies', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    let n = 0;
    const onSend = vi.fn(async () => ({ requestId: `req-${++n}` }));
    const onVerify = vi.fn(async () => {});
    const onVerified = vi.fn();
    renderScreen(<OtpVerification mobile="9876543210" onSend={onSend} onVerify={onVerify} onVerified={onVerified} />);

    await user.click(screen.getByRole('button', { name: 'Send OTP' }));
    expect(await screen.findByText('Code sent to ******3210')).toBeInTheDocument();
    expect(screen.getByText(/Resend in 30 s/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Resend OTP' })).not.toBeInTheDocument();

    for (let i = 0; i < 3; i++) {
      await act(async () => {
        vi.advanceTimersByTime(31_000);
      });
      await user.click(await screen.findByRole('button', { name: 'Resend OTP' }));
      await screen.findByText(/Resend in|No resends left/);
    }
    expect(onSend).toHaveBeenCalledTimes(4);
    expect(onSend).toHaveBeenLastCalledWith('9876543210', 'req-3');
    await act(async () => {
      vi.advanceTimersByTime(31_000);
    });
    expect(screen.getByText('No resends left. Try again later.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Resend OTP' })).not.toBeInTheDocument();

    const boxes = screen.getAllByRole('textbox');
    await user.click(boxes[0]);
    await user.paste('123456');
    await waitFor(() => expect(onVerified).toHaveBeenCalledWith('req-4'));
    expect(onVerify).toHaveBeenCalledWith('req-4', '123456');
    expect(screen.getByText(/Number verified/)).toBeInTheDocument();
  });

  it('cannot send until the number has 10 valid digits', () => {
    renderScreen(<OtpVerification mobile="98765" onSend={vi.fn()} onVerify={vi.fn()} onVerified={vi.fn()} />);
    expect(screen.getByRole('button', { name: 'Send OTP' })).toBeDisabled();
  });

  it('opens the existing record instead of creating a duplicate', async () => {
    const onAlready = vi.fn();
    renderScreen(
      <OtpVerification
        mobile="9876543210"
        onSend={async () => ({ alreadyRegistered: true as const, type: 'job_seeker', code: 'JS-00203' })}
        onVerify={vi.fn()}
        onVerified={vi.fn()}
        onAlreadyRegistered={onAlready}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Send OTP' }));
    const open = await screen.findByRole('button', { name: /Already registered — open it · JS-00203/ });
    await userEvent.click(open);
    expect(onAlready).toHaveBeenCalledWith({ type: 'job_seeker', code: 'JS-00203' });
  });

  it('shows the API error when the code is wrong', async () => {
    const { ApiError } = await import('../../lib/api/errors');
    renderScreen(
      <OtpVerification
        mobile="9876543210"
        onSend={async () => ({ requestId: 'r1' })}
        onVerify={async () => {
          throw new ApiError({ status: 400, messages: ['Wrong code or inactive request.'] });
        }}
        onVerified={vi.fn()}
      />,
    );
    await userEvent.click(screen.getByRole('button', { name: 'Send OTP' }));
    await userEvent.click((await screen.findAllByRole('textbox'))[0]);
    await userEvent.paste('000000');
    expect(await screen.findByRole('alert')).toHaveTextContent('Wrong code or inactive request.');
  });
});
