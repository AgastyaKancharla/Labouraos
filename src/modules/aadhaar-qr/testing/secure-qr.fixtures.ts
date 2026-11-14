import { createHash, generateKeyPairSync, KeyObject, sign } from 'node:crypto';
import { gzipSync } from 'node:zlib';
import { TrustedKey } from '../secure-qr.parser';

/**
 * Builds synthetic Aadhaar Secure QR codes for the tests, in UIDAI's exact
 * byte layout (see secure-qr.parser.ts), signed with a throw-away RSA-2048
 * test key. Nothing here is a real person's data.
 */

/** A 60 × 72 JPEG 2000 file (JP2 box + codestream) of a plain drawn silhouette — not a person. */
export const SYNTHETIC_JP2_PHOTO = Buffer.from(
  'AAAADGpQICANCocKAAAAFGZ0eXBqcDIgAAAAAGpwMiAAAAAtanAyaAAAABZpaGRyAAAASAAAADwAAwcHAAAAAAAPY29scgEAAAAAABAAAAEFanAyY/9P/1EALwAAAAAAPAAAAEgAAAAAAAAAAAAAADwAAABIAAAAAAAAAAAAAwcBAQcBAQcBAf9SAAwAAAABAAUEBAAA/1wAI0J3IHbwdvB2wG8AbwBu4GdQZ1BnaFAFUAVQR1fTV9NXYv9kACUAAUNyZWF0ZWQgYnkgT3BlbkpQRUcgdmVyc2lvbiAyLjUuNP+QAAoAAAAAAG4AAf+Tx8YUAXm5TsPHxhQBgfji28fGFAI6ckRsx8AkHBgR1QRnEFDwx8AkHwBweDAR1QUDDnZgDU0Ax8AkEUGGEdP1Kw5ODUaCxwYAI/pExwYAI/pMw4MAI/lDgICAgICAgICA/9k=',
  'base64',
);

export interface SyntheticQr {
  version?: 'V2' | 'V3' | null;
  indicator?: 0 | 1 | 2 | 3;
  /** Last 4 digits of the (made-up) Aadhaar number; its last digit sets the mobile hash rounds. */
  last4?: string;
  timestamp?: string;
  name?: string;
  dob?: string;
  gender?: string;
  address?: Partial<Record<'careOf' | 'district' | 'landmark' | 'house' | 'location' | 'pincode' | 'postOffice' | 'state' | 'street' | 'subDistrict' | 'vtc', string>>;
  /** The mobile linked to the Aadhaar (older cards: hashed; newer cards: last 4 digits). */
  mobile?: string;
  email?: string;
  photo?: Buffer;
}

export interface TestSigner {
  privateKey: KeyObject;
  trusted: TrustedKey;
}

export function testSigner(name = 'test-key'): TestSigner {
  const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048, publicExponent: 0x10001 });
  return { privateKey, trusted: { name, key: publicKey } };
}

/** UIDAI's mobile/email hash: SHA-256 once for a last digit of 0 or 1, else that many times over the previous hash's hex text. */
export function uidaiHash(value: string, last4: string): Buffer {
  const lastDigit = Number(last4.charAt(3));
  const rounds = lastDigit > 1 ? lastDigit : 1;
  let text = value;
  let digest = Buffer.alloc(0);
  for (let i = 0; i < rounds; i += 1) {
    digest = createHash('sha256').update(text, 'utf8').digest();
    text = digest.toString('hex');
  }
  return digest;
}

/** The signed part (everything before the signature), in UIDAI's order. */
export function secureQrSignedBytes(input: SyntheticQr = {}): Buffer {
  const version = input.version === undefined ? null : input.version;
  const indicator = input.indicator ?? 2;
  const last4 = input.last4 ?? '1234';
  const a = {
    careOf: 'S/O Test Parent', district: 'Bengaluru Urban', landmark: 'Near Test Park', house: '12, 3rd Cross',
    location: 'JP Nagar 8th Phase', pincode: '560076', postOffice: 'JP Nagar', state: 'Karnataka', street: 'Test Main Road',
    subDistrict: 'Bengaluru South', vtc: 'Bengaluru', ...input.address,
  };
  const text = [
    ...(version ? [version] : []),
    String(indicator),
    `${last4}${input.timestamp ?? '20260101101530123'}`,
    input.name ?? 'Kavya Ramesh',
    input.dob ?? '15-08-1998',
    input.gender ?? 'F',
    a.careOf, a.district, a.landmark, a.house, a.location, a.pincode, a.postOffice, a.state, a.street, a.subDistrict, a.vtc,
    ...(version ? [input.mobile ? input.mobile.slice(-4) : ''] : []),
  ];
  const parts: Buffer[] = [];
  for (const field of text) parts.push(Buffer.from(field, 'utf8'), Buffer.from([255]));
  parts.push(input.photo ?? SYNTHETIC_JP2_PHOTO);
  if (!version) {
    if (indicator === 1 || indicator === 3) parts.push(uidaiHash(input.email ?? 'kavya@example.com', last4));
    if (indicator === 2 || indicator === 3) parts.push(uidaiHash(input.mobile ?? '9876500001', last4));
  }
  return Buffer.concat(parts);
}

/** Signed bytes + signature → gzip → one big base-10 number (the QR's text). */
export function secureQrText(signed: Buffer, signer: TestSigner, options: { signature?: Buffer } = {}): string {
  const signature = options.signature ?? sign('sha256', signed, signer.privateKey);
  return bytesToDecimal(gzipSync(Buffer.concat([signed, signature])));
}

export function bytesToDecimal(bytes: Buffer): string {
  return BigInt(`0x${bytes.toString('hex')}`).toString(10);
}

export function buildSecureQr(signer: TestSigner, input: SyntheticQr = {}): string {
  return secureQrText(secureQrSignedBytes(input), signer);
}
