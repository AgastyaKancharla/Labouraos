import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { assertUidaiCertificatesPinned, loadUidaiCertificates, UIDAI_CERT_FINGERPRINTS_TEST_SETUP } from './uidai-certificates';

/** L1: a production process can't start without UIDAI certificates, nor with certificates nobody confirmed. */
describe('UIDAI certificate boot check (production)', () => {
  const pinned = loadUidaiCertificates().map((k) => k.fingerprint256!);
  const prod = (extra: Record<string, string | undefined> = {}) => ({ NODE_ENV: 'production', ...extra }) as NodeJS.ProcessEnv;

  it('does nothing outside production', () => {
    expect(() => assertUidaiCertificatesPinned({ NODE_ENV: 'test' } as NodeJS.ProcessEnv)).not.toThrow();
  });

  it('refuses to start with no certificate at all', () => {
    const empty = mkdtempSync(join(tmpdir(), 'uidai-empty-'));
    try {
      expect(() => assertUidaiCertificatesPinned(prod({ UIDAI_CERT_FINGERPRINTS: pinned.join(',') }), empty)).toThrow(/no UIDAI certificate loaded/);
    } finally {
      rmSync(empty, { recursive: true, force: true });
    }
  });

  it('refuses to start until UIDAI_CERT_FINGERPRINTS is set (the go-live check can\'t be skipped)', () => {
    expect(() => assertUidaiCertificatesPinned(prod())).toThrow(/UIDAI_CERT_FINGERPRINTS is not set/);
    expect(() => assertUidaiCertificatesPinned(prod({ UIDAI_CERT_FINGERPRINTS: ' ' }))).toThrow(/not set/);
  });

  it('refuses a list that does not match the certificates exactly (one missing, one extra, one changed)', () => {
    expect(() => assertUidaiCertificatesPinned(prod({ UIDAI_CERT_FINGERPRINTS: pinned.slice(1).join(',') }))).toThrow(/does not match/);
    expect(() => assertUidaiCertificatesPinned(prod({ UIDAI_CERT_FINGERPRINTS: [...pinned, 'AA:BB'].join(',') }))).toThrow(/does not match/);
    const changed = [...pinned];
    changed[0] = changed[0]!.replace(/^../, changed[0]!.startsWith('00') ? '11' : '00');
    expect(() => assertUidaiCertificatesPinned(prod({ UIDAI_CERT_FINGERPRINTS: changed.join(',') }))).toThrow(/does not match/);
  });

  it('starts when the confirmed fingerprints match (any order, case or separators)', () => {
    expect(() => assertUidaiCertificatesPinned(prod({ UIDAI_CERT_FINGERPRINTS: [...pinned].reverse().join(', ') }))).not.toThrow();
    expect(() => assertUidaiCertificatesPinned(prod({ UIDAI_CERT_FINGERPRINTS: pinned.map((f) => f.replace(/:/g, '').toLowerCase()).join(',') }))).not.toThrow();
  });

  it('the free test setup (made-up data only) is not pinned', () => {
    expect(() => assertUidaiCertificatesPinned(prod({ UIDAI_CERT_FINGERPRINTS: UIDAI_CERT_FINGERPRINTS_TEST_SETUP }))).not.toThrow();
  });
});
