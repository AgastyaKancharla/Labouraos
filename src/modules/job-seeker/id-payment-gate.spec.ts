import { assertIdReadyForPayment } from './id-payment-gate';
import { UNDER_18_STOP_MESSAGE } from '../aadhaar-qr/under18-stop.service';

type Row = { status: string; nameMatches: boolean | null; isAdult: boolean | null; method: string; vendor: string; under18LiftedAt: Date | null };

/** The rows of one person, newest last; the gate's three questions answered from them like the database would. */
function prismaWith(rows: Row[]) {
  const matches = (row: Row, where: Record<string, unknown>) =>
    Object.entries(where).every(([key, value]) => key === 'jobSeekerId' || (row as Record<string, unknown>)[key] === value);
  return {
    identityVerification: {
      findFirst: jest.fn(async ({ where }: { where: Record<string, unknown> }) => {
        const hit = rows.find((row) => matches(row, where));
        return hit ? { id: 'row' } : null;
      }),
    },
  } as never;
}

const NOW = new Date('2026-11-15T06:00:00.000Z');
const verifiedQr: Row = { status: 'verified', nameMatches: true, isAdult: true, method: 'aadhaar_qr', vendor: 'uidai_secure_qr', under18LiftedAt: null };
const approvedPan: Row = { status: 'verified', nameMatches: true, isAdult: true, method: 'pan', vendor: 'team_lead_check', under18LiftedAt: null };
const mismatchQr: Row = { status: 'failed', nameMatches: false, isAdult: true, method: 'aadhaar_qr', vendor: 'uidai_secure_qr', under18LiftedAt: null };
const minorQr: Row = { status: 'failed', nameMatches: true, isAdult: false, method: 'aadhaar_qr', vendor: 'uidai_secure_qr', under18LiftedAt: null };
const pendingPan: Row = { status: 'pending', nameMatches: null, isAdult: null, method: 'pan', vendor: 'team_lead_check', under18LiftedAt: null };
const seeker = { id: 's1', dateOfBirth: null };

describe('One gate before any ₹499 (Fable final re-check, L-5; rev 211: payment before the ID check)', () => {
  it('lets him pay with any verified check, even when a later one failed on the name or waits', async () => {
    await expect(assertIdReadyForPayment(prismaWith([verifiedQr, mismatchQr]), seeker, 18, NOW)).resolves.toBeUndefined();
    await expect(assertIdReadyForPayment(prismaWith([approvedPan, pendingPan]), seeker, 18, NOW)).resolves.toBeUndefined();
  });

  it('refuses past a standing under-18 stop, even with a verified ID; a lifted stop no longer counts', async () => {
    await expect(assertIdReadyForPayment(prismaWith([approvedPan, minorQr]), seeker, 18, NOW)).rejects.toThrow(UNDER_18_STOP_MESSAGE);
    await expect(assertIdReadyForPayment(prismaWith([approvedPan, { ...minorQr, under18LiftedAt: NOW }]), seeker, 18, NOW)).resolves.toBeUndefined();
  });

  it('refuses when his date of birth says under 18', async () => {
    await expect(assertIdReadyForPayment(prismaWith([verifiedQr]), { id: 's1', dateOfBirth: new Date('2010-01-01') }, 18, NOW)).rejects.toThrow(/under 18/);
  });

  it('rev 211: no longer waits for the ID check — no check, a failed one or one waiting for the Team Lead all let him pay', async () => {
    await expect(assertIdReadyForPayment(prismaWith([mismatchQr, pendingPan]), seeker, 18, NOW)).resolves.toBeUndefined();
    await expect(assertIdReadyForPayment(prismaWith([mismatchQr]), seeker, 18, NOW)).resolves.toBeUndefined();
    await expect(assertIdReadyForPayment(prismaWith([]), seeker, 18, NOW)).resolves.toBeUndefined();
  });

  it('A10: under 18 by the typed date of birth still stops before any payment, with no ID check at all', async () => {
    await expect(assertIdReadyForPayment(prismaWith([]), { id: 's1', dateOfBirth: new Date('2010-01-01') }, 18, NOW)).rejects.toThrow(/under 18/);
  });
});
