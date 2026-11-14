import { sign } from 'node:crypto';
import { deflateSync, gzipSync } from 'node:zlib';
import {
  areaAndPincode,
  isAdultOn,
  maskedAadhaarReference,
  MAX_QR_TEXT_LENGTH,
  parseQrDateOfBirth,
  parseSecureQr,
  phoneLinkStatus,
  qrIssuedAt,
  SecureQrError,
  verifySecureQrSignature,
} from './secure-qr.parser';
import { checkIdName } from './id-name-check';
import { jpeg2000ToJpeg } from './qr-photo';
import { loadUidaiCertificates } from './uidai-certificates';
import { buildSecureQr, bytesToDecimal, secureQrSignedBytes, secureQrText, SYNTHETIC_JP2_PHOTO, testSigner } from './testing/secure-qr.fixtures';
import { UIDAI_SAMPLE_SECURE_QR } from './testing/uidai-sample-qr';

const signer = testSigner();
const other = testSigner('other');

function failure(fn: () => unknown): string {
  try {
    fn();
  } catch (error) {
    if (error instanceof SecureQrError) return error.code;
    throw error;
  }
  throw new Error('expected a SecureQrError');
}

describe('Aadhaar Secure QR parser (guide: an in-house check, no outside company)', () => {
  describe("UIDAI's own sample QR", () => {
    const parsed = parseSecureQr(UIDAI_SAMPLE_SECURE_QR);

    it("passes UIDAI's digital signature with the committed UIDAI certificates", () => {
      const keys = loadUidaiCertificates();
      expect(keys.map((k) => k.name)).toEqual([
        'uidai_offline_publickey_17022026.pem',
        'uidai_offline_publickey_26022021.pem',
        'uidai_prod_cdup.pem',
      ]);
      expect(verifySecureQrSignature(parsed, keys)?.name).toBe('uidai_prod_cdup.pem');
    });

    it('reads the fields in UIDAI order (older layout with the hashes before the signature)', () => {
      expect(parsed.version).toBeNull();
      expect(parsed.emailMobileIndicator).toBe(3);
      expect(parsed.referenceLast4).toBe('2697');
      expect(parsed.referenceTimestamp).toBe('20190308114407437');
      expect(parsed.name).toBe('Sumit Kumar');
      expect(parsed.dateOfBirth).toBe('01-01-1984');
      expect(parsed.gender).toBe('M');
      expect(areaAndPincode(parsed.address)).toEqual({ area: 'Krishna Nagar', pincode: '110051' });
      expect(parsed.mobileHash).toHaveLength(32);
      expect(parsed.emailHash).toHaveLength(32);
      expect(qrIssuedAt(parsed)?.toISOString()).toBe('2019-03-08T06:14:07.437Z');
    });

    it('decodes its JPEG 2000 photo into a JPEG', () => {
      expect(parsed.photo.subarray(0, 4).toString('hex')).toBe('ff4fff51');
      const jpeg = jpeg2000ToJpeg(parsed.photo);
      expect(jpeg?.subarray(0, 3).toString('hex')).toBe('ffd8ff');
    });

    it('fails the signature check when one byte is changed', () => {
      const tampered = Buffer.from(parsed.signedData);
      tampered[40] ^= 1;
      expect(verifySecureQrSignature({ signedData: tampered, signature: parsed.signature }, loadUidaiCertificates())).toBeNull();
    });
  });

  describe('synthetic signed QR (test key, UIDAI byte layout)', () => {
    it('passes with the right key and fails with any other key', () => {
      const parsed = parseSecureQr(buildSecureQr(signer));
      expect(verifySecureQrSignature(parsed, [signer.trusted])?.name).toBe('test-key');
      expect(verifySecureQrSignature(parsed, [other.trusted])).toBeNull();
      // more than one key: rotation
      expect(verifySecureQrSignature(parsed, [other.trusted, signer.trusted])?.name).toBe('test-key');
    });

    it('fails when the name, the date of birth or the photo is edited after signing', () => {
      const signed = secureQrSignedBytes({ name: 'Kavya Ramesh' });
      const signature = sign('sha256', signed, signer.privateKey);
      const edited = Buffer.from(signed.toString('latin1').replace('Kavya Ramesh', 'Kavya Rameshh'), 'latin1');
      const fake = parseSecureQr(secureQrText(edited, signer, { signature }));
      expect(fake.name).toBe('Kavya Rameshh');
      expect(verifySecureQrSignature(fake, [signer.trusted])).toBeNull();

      const photoEdited = Buffer.from(signed);
      photoEdited[photoEdited.length - 10] ^= 0xff;
      expect(verifySecureQrSignature(parseSecureQr(secureQrText(photoEdited, signer, { signature })), [signer.trusted])).toBeNull();
    });

    it('reads the photo bytes exactly (older layout, mobile + email hashes after the photo)', () => {
      const parsed = parseSecureQr(buildSecureQr(signer, { indicator: 3 }));
      expect(parsed.photo.equals(SYNTHETIC_JP2_PHOTO)).toBe(true);
      expect(jpeg2000ToJpeg(parsed.photo)?.subarray(0, 2).toString('hex')).toBe('ffd8');
    });

    it('reads the newer layout: version marker, mobile last 4 digits, photo up to the signature', () => {
      const parsed = parseSecureQr(buildSecureQr(signer, { version: 'V2', mobile: '9876500001' }));
      expect(parsed.version).toBe('V2');
      expect(parsed.mobileLast4).toBe('0001');
      expect(parsed.mobileHash).toBeNull();
      expect(parsed.photo.equals(SYNTHETIC_JP2_PHOTO)).toBe(true);
      expect(parsed.name).toBe('Kavya Ramesh');
      expect(verifySecureQrSignature(parsed, [signer.trusted])).not.toBeNull();
    });

    it('accepts a zlib stream as well as gzip', () => {
      const signed = secureQrSignedBytes();
      const signature = sign('sha256', signed, signer.privateKey);
      const zlibText = bytesToDecimal(deflateSync(Buffer.concat([signed, signature])));
      expect(parseSecureQr(zlibText).name).toBe('Kavya Ramesh');
    });
  });

  describe('refusals', () => {
    it('refuses the old unsigned XML QR with its own reason', () => {
      expect(failure(() => parseSecureQr('<?xml version="1.0" encoding="UTF-8"?><PrintLetterBarcodeData uid="xxxx" name="A"/>'))).toBe('old_unsigned_qr');
      expect(failure(() => parseSecureQr('<PrintLetterBarcodeData name="A"/>'))).toBe('old_unsigned_qr');
    });

    it('refuses text that is not a Secure QR', () => {
      expect(failure(() => parseSecureQr('https://example.com'))).toBe('unreadable');
      expect(failure(() => parseSecureQr('123456789012345'))).toBe('unreadable');
      expect(failure(() => parseSecureQr(''))).toBe('unreadable');
      expect(failure(() => parseSecureQr(undefined))).toBe('unreadable');
      expect(failure(() => parseSecureQr('9'.repeat(MAX_QR_TEXT_LENGTH + 1)))).toBe('unreadable');
      // gzip of something with too few fields
      expect(failure(() => parseSecureQr(bytesToDecimal(gzipSync(Buffer.alloc(400, 65)))))).toBe('unreadable');
    });

    it('refuses a stream that inflates to more than 64 KB', () => {
      expect(failure(() => parseSecureQr(bytesToDecimal(gzipSync(Buffer.alloc(200 * 1024, 0)))))).toBe('unreadable');
    });
  });

  describe('phone linked to the Aadhaar', () => {
    it('older cards: the repeated SHA-256 hash of his OTP-verified number', () => {
      // last digit 4 → four rounds
      const parsed = parseSecureQr(buildSecureQr(signer, { last4: '5674', mobile: '9876500001' }));
      expect(phoneLinkStatus(parsed, '+919876500001')).toBe('linked');
      expect(phoneLinkStatus(parsed, '9876500002')).toBe('not_linked');
    });

    it('older cards: last digit 0 or 1 hashes once', () => {
      for (const last4 of ['1230', '1231']) {
        const parsed = parseSecureQr(buildSecureQr(signer, { last4, mobile: '9876500001' }));
        expect(phoneLinkStatus(parsed, '9876500001')).toBe('linked');
      }
    });

    it('newer cards: the last 4 digits', () => {
      const parsed = parseSecureQr(buildSecureQr(signer, { version: 'V2', mobile: '9876500001' }));
      expect(phoneLinkStatus(parsed, '9123400001')).toBe('linked');
      expect(phoneLinkStatus(parsed, '9876500009')).toBe('not_linked');
    });

    it('no mobile on the Aadhaar is "not linked"; no usable phone is "unknown"', () => {
      expect(phoneLinkStatus(parseSecureQr(buildSecureQr(signer, { indicator: 0 })), '9876500001')).toBe('not_linked');
      expect(phoneLinkStatus(parseSecureQr(buildSecureQr(signer, { indicator: 1 })), '9876500001')).toBe('not_linked');
      expect(phoneLinkStatus(parseSecureQr(buildSecureQr(signer)), null)).toBe('unknown');
    });
  });

  describe('18+, name, reference', () => {
    const now = new Date('2026-11-14T06:00:00Z');

    it('works out 18+ from the date of birth on the IST calendar day', () => {
      expect(isAdultOn(parseQrDateOfBirth('14-11-2008'), now)).toBe(true);
      expect(isAdultOn(parseQrDateOfBirth('15-11-2008'), now)).toBe(false);
      expect(isAdultOn(parseQrDateOfBirth('2008-11-14'), now)).toBe(true);
      // only a year: counted as 31 December, so nobody under 18 slips through
      expect(isAdultOn(parseQrDateOfBirth('2007'), now)).toBe(true);
      expect(isAdultOn(parseQrDateOfBirth('2008'), now)).toBe(false);
      expect(isAdultOn(parseQrDateOfBirth('31-02-2000'), now)).toBe(false);
      expect(isAdultOn(parseQrDateOfBirth('not a date'), now)).toBe(false);
    });

    it('ID name matcher: whole words, at least two words of 3+ letters in common', () => {
      expect(checkIdName('Kavya Ramesh', 'KAVYA  RAMESH')).toEqual({ matches: true, reason: 'matched', likelySpelling: false });
      expect(checkIdName('Ravi Kumar', 'Ravi Kumar S')).toMatchObject({ matches: true });
      expect(checkIdName('Kavya.Ramesh', 'Ramesh, Kavya')).toMatchObject({ matches: true });
      expect(checkIdName('Suresh Kumar', 'Sureesh Kumar')).toEqual({ matches: false, reason: 'too_few_words', likelySpelling: true });
      expect(checkIdName('Suresh Kumar', 'Anil Sharma')).toEqual({ matches: false, reason: 'different', likelySpelling: false });
    });

    it('ID name matcher (adversarial): initials, one shared word or parts of words never pass', () => {
      // A one-letter name against anything.
      expect(checkIdName('a', 'Anything At All').matches).toBe(false);
      expect(checkIdName('Anything At All', 'a').matches).toBe(false);
      // Initials and short pieces of the real name.
      expect(checkIdName('R K', 'Ravi Kumar').matches).toBe(false);
      expect(checkIdName('Ra Ku', 'Ravi Kumar').matches).toBe(false);
      expect(checkIdName('Ravi Kumar', 'R K').matches).toBe(false);
      // Only one word in common (a common surname).
      expect(checkIdName('Kumar', 'Suresh Kumar').matches).toBe(false);
      expect(checkIdName('Suresh Kumar', 'Kumar').matches).toBe(false);
      expect(checkIdName('Ramesh Kumar', 'Suresh Kumar').matches).toBe(false);
      // The same word twice is still one word.
      expect(checkIdName('Kumar Kumar', 'Kumar Kumar').matches).toBe(false);
      // Parts of words don't count: "Ravi" is not in "Ravindra".
      expect(checkIdName('Ravi Kumar', 'Ravindra Kumaran').matches).toBe(false);
      // Empty or punctuation only.
      expect(checkIdName('', 'Ravi Kumar').matches).toBe(false);
      expect(checkIdName('Ravi Kumar', '...').matches).toBe(false);
      expect(checkIdName('R K', 'Ravi Kumar').reason).toBe('too_few_words');
    });

    it('masks the reference as XXXX-XXXX-1234', () => {
      expect(maskedAadhaarReference('1234')).toBe('XXXX-XXXX-1234');
      expect(maskedAadhaarReference('12345')).toBeNull();
    });
  });
});
