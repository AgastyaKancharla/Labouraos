import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { TrustedKey, trustedKeyFromPem } from './secure-qr.parser';
import { isTestSetup } from '../../common/customer-auth/customer-otp-test-mode';
import { anyLiveVendor } from '../../common/otp/otp-test-mode';

/**
 * UIDAI's public certificates for the Aadhaar Secure QR check, committed in
 * ./certs (one .pem per key). nest-cli.json's "assets" copies them next to the
 * compiled code. A QR passes when its signature matches any of them.
 *
 * UIDAI changes its signing key every few years and cards printed with an
 * older key stay valid, so never delete an old certificate; add the new one:
 *   1. Download the newest "Offline e-KYC" / "Secure QR Code" certificate from
 *      UIDAI's developer section ("UIDAI Certificate Details").
 *   2. If it is binary (DER), make it PEM:
 *      openssl x509 -inform der -in uidai_offline_publickey_<date>.cer -out uidai_offline_publickey_<date>.pem
 *   3. Check its fingerprint against UIDAI's
 *      (openssl x509 -in <file>.pem -noout -fingerprint -sha256), put it in
 *      ./certs, add it to the table below and pin its fingerprint in secure-qr.parser.spec.ts, deploy.
 * An expired certificate still checks the signatures it made; the dates only
 * say when UIDAI stopped signing new codes with it.
 *
 *   uidai_prod_cdup.pem                   CN "DS UNIQUE IDENTIFICATION AUTHORITY OF INDIA 4", 2017-06-08 → 2020-06-07
 *     SHA-256 FC:F3:1A:3F:89:21:16:15:EB:D5:D4:49:AC:33:D8:D3:81:F6:54:D2:E2:D1:50:37:D5:CC:8D:4A:EB:72:F8:36
 *   uidai_offline_publickey_26022021.pem  CN "DS UNIQUE IDENTIFICATION AUTHORITY OF INDIA 05", 2021-02-26 → 2024-02-27
 *     SHA-256 E0:F0:F8:69:D3:2E:FC:7E:80:FA:E2:22:37:17:A5:6D:CF:8B:61:6F:82:0B:54:2A:49:E5:BD:5A:BF:1C:0F:7D
 *   uidai_offline_publickey_17022026.pem  CN "DS Unique Identification Authority of India 05", 2024-02-21 → 2026-02-16
 *     SHA-256 00:57:3C:69:2C:F0:4F:BE:E1:13:AE:5F:D5:2F:2A:65:4D:36:1B:F8:EE:4D:06:C4:60:08:90:6B:36:DF:81:69
 *   uidai_offline_publickey_2026.pem      CN "DS Unique Identification Authority of India 06", 2026-02-03 → 2029-02-03, serial 624C4F50
 *     SHA-256 E0:30:4B:9E:61:EE:36:40:EC:DD:AE:2D:B4:B6:17:F2:E2:67:8F:57:DB:C2:82:6C:2F:86:AC:5C:04:F2:77:DF
 *     Issued by "(n)Code Solutions Sub-CA for DSC 2022", the same issuer as the 2024-2026 certificate.
 *     Added 14 Nov 2026: UIDAI's page lists an "Offline e-KYC" certificate valid to 03 Feb 2029, and this
 *     file's end date matches it; uidai.gov.in was blocked from the build machine, so the file came from
 *     public copies that all have this exact fingerprint (DEPLOY.md, go-live checklist: compare it with
 *     UIDAI's page and test with a freshly downloaded e-Aadhaar).
 *
 * The spec pins each file's SHA-256 (secure-qr.parser.spec.ts): adding a certificate means adding its
 * fingerprint there too.
 */
export const UIDAI_CERTIFICATE_DIR = join(__dirname, 'certs');

export function loadUidaiCertificates(dir: string = UIDAI_CERTIFICATE_DIR): TrustedKey[] {
  let files: string[];
  try {
    files = readdirSync(dir).filter((file) => file.endsWith('.pem')).sort();
  } catch {
    return [];
  }
  return files.map((file) => trustedKeyFromPem(file, readFileSync(join(dir, file), 'utf8')));
}

/** The production setting with the confirmed certificate fingerprints (render.yaml, DEPLOY.md). */
export const UIDAI_CERT_FINGERPRINTS_SETTING = 'UIDAI_CERT_FINGERPRINTS';


function normaliseFingerprint(value: string): string {
  return value.replace(/[^0-9a-f]/gi, '').toUpperCase();
}

/**
 * Production boot check (go-live checklist, DEPLOY.md): at least one UIDAI
 * certificate must load, and UIDAI_CERT_FINGERPRINTS — the SHA-256
 * fingerprints the owner confirmed against UIDAI's own page, comma-separated —
 * must list exactly the certificates in ./certs. So a certificate can't be
 * added, swapped or left unconfirmed without someone writing its fingerprint
 * into the live settings. The test setup (LABOURA_SETUP=test, made-up data
 * only — render.free.yaml) doesn't need the setting, unless a real vendor is
 * configured (then it is not a test setup). Every loaded key must be a
 * certificate with a fingerprint. Does nothing outside production.
 */
export function assertUidaiCertificatesPinned(env: NodeJS.ProcessEnv = process.env, dir: string = UIDAI_CERTIFICATE_DIR): void {
  if (env.NODE_ENV !== 'production') return;
  const keys = loadUidaiCertificates(dir);
  if (!keys.length) throw new Error(`Refusing to start in production: no UIDAI certificate loaded from ${dir} (the Aadhaar QR check would call every card tampered)`);
  // Only X.509 certificates (each has a fingerprint to confirm); a bare public key can't be pinned.
  const unpinnable = keys.filter((k) => !k.fingerprint256).map((k) => k.name);
  if (unpinnable.length) throw new Error(`Refusing to start in production: ${unpinnable.join(', ')} in ${dir} is not an X.509 certificate with a fingerprint`);
  // The test setup (made-up data) doesn't pin — but never once a real vendor is configured.
  if (isTestSetup(env) && !anyLiveVendor(env)) return;
  const setting = (env[UIDAI_CERT_FINGERPRINTS_SETTING] ?? '').trim();
  const loaded = keys.map((k) => k.fingerprint256).filter((f): f is string => Boolean(f)).map(normaliseFingerprint).sort();
  const pinned = [...new Set(setting.split(',').map((f) => normaliseFingerprint(f)).filter(Boolean))].sort();
  if (!pinned.length) {
    throw new Error(
      'Refusing to start in production: UIDAI_CERT_FINGERPRINTS is not set. Do the go-live check in DEPLOY.md ' +
        "(compare each UIDAI certificate's SHA-256 with UIDAI's page) and set it to those fingerprints, comma-separated, on the web service and the worker.",
    );
  }
  if (pinned.length !== loaded.length || pinned.some((f, i) => f !== loaded[i])) {
    throw new Error(
      'Refusing to start in production: UIDAI_CERT_FINGERPRINTS does not match the UIDAI certificates in the code. ' +
        `In the code: ${keys.map((k) => `${k.name} ${k.fingerprint256}`).join('; ')}. Confirm the new one against UIDAI's page (DEPLOY.md) and update the setting.`,
    );
  }
}
