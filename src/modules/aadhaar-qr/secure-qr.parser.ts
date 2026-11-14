import { createHash, createPublicKey, KeyObject, verify, X509Certificate } from 'node:crypto';
import { unzipSync } from 'node:zlib';

/**
 * Reads UIDAI's Aadhaar Secure QR code, entirely in this process (Master
 * Guide, "Aadhaar verification", 14 Nov: an in-house check, no outside
 * company).
 *
 * The QR's text is one big base-10 number. As bytes it is a gzip/zlib stream;
 * inflated, it is a list of fields separated by the byte 255, in UIDAI's order:
 *
 *   [V2…   ] version marker — only on the newer cards (2022 onwards)
 *   0       email/mobile indicator: 0 none, 1 email only, 2 mobile only, 3 both
 *   1       reference id: last 4 digits of the Aadhaar number + time stamp
 *           (YYYYMMDDHHMMSSsss)
 *   2       name
 *   3       date of birth (DD-MM-YYYY, sometimes only the year)
 *   4       gender (M, F or T)
 *   5–15    address: care of, district, landmark, house, location, pincode,
 *           post office, state, street, sub district, VTC
 *   [16    ] newer cards: the last 4 digits of the mobile number
 *   then    the photo (JPEG 2000) up to the hashes / signature
 *   [32+32 ] older cards: SHA-256 hash of the email (indicator 1 or 3) and of
 *           the mobile (indicator 2 or 3), just before the signature
 *   last 256 bytes: UIDAI's RSA-2048 / SHA-256 signature over everything before it.
 *
 * Nothing here logs or keeps the raw text, the inflated bytes, the address or
 * the hashes; the caller keeps only the fields the guide lists.
 */

/** Why a QR could not be used. The message is safe to show to the person. */
export type SecureQrFailure = 'old_unsigned_qr' | 'unreadable' | 'bad_signature' | 'cert_missing';

export class SecureQrError extends Error {
  constructor(
    readonly code: SecureQrFailure,
    message: string,
  ) {
    super(message);
    this.name = 'SecureQrError';
  }
}

export const SECURE_QR_MESSAGES: Record<SecureQrFailure, string> = {
  old_unsigned_qr:
    "This is an older Aadhaar QR code without UIDAI's digital signature, so it can't be checked. Download your free e-Aadhaar from UIDAI, or use another ID.",
  unreadable: "This doesn't look like an Aadhaar Secure QR code. Scan the QR code on your Aadhaar again, or use another ID.",
  bad_signature: "This Aadhaar QR code failed UIDAI's digital signature check. Scan the QR code on your own Aadhaar card again, or use another ID.",
  cert_missing: 'This Aadhaar is newer than our check supports. Please use another ID.',
};

/** A QR code's numeric text is at most ~7,100 digits (version 40); anything longer is refused before parsing. */
export const MAX_QR_TEXT_LENGTH = 8000;
/** The inflated data is a few kilobytes; refuse anything that inflates further (a "zip bomb"). */
const MAX_INFLATED_BYTES = 64 * 1024;
const SIGNATURE_BYTES = 256;
const HASH_BYTES = 32;
const DELIMITER = 255;

export interface SecureQrAddress {
  careOf: string;
  district: string;
  landmark: string;
  house: string;
  location: string;
  pincode: string;
  postOffice: string;
  state: string;
  street: string;
  subDistrict: string;
  vtc: string;
}

export interface ParsedSecureQr {
  /** "V2", "V3"… on the newer cards; null on the older ones. */
  version: string | null;
  /** 0 none, 1 email only, 2 mobile only, 3 both. */
  emailMobileIndicator: number;
  /** The QR's reference id: last 4 digits of the Aadhaar number + its time stamp. */
  referenceId: string;
  referenceLast4: string;
  /** The reference's time stamp as written (YYYYMMDDHHMMSSsss), or '' when missing. */
  referenceTimestamp: string;
  name: string;
  dateOfBirth: string;
  gender: string;
  address: SecureQrAddress;
  /** Newer cards: the last 4 digits of the mobile number linked to the Aadhaar. */
  mobileLast4: string | null;
  /** Older cards: SHA-256 hash (repeated) of the linked mobile / email. */
  mobileHash: Buffer | null;
  emailHash: Buffer | null;
  photo: Buffer;
  signedData: Buffer;
  signature: Buffer;
}

