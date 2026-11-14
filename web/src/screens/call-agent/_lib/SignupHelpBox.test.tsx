import { screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { renderScreen } from '../../../test/utils';
import { en } from '../../../i18n/en';
import { workItem } from './fixtures';
import { SignupHelpBox } from './SignupHelpBox';
import { reasonTag, whyText } from './format';
import { signupHi, signupKn } from './i18n.signup';

const t = (key: string, vars: Record<string, string | number> = {}) =>
  String((en as Record<string, string>)[key] ?? key).replace(/\{(\w+)\}/g, (_, k: string) => String(vars[k] ?? ''));

const signup = workItem({
  kind: 'signup_help',
  category: 'app_signups',
  detail: {
    taskId: 't1',
    signupTrackerId: 'su-1',
    signupKind: 'job_seeker',
    stage: 'C',
    step: 'selfie',
    missing: 'selfie,id_check,terms,payment',
    stuckReason: null,
    scriptHint: 'job_seeker.selfie',
    callTry: 2,
  },
});

describe('Sign-up help in the call agent console', () => {
  it('tags the row and explains why the person is on the list', () => {
    expect(reasonTag(signup, t as never, new Date()).text).toBe('App · selfie');
    expect(reasonTag({ ...signup, kind: 'signup_payment' }, t as never, new Date())).toEqual({ text: 'App · at payment', tone: 'tr' });
    expect(whyText(signup, t as never)).toBe('signed up in the Laboura app and stopped at: selfie.');
  });

  it('shows the steps still to do and the script for the step on the profile', () => {
    renderScreen(<SignupHelpBox item={signup} />);
    expect(screen.getByTestId('signup-help')).toHaveTextContent('App sign-up · Job seeker · Call try 2');
    expect(screen.getByText(/Still to do: selfie · ID check · terms · payment/)).toBeInTheDocument();
    expect(screen.getByText(/live selfie in good light/)).toBeInTheDocument();
  });

  it('renders nothing for other kinds of work', () => {
    renderScreen(<SignupHelpBox item={workItem({ kind: 'callback' })} />);
    expect(screen.queryByTestId('signup-help')).toBeNull();
  });

  it('Kannada and Hindi are translations, never copies of the English', () => {
    for (const [key, value] of Object.entries(signupKn)) expect(value, key).not.toBe((en as Record<string, string>)[key]);
    for (const [key, value] of Object.entries(signupHi)) expect(value, key).not.toBe((en as Record<string, string>)[key]);
  });
});
