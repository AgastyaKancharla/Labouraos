import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { TrustedKey, trustedKeyFromPem } from './secure-qr.parser';

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
 *      ./certs, add it to the table below and to uidai-certificates.spec.ts, deploy.
 * An expired certificate still checks the signatures it made; the dates only
 * say when UIDAI stopped signing new codes with it.
 *
 *   uidai_prod_cdup.pem                   CN "DS UNIQUE IDENTIFICATION AUTHORITY OF INDIA 4", 2017-06-08 → 2020-06-07
 *     SHA-256 FC:F3:1A:3F:89:21:16:15:EB:D5:D4:49:AC:33:D8:D3:81:F6:54:D2:E2:D1:50:37:D5:CC:8D:4A:EB:72:F8:36
 *   uidai_offline_publickey_26022021.pem  CN "DS UNIQUE IDENTIFICATION AUTHORITY OF INDIA 05", 2021-02-26 → 2024-02-27
 *     SHA-256 E0:F0:F8:69:D3:2E:FC:7E:80:FA:E2:22:37:17:A5:6D:CF:8B:61:6F:82:0B:54:2A:49:E5:BD:5A:BF:1C:0F:7D
 *   uidai_offline_publickey_17022026.pem  CN "DS Unique Identification Authority of India 05", 2024-02-21 → 2026-02-16
 *     SHA-256 00:57:3C:69:2C:F0:4F:BE:E1:13:AE:5F:D5:2F:2A:65:4D:36:1B:F8:EE:4D:06:C4:60:08:90:6B:36:DF:81:69
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