/** The QR text → the inflated bytes. Refuses old XML codes and anything that isn't a Secure QR. */
export function inflateSecureQrText(text: unknown): Buffer {
  if (typeof text !== 'string') throw new SecureQrError('unreadable', SECURE_QR_MESSAGES.unreadable);
  const trimmed = text.trim();
  // The old (pre-2018) Aadhaar QR is plain XML with no signature.
  if (/^(<\?xml|<PrintLetterBarcodeData|<QPDB|<QDA)/i.test(trimmed)) {
    throw new SecureQrError('old_unsigned_qr', SECURE_QR_MESSAGES.old_unsigned_qr);
  }
  if (!trimmed || trimmed.length > MAX_QR_TEXT_LENGTH || !/^\d+$/.test(trimmed)) {
    throw new SecureQrError('unreadable', SECURE_QR_MESSAGES.unreadable);
  }
  let hex = BigInt(trimmed).toString(16);
  if (hex.length % 2) hex = `0${hex}`;
  const compressed = Buffer.from(hex, 'hex');
  try {
    // unzip accepts both the gzip and the zlib header.
    return unzipSync(compressed, { maxOutputLength: MAX_INFLATED_BYTES });
  } catch {
    throw new SecureQrError('unreadable', SECURE_QR_MESSAGES.unreadable);
  }
}

function decodeText(bytes: Buffer): string {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes).trim();
  } catch {
    return bytes.toString('latin1').trim();
  }
}

/** Splits, checks the shape and returns the fields. Does not check the signature (see verifySecureQrSignature). */
export function parseSecureQr(text: unknown): ParsedSecureQr {
  const data = inflateSecureQrText(text);
  if (data.length <= SIGNATURE_BYTES + 32) throw new SecureQrError('unreadable', SECURE_QR_MESSAGES.unreadable);
  const signature = Buffer.from(data.subarray(data.length - SIGNATURE_BYTES));
  const signedData = Buffer.from(data.subarray(0, data.length - SIGNATURE_BYTES));

  // Where each delimiter is, in the part before the signature.
  const delimiters: number[] = [];
  for (let i = 0; i < signedData.length; i += 1) if (signedData[i] === DELIMITER) delimiters.push(i);

  const firstEnd = delimiters[0] ?? -1;
  const first = firstEnd > 0 ? signedData.subarray(0, firstEnd).toString('latin1') : '';
  const version = /^V\d{1,2}$/.test(first) ? first : null;
  // Text fields before the photo: 16 on the older cards; version marker + 16 + mobile last 4 on the newer ones.
  const textFields = version ? 18 : 16;
  if (delimiters.length < textFields) throw new SecureQrError('unreadable', SECURE_QR_MESSAGES.unreadable);

  const fields: Buffer[] = [];
  let start = 0;
  for (let i = 0; i < textFields; i += 1) {
    fields.push(signedData.subarray(start, delimiters[i]));
    start = delimiters[i]! + 1;
  }
  const photoStart = start;
  const values = (version ? fields.slice(1) : fields).map(decodeText);
  const [indicatorText, referenceId, name, dateOfBirth, gender, careOf, district, landmark, house, location, pincode, postOffice, state, street, subDistrict, vtc, mobileLast4Text] = values;

  const indicator = Number(indicatorText);
  if (!Number.isInteger(indicator) || indicator < 0 || indicator > 3) throw new SecureQrError('unreadable', SECURE_QR_MESSAGES.unreadable);
  if (!referenceId || !/^\d{4}/.test(referenceId) || !name) throw new SecureQrError('unreadable', SECURE_QR_MESSAGES.unreadable);

  // Older cards keep the hashes of the email / mobile just before the signature; newer cards
  // carry the mobile's last 4 digits as a text field instead.
  const hashCount = version ? 0 : indicator === 3 ? 2 : indicator === 0 ? 0 : 1;
  const photoEnd = signedData.length - hashCount * HASH_BYTES;
  if (photoEnd < photoStart) throw new SecureQrError('unreadable', SECURE_QR_MESSAGES.unreadable);
  let mobileHash: Buffer | null = null;
  let emailHash: Buffer | null = null;
  if (!version) {
    const end = signedData.length;
    if (indicator === 3) {
      mobileHash = Buffer.from(signedData.subarray(end - HASH_BYTES, end));
      emailHash = Buffer.from(signedData.subarray(end - 2 * HASH_BYTES, end - HASH_BYTES));
    } else if (indicator === 2) {
      mobileHash = Buffer.from(signedData.subarray(end - HASH_BYTES, end));
    } else if (indicator === 1) {
      emailHash = Buffer.from(signedData.subarray(end - HASH_BYTES, end));
    }
  }

  const mobileLast4 = version && mobileLast4Text && /^\d{4}$/.test(mobileLast4Text) ? mobileLast4Text : null;
  return {
    version,
    emailMobileIndicator: indicator,
    referenceId,
    referenceLast4: referenceId.slice(0, 4),
    referenceTimestamp: /^\d{4}(\d{14,17})$/.test(referenceId) ? referenceId.slice(4) : '',
    name,
    dateOfBirth: dateOfBirth ?? '',
    gender: gender ?? '',
    address: {
      careOf: careOf ?? '',
      district: district ?? '',
      landmark: landmark ?? '',
      house: house ?? '',
      location: location ?? '',
      pincode: pincode ?? '',
      postOffice: postOffice ?? '',
      state: state ?? '',
      street: street ?? '',
      subDistrict: subDistrict ?? '',
      vtc: vtc ?? '',
    },
    mobileLast4,
    mobileHash,
    emailHash,
    photo: Buffer.from(signedData.subarray(photoStart, photoEnd)),
    signedData,
    signature,
  };
}

