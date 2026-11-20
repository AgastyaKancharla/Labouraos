import { consentItems } from './ceo-job-seekers.service';

const at = (iso: string) => new Date(iso);
const row = (purpose: string, over: Partial<{ granted: boolean; grantedAt: Date | null; withdrawnAt: Date | null; createdAt: Date }> = {}) => ({
  purpose, granted: true, grantedAt: at('2026-11-10T05:12:00Z'), withdrawnAt: null, createdAt: at('2026-11-10T05:12:00Z'), ...over,
});

describe('C-JobSeeker consent items, each once (17 Nov)', () => {
  it('every item he is asked for, in page order, required ones marked; one not recorded is "not given"', () => {
    const items = consentItems([row('job_matching')]);
    expect(items.map((i) => i.purpose)).toEqual(['job_matching', 'profile_sharing', 'call_recording', 'aadhaar_verification', 'job_updates', 'promotions']);
    expect(items[0]).toEqual({ purpose: 'job_matching', required: true, granted: true, withdrawn: false, at: '2026-11-10T05:12:00.000Z' });
    expect(items[1]).toEqual({ purpose: 'profile_sharing', required: true, granted: false, withdrawn: false, at: null });
    expect(items[5]!.required).toBe(false);
  });

  it('rows from two links or two notice versions show once, with the time it was first given', () => {
    const items = consentItems([
      row('job_matching', { grantedAt: at('2026-11-12T05:00:00Z'), createdAt: at('2026-11-12T05:00:00Z') }),
      row('job_matching'),
    ]);
    expect(items.filter((i) => i.purpose === 'job_matching')).toHaveLength(1);
    expect(items[0]!.at).toBe('2026-11-10T05:12:00.000Z');
  });

  it('withdrawn shows the withdrawal; given again after it shows given (the history rows stay)', () => {
    const withdrawn = row('call_recording', { granted: false, withdrawnAt: at('2026-11-11T09:00:00Z') });
    expect(consentItems([withdrawn])[2]).toMatchObject({ granted: false, withdrawn: true, at: '2026-11-11T09:00:00.000Z' });
    const again = row('call_recording', { grantedAt: at('2026-11-13T09:00:00Z'), createdAt: at('2026-11-13T09:00:00Z') });
    expect(consentItems([withdrawn, again])[2]).toMatchObject({ granted: true, withdrawn: false, at: '2026-11-13T09:00:00.000Z' });
  });
});
