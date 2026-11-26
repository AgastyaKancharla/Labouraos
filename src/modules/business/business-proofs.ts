/**
 * Business proofs (Master Guide rev 211, "Decided 25 Nov", B2): at least 2 of
 *   1. a GST number (GSTIN: format and check digit),
 *   2. an FSSAI / trade licence / Udyam number (format check), and
 *   3. a Google Maps link (resolved to its pin by src/modules/maps-link).
 * Shop and Establishment registration counts in group 2: it is the state's trade licence for
 * shops. So do the licences of other-licences.ts (drug licence, KPME, excise, PSARA, contract
 * labour, factory, PESO; owner, 26 Nov). The GST number is checked for its format and check digit only; a real online GST
 * check comes later with a paid service (the mock GST lookup stays as it is).
 * Pure functions, no network.
 */

import { isValidOtherLicenceNumber, readOtherLicences } from './other-licences';

const GSTIN_CHARS = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ';
/** 2-digit state code, the PAN (5 letters, 4 digits, 1 letter), entity number, Z, check character. */
const GSTIN_FORMAT = /^(\d{2})[A-Z]{5}\d{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/;

export function normaliseRegistrationNumber(value: string | null | undefined): string {
  return (value ?? '').replace(/\s+/g, '').toUpperCase();
}

/** The GSTIN check character for its first 14 characters (GSTN's mod-36 rule). */
export function gstinCheckCharacter(first14: string): string {
  let sum = 0;
  for (let i = 0; i < 14; i += 1) {
    const value = GSTIN_CHARS.indexOf(first14[i]);
    if (value < 0) return '';
    const product = value * (i % 2 === 0 ? 1 : 2);
    sum += Math.floor(product / 36) + (product % 36);
  }
  return GSTIN_CHARS[(36 - (sum % 36)) % 36];
}

/** A well-formed GSTIN: state code 01–38 (or 97/99), the PAN shape, and the right check character. */
export function isValidGstin(value: string | null | undefined): boolean {
  const gstin = normaliseRegistrationNumber(value);
  const match = GSTIN_FORMAT.exec(gstin);
  if (!match) return false;
  const state = Number(match[1]);
  if (!((state >= 1 && state <= 38) || state === 97 || state === 99)) return false;
  return gstinCheckCharacter(gstin.slice(0, 14)) === gstin[14];
}

/** FSSAI licence or registration: 14 digits, the first 1 (licence) or 2 (registration). */
export function isValidFssai(value: string | null | undefined): boolean {
  return /^[12]\d{13}$/.test(normaliseRegistrationNumber(value));
}

/** Udyam registration: UDYAM-<state letters>-<2 digits>-<7 digits>. */
export function isValidUdyam(value: string | null | undefined): boolean {
  return /^UDYAM-[A-Z]{2}-\d{2}-\d{7}$/.test(normaliseRegistrationNumber(value));
}

/**
 * Trade licence or Shop and Establishment number: formats differ between city corporations,
 * so the check is a shape check — 5 to 30 letters, digits, "/", "-" or ".", with at least 3 digits.
 */
export function isValidTradeLicence(value: string | null | undefined): boolean {
  const v = normaliseRegistrationNumber(value);
  return /^[A-Z0-9/.-]{5,30}$/.test(v) && (v.match(/\d/g)?.length ?? 0) >= 3;
}

export type ProofKey = 'gst' | 'licence' | 'maps';

export interface ProofInput {
  gstNumber?: string | null;
  fssaiNumber?: string | null;
  licenceNumber?: string | null;
  shopEstablishmentNumber?: string | null;
  udyamNumber?: string | null;
  /** 26 Nov: drug licence, KPME, excise, PSARA, contract labour, factory, PESO (other-licences.ts); count in group 2. */
  otherLicences?: unknown;
  mapsLink?: string | null;
  mapsLatitude?: number | null;
  mapsLongitude?: number | null;
}

export interface ProofResult {
  key: ProofKey;
  /** Something was entered for this proof. */
  given: boolean;
  valid: boolean;
  /** Which number made group 2 valid (fssai, licence, shop_establishment, udyam), or why a proof failed. */
  detail: string | null;
}

/** Each of the three proofs: given, valid, and a short note. */
export function evaluateProofs(b: ProofInput): ProofResult[] {
  const gstGiven = Boolean(normaliseRegistrationNumber(b.gstNumber));
  const gstValid = gstGiven && isValidGstin(b.gstNumber);
  const licenceCandidates: Array<[string, string | null | undefined, (v: string | null | undefined) => boolean]> = [
    ['fssai', b.fssaiNumber, isValidFssai],
    ['udyam', b.udyamNumber, isValidUdyam],
    ['licence', b.licenceNumber, isValidTradeLicence],
    ['shop_establishment', b.shopEstablishmentNumber, isValidTradeLicence],
    ...readOtherLicences(b.otherLicences).map(
      (l): [string, string | null | undefined, (v: string | null | undefined) => boolean] => [l.kind, l.number, isValidOtherLicenceNumber],
    ),
  ];
  const licenceGiven = licenceCandidates.filter(([, v]) => Boolean(normaliseRegistrationNumber(v)));
  const licenceValid = licenceGiven.find(([, v, check]) => check(v));
  const mapsGiven = Boolean(b.mapsLink?.trim());
  const mapsValid = mapsGiven && typeof b.mapsLatitude === 'number' && typeof b.mapsLongitude === 'number';
  return [
    { key: 'gst', given: gstGiven, valid: gstValid, detail: gstGiven && !gstValid ? 'GST number has the wrong format or check digit' : null },
    {
      key: 'licence',
      given: licenceGiven.length > 0,
      valid: Boolean(licenceValid),
      detail: licenceValid ? licenceValid[0] : licenceGiven.length ? `${licenceGiven.map(([k]) => k.replace('_', ' ')).join(', ')}: wrong format` : null,
    },
    { key: 'maps', given: mapsGiven, valid: mapsValid, detail: mapsGiven && !mapsValid ? 'The Maps link could not be read to a pin' : null },
  ];
}

/** How many proofs are valid. */
export function validProofCount(b: ProofInput): number {
  return evaluateProofs(b).filter((p) => p.valid).length;
}

/** The proofs needed for the automatic check (B3). */
export const MIN_VALID_PROOFS = 2;

/**
 * A typed number's format check for the forms: null when fine (or empty), else the message.
 * Only the numbers whose format is fixed are refused on save (GSTIN, FSSAI, Udyam).
 */
export function proofFormatError(field: 'gstNumber' | 'fssaiNumber' | 'udyamNumber', value: string | null | undefined): string | null {
  if (!normaliseRegistrationNumber(value)) return null;
  if (field === 'gstNumber' && !isValidGstin(value)) return 'GST number: 15 characters (state code, PAN, entity, Z, check digit) — check it was typed right';
  if (field === 'fssaiNumber' && !isValidFssai(value)) return 'FSSAI number: 14 digits starting with 1 or 2';
  if (field === 'udyamNumber' && !isValidUdyam(value)) return 'Udyam number: UDYAM-XX-00-0000000';
  return null;
}