// ------------------------------------------------------------------ signature

export interface TrustedKey {
  /** A short name for the audit (e.g. the certificate's file name). */
  name: string;
  key: KeyObject;
  /** Until when UIDAI signed new codes with it (a certificate's notAfter); null for a bare key. */
  notAfter?: Date | null;
}

/** A PEM certificate or a PEM public key → the key that checks signatures. */
export function trustedKeyFromPem(name: string, pem: string): TrustedKey {
  const text = pem.trim();
  if (text.includes('BEGIN CERTIFICATE')) {
    const cert = new X509Certificate(text);
    return { name, key: cert.publicKey, notAfter: new Date(cert.validTo) };
  }
  return { name, key: createPublicKey(text), notAfter: null };
}

/** The latest date any trusted certificate was valid to (null when none says). */
export function newestCertificateEnd(keys: TrustedKey[]): Date | null {
  const ends = keys.map((k) => k.notAfter).filter((d): d is Date => d instanceof Date && !Number.isNaN(d.getTime()));
  return ends.length ? new Date(Math.max(...ends.map((d) => d.getTime()))) : null;
}

/**
 * RSA-2048 PKCS#1 v1.5 with SHA-256 over every byte before the last 256.
 * Tries each trusted key (UIDAI changes its key every few years; cards signed
 * with an older key stay valid). Returns the key that matched, or null.
 */
export function verifySecureQrSignature(parsed: Pick<ParsedSecureQr, 'signedData' | 'signature'>, keys: TrustedKey[]): TrustedKey | null {
  for (const trusted of keys) {
    try {
      if (verify('sha256', parsed.signedData, trusted.key, parsed.signature)) return trusted;
    } catch {
      // a key of the wrong type or size: try the next one
    }
  }
  return null;
}

// --------------------------------------------------------------- the checks

export type PhoneLink = 'linked' | 'not_linked' | 'unknown';

/**
 * UIDAI's rule for the mobile hash on the older cards: take the 4th digit of
 * the reference id (the last digit of the Aadhaar number). If it is 0 or 1,
 * SHA-256 the mobile number once; for 2–9, apply SHA-256 that many times, each
 * time over the hex text of the previous hash. The result must equal the hash
 * in the QR.
 */
export function mobileHashFor(mobile10: string, referenceId: string): Buffer {
  const lastDigit = Number(referenceId.charAt(3));
  const rounds = Number.isInteger(lastDigit) && lastDigit > 1 ? lastDigit : 1;
  let value = mobile10;
  let digest = Buffer.alloc(0);
  for (let i = 0; i < rounds; i += 1) {
    digest = createHash('sha256').update(value, 'utf8').digest();
    value = digest.toString('hex');
  }
  return digest;
}

function nationalMobile(phone: string): string | null {
  const digits = phone.replace(/\D/g, '');
  const national = digits.length > 10 ? digits.slice(-10) : digits;
  return /^\d{10}$/.test(national) ? national : null;
}

/**
 * Is the job seeker's OTP-verified phone the one linked to this Aadhaar?
 * Older cards: the repeated SHA-256 hash; newer cards: the last 4 digits. No
 * mobile on the Aadhaar at all is "not linked". Never a block — a flag for
 * the Team Lead (guide).
 */
export function phoneLinkStatus(parsed: Pick<ParsedSecureQr, 'emailMobileIndicator' | 'mobileHash' | 'mobileLast4' | 'referenceId' | 'version'>, phone: string | null | undefined): PhoneLink {
  const mobile = phone ? nationalMobile(phone) : null;
  if (!mobile) return 'unknown';
  if (parsed.emailMobileIndicator === 0 || parsed.emailMobileIndicator === 1) return 'not_linked';
  if (parsed.mobileHash) return mobileHashFor(mobile, parsed.referenceId).equals(parsed.mobileHash) ? 'linked' : 'not_linked';
  if (parsed.mobileLast4) return mobile.endsWith(parsed.mobileLast4) ? 'linked' : 'not_linked';
  return 'unknown';
}

export interface QrDateOfBirth {
  /** YYYY-MM-DD, or YYYY when the card has only the year. */
  value: string;
  year: number;
  month: number | null;
  day: number | null;
}

export function parseQrDateOfBirth(text: string): QrDateOfBirth | null {
  const value = text.trim();
  let m = /^(\d{2})[-/.](\d{2})[-/.](\d{4})$/.exec(value);
  if (m) return build(Number(m[3]), Number(m[2]), Number(m[1]));
  m = /^(\d{4})[-/.](\d{2})[-/.](\d{2})$/.exec(value);
  if (m) return build(Number(m[1]), Number(m[2]), Number(m[3]));
  m = /^(\d{4})$/.exec(value);
  if (m) {
    const year = Number(m[1]);
    return year > 1900 && year < 2200 ? { value: m[1]!, year, month: null, day: null } : null;
  }
  return null;

  function build(year: number, month: number, day: number): QrDateOfBirth | null {
    const date = new Date(Date.UTC(year, month - 1, day));
    if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return null;
    return { value: `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`, year, month, day };
  }
}

/**
 * 18 or older on `now` (IST calendar day). With only a year on the card, the
 * person counts as born on 31 December of that year, so nobody under 18 slips
 * through; an unreadable date is not "adult".
 */
export function isAdultOn(dob: QrDateOfBirth | null, now: Date, minimumAge = 18): boolean {
  if (!dob) return false;
  const ist = new Date(now.getTime() + 330 * 60 * 1000);
  const year = ist.getUTCFullYear();
  const month = ist.getUTCMonth() + 1;
  const day = ist.getUTCDate();
  const bMonth = dob.month ?? 12;
  const bDay = dob.day ?? 31;
  let age = year - dob.year;
  if (month < bMonth || (month === bMonth && day < bDay)) age -= 1;
  return age >= minimumAge;
}

/** The QR's own time stamp (written in IST) as a UTC instant, or null. */
export function qrIssuedAt(parsed: Pick<ParsedSecureQr, 'referenceTimestamp'>): Date | null {
  const m = /^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})(\d{0,3})$/.exec(parsed.referenceTimestamp);
  if (!m) return null;
  const ms = m[7] ? Number(m[7].padEnd(3, '0')) : 0;
  const utc = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]), Number(m[4]), Number(m[5]), Number(m[6]), ms) - 330 * 60 * 1000;
  return Number.isNaN(utc) ? null : new Date(utc);
}

/** "XXXX-XXXX-1234" — the only form of the Aadhaar number Laboura ever shows. */
export function maskedAadhaarReference(last4: string | null | undefined): string | null {
  return last4 && /^\d{4}$/.test(last4) ? `XXXX-XXXX-${last4}` : null;
}

/** The only parts of the address that are kept: one area name and the pincode. */
export function areaAndPincode(address: SecureQrAddress): { area: string | null; pincode: string | null } {
  const area = [address.location, address.vtc, address.subDistrict, address.district].map((part) => part.trim()).find(Boolean) ?? null;
  const pincode = /^\d{6}$/.test(address.pincode.trim()) ? address.pincode.trim() : null;
  return { area, pincode };
}

export function genderFromQr(text: string): 'M' | 'F' | 'T' | null {
  const first = text.trim().charAt(0).toUpperCase();
  return first === 'M' || first === 'F' || first === 'T' ? first : null;
}
